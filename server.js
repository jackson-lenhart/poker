const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const { generateDeck, extractRandomCard, getHandRank, resolveTie } = require('./poker');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Only one table for now with a 10,000 buyin.
// Will probably use a message queue for this eventually
// rather than having the server be stateful.

const BUY_IN = 10000;
// GameState will loop through these statuses as the game progresses.
const STATUSES = ['LOBBY', 'HAND', 'FINISHED'];
const STREETS = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];

const SMALL_BLIND = 50;
const BIG_BLIND = 100;

const WAIT_TO_RESET_MS = 4000;

// Do we need this? Might be able to just set the desired
// initial state to GameState directly.
const InitialState = {
  players: [],
  hands: [],
  deck: generateDeck(),
  smallBlindIndex: 0,
  bigBlindIndex: 1,
  dealerIndex: 0,
  actionIndex: 0,
  pot: 0,
  actions: {
    'PRE-FLOP': [],
    'FLOP': [],
    'TURN': [],
    'RIVER': []
  },
  board: [],
  currentBetTotal: 0,
  statusIndex: 0,
  streetIndex: 0,
  winnerIndexes: []
};

let GameState = { ...InitialState };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  next();
});

app.use(express.static('public'));

app.get('/', function(req, res) {
  res.sendFile('index.html');
});

