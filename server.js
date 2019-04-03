const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const { generateDeck, extractRandomCard } = require('./poker');

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

const InitialState = {
  players: [],
  hands: [],
  deck: generateDeck(),
  smallBlindIndex: 0,
  bigBlindIndex: 1,
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
  winner: null
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
    const callData = { GameState };

    const la = getLatestAggressiveAction();
    if (la.type === 'big-blind') {
      callData.bigBlindOption = true;
    } else if (shouldMoveToNextStreet('call', { la })) {
      // If already on river, we see a showdown here.
      if (GameState.streetIndex === 3) {
        GameState.statusIndex = 2;

        const winner = calculateWinnerAtShowdown();
        io.emit('hand-finished', { GameState, winner });

        // Giving 4 seconds to view the winner/amount before going back to lobby.
        setTimeout(function() {
          resetHandState();
          io.emit('reset', GameState);
        }, 4000);
        return;
      }

      moveToNextStreet();
      callData.shouldMoveToNextStreet = true;
    }

    io.emit('call', callData);
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

    io.sockets.emit('bet', GameState);
  });

  client.on('check', function({ username }) {
    const prevActionIndex = actionIndex;
    incrementActionIndex();

    const checkData = { username };

    if (shouldMoveToNextStreet('check', { prevActionIndex })) {
      moveToNextStreet();

      checkData.street = streets[streetIndex];
      checkData.board = board;
    }

    // This has to be down here because 'moveToNextStreet()' will often change the actionIndex.
    checkData.actionIndex = actionIndex;

    io.sockets.emit('check', checkData);
  });

  client.on('fold', function({ username }) {
    for (const p of players) {
      if (p.username === username) {
        p.folded = true;
      }
    }

    const foldData = { username };

    let numActivePlayers = 0;
    for (const p of players) {
      if (!p.folded) {
        numActivePlayers++;
      }
    }

    if (numActivePlayers === 1) {
      // If only 1 player remaining the hand is finished.
      streetIndex = 6;

      for (const p of players) {
        if (!p.folded) {
          p.stack += pot;
          winner = p;
        }
      }

      io.sockets.emit('hand-finished', { winner, players });
    } else {
      incrementActionIndex();

      const lac = getLatestAggressiveContribution();
      if (shouldMoveToNextStreet('fold', { lac })) {
        moveToNextStreet();
      }

      foldData.actionIndex = actionIndex;
      foldData.players = players;

      io.sockets.emit('fold', foldData);
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
      if (infoObj.prevActionIndex === GameState.bigBlindIndex) return true;
      else return false;
    } else {
      if (GameState.players.length === 2) {
        // Because small blind acts last post-flop if only 2 players.
        if (infoObj.prevActionIndex === GameState.smallBlindIndex) return true;
        else return false;
      } else {
        if (GameState.actionIndex === GameState.smallBlindIndex) return true;
        else return false;
      }
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
  GameState.winner = null;
  GameState.currentBetTotal = 0;

  // Empty actions object
  for (const k in GameState.actions) {
    GameState.actions[k] = [];
  }

  // Reset all players folded status to false.
  for (const p of GameState.players) {
    if (p.folded) p.folded = false;
  }

  GameState.bigBlindIndex++;
  if (GameState.bigBlindIndex >= GameState.players.length) {
    GameState.bigBlindIndex = 0;
  }

  GameState.smallBlindIndex++;
  if (GameState.smallBlindIndex >= GameState.players.length) {
    GameState.smallBlindIndex = 0;
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

function calculateWinnerAtShowdown() {
  /* TODO */
}