io.on('connection', function(client) {
  client.on('join', function(username) {
    if (GameState.players.some(p => p.username === username)) {
      client.emit('join-failure', `User ${username} already exists.`);
    } else {
      const player = { username, stack: BUY_IN, ready: false, folded: false };
      GameState.players.push(player);
      client.username = player.username;

      // Doing this just to make it clear that we will have 1 hand per player
      // and indexes will match.
      GameState.hands.push(null);

      client.emit('join-success', {
        GameState,
        username,
        playerIndex: GameState.players.length - 1
      });

      client.broadcast.emit('join', GameState);
    }
  });

  client.on('gateway', function(username) {
    for (let i = 0; i < GameState.players.length; i++) {
      if (GameState.players[i].username === username) {
        client.username = username;

        client.emit('gateway-success', { GameState, playerIndex: i });
        return;
      }
    }

    client.emit('gateway-failure', { msg: `Player with username ${username} not found.` });
  });

  client.on('ready', function(playerIndex) {
    GameState.players[playerIndex].ready = true;

    // If everyone is ready, initialize a pot and deal out some hands
    if (GameState.players.every(p => p.ready)) {
      GameState.statusIndex = 1;

      GameState.smallBlindIndex = GameState.bigBlindIndex - 1;
      if (GameState.smallBlindIndex < 0) {
        GameState.smallBlindIndex = GameState.players.length - 1;
      }

      if (GameState.players.length === 2) {
        GameState.dealerIndex = GameState.smallBlindIndex;
      } else {
        GameState.dealerIndex = GameState.smallBlindIndex - 1;
        if (GameState.dealerIndex < 0) {
          GameState.dealerIndex = GameState.players.length - 1;
        }
      }

      // Post small and big blinds. Blinds hard coded to 50-100 for now (no ante)
      GameState.players[GameState.smallBlindIndex].stack -= SMALL_BLIND;
      GameState.actions['PRE-FLOP'].push({
        amount: SMALL_BLIND,
        playerIndex: GameState.smallBlindIndex,
        type: 'small-blind'
      });

      GameState.players[GameState.bigBlindIndex].stack -= BIG_BLIND;
      GameState.actions['PRE-FLOP'].push({
        amount: BIG_BLIND,
        playerIndex: GameState.bigBlindIndex,
        type: 'big-blind'
      });

      GameState.pot = SMALL_BLIND + BIG_BLIND;
      GameState.currentBetTotal = BIG_BLIND;

      // Deal out hands.
      // Just playing Texas Hold 'em for now. (Starting with 2 cards)
      for (let i = 0; i < GameState.players.length; i++) {
        GameState.hands[i] = [
          extractRandomCard(GameState.deck),
          extractRandomCard(GameState.deck)
        ];
      }

      // Action will always start out left of the big blind
      GameState.actionIndex = GameState.bigBlindIndex + 1;
      if (GameState.actionIndex >= GameState.players.length) {
        GameState.actionIndex = 0;
      }

      io.emit('start-hand', GameState);
    }
  });

  client.on('raise', function({ amount, playerIndex }) {
    GameState.players[playerIndex].stack -= amount;
    GameState.pot += amount
    GameState.actions[STREETS[GameState.streetIndex]].push({
      amount,
      playerIndex,
      type: 'raise'
    });

    incrementActionIndex();
    GameState.currentBetTotal = getCurrentBetTotal();

    io.emit('raise', GameState);
  });

  client.on('call', function({ playerIndex, amountToCall }) {
    GameState.players[playerIndex].stack -= amountToCall;
    GameState.pot += amountToCall;
    GameState.actions[STREETS[GameState.streetIndex]].push({
      playerIndex,
      amount: amountToCall,
      type: 'call'
    });
    incrementActionIndex();

    const la = getLatestAggressiveAction();
    if (la.type === 'big-blind') {
      io.emit('big-blind-option', GameState);
    } else if (shouldMoveToNextStreet('call', { la })) {
      if (GameState.streetIndex === 3) {
        GameState.statusIndex = 2;
        GameState.winnerIndexes = calculateWinnerIndexesAtShowdown();

        for (const index of GameState.winnerIndexes) {
          GameState.players[index].stack += GameState.pot / GameState.winnerIndexes.length;
        }

        io.emit('hand-finished', GameState);

        // TODO: Save hand history in some sort of database/persistence layer here.

        setTimeout(function() {
          resetHandState();
          io.emit('reset', GameState);
        }, WAIT_TO_RESET_MS);
      } else {
        moveToNextStreet();
        io.emit('next-street', GameState);
      }
    } else {
      io.emit('call', GameState);
    }
  });

  client.on('bet', function({ playerIndex, amount }) {
    GameState.players[playerIndex].stack -= amount;
    GameState.pot += amount;
    GameState.currentBetTotal = amount;
    GameState.actions[STREETS[GameState.streetIndex]].push({
      playerIndex,
      amount,
      type: 'bet'
    });
    incrementActionIndex();

    io.emit('bet', GameState);
  });

  client.on('check', function({ playerIndex }) {
    GameState.actions[STREETS[GameState.streetIndex]].push({
      playerIndex,
      type: 'check'
    });

    if (shouldMoveToNextStreet('check')) {
      if (GameState.streetIndex === 3) {
        GameState.statusIndex = 2;
        GameState.winnerIndexes = calculateWinnerIndexesAtShowdown();

        for (const index of GameState.winnerIndexes) {
          GameState.players[index].stack += GameState.pot / GameState.winnerIndexes.length;
        }

        io.emit('hand-finished', GameState);

        setTimeout(function() {
          resetHandState();
          io.emit('reset', GameState);
        }, WAIT_TO_RESET_MS);
      } else {
        moveToNextStreet();
        io.emit('next-street', GameState);
      }
    } else {
      incrementActionIndex();
      io.emit('check', GameState);
    }
  });

  client.on('fold', function({ playerIndex }) {
    GameState.players[playerIndex].folded = true

    let numActivePlayers = 0;
    let potentialWinnerIndex;
    for (let i = 0; i < GameState.players.length; i++) {
      if (!GameState.players[i].folded) {
        potentialWinnerIndex = i;
        numActivePlayers++;
      }
    }

    if (numActivePlayers === 1) {
      // If only 1 player remaining the hand is finished and the potential
      // winner is in fact the winner.
      GameState.statusIndex = 2;
      GameState.players[potentialWinnerIndex].stack += GameState.pot;
      GameState.winnerIndexes = [potentialWinnerIndex];

      io.emit('hand-finished', GameState);

      setTimeout(function() {
        resetHandState();
        io.emit('reset', GameState);
      }, WAIT_TO_RESET_MS);
    } else {
      incrementActionIndex();

      const la = getLatestAggressiveAction();
      if (GameState.actionIndex === GameState.bigBlindIndex && la.type === 'big-blind') {
        io.emit('big-blind-option', GameState);
      } else if (shouldMoveToNextStreet('fold', { la })) {
        if (GameState.streetIndex === 3) {
          GameState.statusIndex = 2;
          GameState.winnerIndexes = calculateWinnerIndexesAtShowdown();

          for (const index of GameState.winnerIndexes) {
            GameState.players[index].stack += GameState.pot / GameState.winnerIndexes.length;
          }

          io.emit('hand-finished', GameState);

          setTimeout(function() {
            resetHandState();
            io.emit('reset', GameState);
          }, WAIT_TO_RESET_MS);
        } else {
          moveToNextStreet();
          io.emit('next-street', GameState);
        }
      } else {
        io.emit('fold', GameState);
      }
    }
  });
});

server.listen(8080, function() {
  console.log('Listening on port 8080...');
});

function incrementActionIndex() {
  GameState.actionIndex++;
  if (GameState.actionIndex === GameState.players.length) GameState.actionIndex = 0;

  while (GameState.players[GameState.actionIndex].folded) {
    GameState.actionIndex++;
    if (GameState.actionIndex === GameState.players.length) GameState.actionIndex = 0;
  }
}

function shouldMoveToNextStreet(eventType, infoObj) {
  if (eventType === 'check') {
    if (STREETS[GameState.streetIndex] === 'PRE-FLOP') {
      if (GameState.actionIndex === GameState.bigBlindIndex) return true;
      else return false;
    } else {
      if (GameState.actionIndex === GameState.dealerIndex) return true;
      else return false;
    }
  } else {
    if (infoObj.la.playerIndex === GameState.actionIndex) return true;
    else return false;
  }
}

function moveToNextStreet() {
  GameState.streetIndex++;

  // Action always starts to the 'left' of the button
  if (GameState.players.length === 2) {
    GameState.actionIndex = GameState.bigBlindIndex;
  } else {
    GameState.actionIndex = GameState.smallBlindIndex;
  }

  while (GameState.players[GameState.actionIndex].folded) {
    GameState.actionIndex++;
    if (GameState.actionIndex === GameState.players.length) GameState.actionIndex = 0;
  }

  if (GameState.board.length === 0) {
    for (let i = 0; i < 3; i++) {
      GameState.board.push(extractRandomCard(GameState.deck));
    }
  } else {
    GameState.board.push(extractRandomCard(GameState.deck));
  }
}

function getLatestAggressiveAction() {
  let action;
  for (const a of GameState.actions[STREETS[GameState.streetIndex]]) {
    if (a.amount && a.type !== 'call') {
      action = a;
    }
  }

  return action;
}

function resetHandState() {
  GameState.hands = [];
  GameState.pot = 0;
  GameState.board = [];
  GameState.deck = generateDeck();
  GameState.statusIndex = 0;
  GameState.streetIndex = 0;
  GameState.winnerIndexes = [];
  GameState.currentBetTotal = 0;

  // Empty actions object
  for (const k in GameState.actions) {
    GameState.actions[k] = [];
  }

  // Reset all players folded and ready status to false
  for (const p of GameState.players) {
    if (p.folded) p.folded = false;
    if (p.ready) p.ready = false;
  }

  // smallBlindIndex and dealerIndex will revolve around this once when the next hand is initiated.
  GameState.bigBlindIndex++;
  if (GameState.bigBlindIndex >= GameState.players.length) {
    GameState.bigBlindIndex = 0;
  }
}

function getCurrentBetTotal() {
  // Sum up all bets from the latest bettor to get the current bet
  let latestBettorIndex;
  for (const a of GameState.actions[STREETS[GameState.streetIndex]]) {
    if (a.amount) {
      latestBettorIndex = a.playerIndex
    }
  }

  let currentBetTotal = 0;
  for (const a of GameState.actions[STREETS[GameState.streetIndex]]) {
    if (a.playerIndex === latestBettorIndex && a.amount) {
      currentBetTotal += a.amount;
    }
  }

  return currentBetTotal;
}

function calculateWinnerIndexesAtShowdown() {
  // Difference between GameState.hands and showdownHands is GameState.hands
  // is just 2 cards, showdownHands will be the best 5 cards of those 2 combined w/ board.
  const showdownHands = [];
  for (const hand of GameState.hands) {
    const combinedHand = hand.concat(GameState.board);
    combinedHand.sort((a, b) => a.value - b.value);

    const possibleHands = [];
    const tmp = Array(5).fill(null);

    kSubsets(combinedHand, tmp, possibleHands, 0, 0);

    // DEBUG:
    console.log('Hand:', hand);

    // All indexes of hands w/ same (winning) rank get put in currBestHandIndexes
    let currBestHandIndexes = [0];
    let currBestHandRank = getHandRank(possibleHands[0]);
    for (let i = 1; i < possibleHands.length/* 21? */; i++) {
      const currHandRank = getHandRank(possibleHands[i]);

      if (currHandRank < currBestHandRank) {
        currBestHandIndexes = [i];
        currBestHandRank = currHandRank;
      } else if (currHandRank > currBestHandRank) {
        // Do nothing?
      } else if (currHandRank === currBestHandRank) {
        currBestHandIndexes.push(i);
      } else {
        console.error(
          'Somethings gone wrong. currHandRank and currBestHandRank ' +
          'are probably not comparable as numbers.'
        );
      }
    }

    // DEBUG:
    console.log('Best hand rank:', currBestHandRank);
    console.log('Best hand indexes:', currBestHandIndexes);
    console.log('Possible hands:', possibleHands);

    let resolvedTiesBestHandIndex = currBestHandIndexes[0];
    for (const index of currBestHandIndexes) {
      const cmpResult = resolveTie(
        currBestHandRank,
        possibleHands[resolvedTiesBestHandIndex],
        possibleHands[index]
      );

      if (cmpResult === 2) resolvedTiesBestHandIndex = index;
    }

    // DEBUG:
    console.log('Best hand index after resolving ties:', resolvedTiesBestHandIndex);
    console.log('Best hand:', possibleHands[resolvedTiesBestHandIndex]);
    console.log('Board:', GameState.board);

    showdownHands.push(possibleHands[resolvedTiesBestHandIndex]);
  }

  // DEBUG:
  console.log('Showdown hands:', showdownHands);

  let currWinningHandIndexes = [0];
  let currWinningHandRank = getHandRank(showdownHands[0]);
  for (let i = 1; i < showdownHands.length; i++) {
    // TODO: Optimize. We already get the bestHandRank above we just don't have access
    // to it here yet.
    const currHandRank = getHandRank(showdownHands[i]);
    if (currHandRank < currWinningHandRank) {
      currWinningHandIndexes = [i];
      currWinningHandRank = currHandRank;
    } else if (currHandRank > currWinningHandRank) {
      // Do nothing?
    } else if (currHandRank === currWinningHandRank) {
      const cmpResult = resolveTie(
        currHandRank,
        showdownHands[i],
        showdownHands[currWinningHandIndexes[0]]
      );

      if (cmpResult === 1) {
        currWinningHandIndexes = [i];
      } else if (cmpResult === 2) {
        // Do nothing.
      } else if (cmpResult === 0) {
        currWinningHandIndexes.push(i);
      } else {
        console.error(
          'Unexpected value of cmpResult. Expected 0, 1, or 2; got ' + cmpResult + '.'
        );
      }
    }
  }

  // DEBUG:
  console.log('Winning hand indexes:', currWinningHandIndexes);
  console.log('Winning hand rank:', currWinningHandRank);
  console.log('Winning hand(s):', currWinningHandIndexes.map(index => showdownHands[index]));

  return currWinningHandIndexes;
}

function kSubsets(combinedHand, tmp, possibleHands, i, j) {
  if (j === 5) {
    possibleHands.push(tmp.slice());
    return;
  }

  if (i >= combinedHand.length) return;

  tmp[j] = combinedHand[i];
  kSubsets(combinedHand, tmp, possibleHands, i + 1, j + 1);

  kSubsets(combinedHand, tmp, possibleHands, i + 1, j);
}
