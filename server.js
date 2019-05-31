const fs = require('fs');
const assert = require('assert');

const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const uniqid = require('uniqid');

const {
  generateDeck,
  extractRandomCard,
  getHandRank,
  resolveTie,
  kSubsets
} = require('./poker');
const { Status, Street, ActionType } = require('./public/enums');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Only one table for now with a 10,000 buyin.

const BUY_IN = 10000;
const SMALL_BLIND = 50;
const BIG_BLIND = 100;

const WAIT_TO_RESET_MS = 4000;
const ALLIN_BETWEEN_STREETS_MS = 2500;

const GameState = {
  players: [],
  hands: [],
  deck: generateDeck(),
  smallBlindIndex: 0,
  bigBlindIndex: 1,
  dealerIndex: 0,
  actionIndex: 0,
  pots: [{ amount: 0, playerIndexesInvolved: [] }],
  winnerIndexesPerPot: [],
  actions: {
    [Street.PRE_FLOP]: [],
    [Street.FLOP]: [],
    [Street.TURN]: [],
    [Street.RIVER]: []
  },
  board: [],
  currentBetTotal: 0,
  status: Status.LOBBY,
  street: Street.PRE_FLOP
};

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

app.get('/hand-history', function(req, res) {
  /* TODO */
  res.send('Hand history page coming soon.');
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

      client.emit('join-success', GameState, GameState.players.length - 1)
      client.broadcast.emit('join', GameState);
    }
  });

  client.on('disconnect', function(reason) {
    // TODO
  });

  client.on('gateway', function(username) {
    for (let i = 0; i < GameState.players.length; i++) {
      if (GameState.players[i].username === username) {
        client.username = username;

        client.emit('gateway-success', GameState, i);
        return;
      }
    }

    client.emit('gateway-failure', { msg: `Player with username ${username} not found.` });
  });

  client.on('ready', function(playerIndex) {
    GameState.players[playerIndex].ready = true;

    // If everyone is ready, initialize a pot and deal out some hands
    if (GameState.players.every(p => p.ready)) {
      GameState.status = Status.HAND;

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
      GameState.actions[Street.PRE_FLOP].push({
        amount: SMALL_BLIND,
        playerIndex: GameState.smallBlindIndex,
        type: ActionType.SMALL_BLIND
      });

      GameState.players[GameState.bigBlindIndex].stack -= BIG_BLIND;
      GameState.actions[Street.PRE_FLOP].push({
        amount: BIG_BLIND,
        playerIndex: GameState.bigBlindIndex,
        type: ActionType.BIG_BLIND
      });

      GameState.pots[0].amount = SMALL_BLIND + BIG_BLIND;
      GameState.currentBetTotal = BIG_BLIND;

      // Deal out hands.
      // Just playing Texas Hold 'em for now. (Starting with 2 cards)
      for (let i = 0; i < GameState.players.length; i++) {
        GameState.pots[0].playerIndexesInvolved.push(i);

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
    GameState.pots[0].amount += amount

    GameState.actions[GameState.street].push({
      amount,
      playerIndex,
      type: ActionType.RAISE
    });

    incrementActionIndex();
    GameState.currentBetTotal = getCurrentBetTotal();

    io.emit('raise', GameState);
  });

  client.on('call', function({ playerIndex, amountToCall }) {
    const actions = GameState.actions[GameState.street];
    const action = { playerIndex, type: ActionType.CALL };

    let sumContributions = sumContributionsOfPlayerThisStreet(playerIndex);
    const laa = getLatestAggressiveAction();

    if (amountToCall > GameState.players[playerIndex].stack) {
      action.amount = GameState.players[playerIndex].stack;
      action.allIn = true;

      sumContributions += action.amount;

      GameState.pots[0].amount += action.amount;
      GameState.players[playerIndex].stack = 0;

      const sidePotsThisStreet = [];
      for (let i = 1; i < GameState.pots.length; i++) {
        if (GameState.pots[i].streetCreated === GameState.street) {
          sidePotsThisStreet.push(GameState.pots[i]);
        }
      }

      const existingEquivalentSidePotIndex =
        sidePotsThisStreet.findIndex(sp => sp.effectiveStack === sumContributions);

      if (existingEquivalentSidePotIndex === -1) {
        const sidePot = {
          amount: sumContributions * 2,
          effectiveStack: sumContributions,
          playerIndexesInvolved: [playerIndex, laa.playerIndex],
          streetCreated: GameState.street
        };

        const involvedIndex = GameState.pots[0].playerIndexesInvolved.indexOf(playerIndex);
        GameState.pots[0].playerIndexesInvolved.splice(involvedIndex, 1);

        for (const sp of sidePotsThisStreet) {
          if (sp.effectiveStack > sumContributions) {
            for (const index of sp.playerIndexesInvolved) {
              if (index !== playerIndex && index !== laa.playerIndex) {
                sp.amount -= sumContributions;
                sidePot.amount += sumContributions

                if (!sidePot.playerIndexesInvolved.includes(index)) {
                  sidePot.playerIndexesInvolved.push(index);
                }
              }
            }
          } else {
            sidePot.amount -= sp.effectiveStack * 2;

            for (const index of sp.playerIndexesInvolved) {
              if (index !== playerIndex && index !== laa.playerIndex) {
                sp.amount += sp.effectiveStack;
                sidePot.amount += (sumContributions - sp.effectiveStack);
              }
            }
          }
        }

        GameState.pots[0].amount -= sidePot.amount;
        GameState.pots.push(sidePot);

        io.emit('side-pot', GameState);
      } else {
        /*
        const existingSidePot = GameState.sidePots[existingEquivalentSidePotIndex];

        existingSidePot.amount += sumContributions;
        existingSidePot.playerIndexesInvolved.push(playerIndex);
        */
      }
    } else {
      action.amount = amountToCall;
      sumContributions += amountToCall;

      GameState.pots[0].amount += amountToCall;
      GameState.players[playerIndex].stack -= amountToCall;
    }

    actions.push(action);

    // TODO: Factor this into a "shouldDoAllInRunout" function.
    let numPlayersNotAllIn = 0;
    let remainingPlayer;
    for (const player of GameState.players) {
      if (player.folded) continue;
      if (player.stack > 0) numPlayersNotAllIn++;
      if (numPlayersNotAllIn > 1) break;
    }

    if (numPlayersNotAllIn <= 1) {
      // Resolve effective stack
      const sumContributionsLaa = sumContributionsOfPlayerThisStreet(laa.playerIndex);
      if (sumContributionsLaa > sumContributions) {
        assert(GameState.pots.some(sp => sp.streetCreated === GameState.street));

        GameState.players[laa.playerIndex].stack += GameState.pots[0].amount;
        GameState.pots[0].amount = 0;
      }

      io.emit('all-in-runout', GameState);
      return allInRunoutProc();
    }

    incrementActionIndex();

    if (laa.type === ActionType.BIG_BLIND) {
      io.emit('big-blind-option', GameState);
    } else if (shouldMoveToNextStreet(ActionType.CALL, laa.playerIndex)) {
      if (GameState.street === Street.RIVER) {
        showdownProc();
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
    GameState.pots[0].amount += amount;

    // Special case for big blind option.
    const laa = getLatestAggressiveAction();
    if (GameState.street === Street.PRE_FLOP
      && playerIndex === GameState.bigBlindIndex
      && laa.playerIndex === playerIndex
      && laa.type === ActionType.BIG_BLIND
    ) {
      GameState.currentBetTotal = amount + BIG_BLIND;
    } else {
      GameState.currentBetTotal = amount;
    }

    GameState.actions[GameState.street].push({
      playerIndex,
      amount,
      type: ActionType.BET
    });
    incrementActionIndex();

    io.emit('bet', GameState);
  });

  client.on('check', function({ playerIndex }) {
    GameState.actions[GameState.street].push({
      playerIndex,
      type: ActionType.CHECK
    });

    if (shouldMoveToNextStreet(ActionType.CHECK)) {
      if (GameState.street === Street.RIVER) {
        showdownProc();
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

    let involvedIndex;
    for (const pot of GameState.pots) {
      involvedIndex = pot.playerIndexesInvolved.indexOf(playerIndex);
      if (involvedIndex !== -1) pot.playerIndexesInvolved.splice(involvedIndex, 1);
    }

    const laa = getLatestAggressiveAction();
    let numActivePlayers = 0;
    let player;
    for (let i = 0; i < GameState.players.length; i++) {
      player = GameState.players[i];

      if (!player.folded && (player.stack > 0 || i === laa.playerIndex)) numActivePlayers++;
    }

    if (numActivePlayers === 1) {

      // DEBUG:
      assert(GameState.pots[0].playerIndexesInvolved.length === 1);

      if (GameState.pots.length > 1) {
        if (GameState.street === Street.RIVER) showdownProc();
        else allInRunoutProc();
      } else {
        GameState.status = Status.FINISHED;

        const winnerIndex = GameState.pots[0].playerIndexesInvolved[0];
        GameState.winnerIndexesPerPot = [[winnerIndex]];
        GameState.players[winnerIndex].stack += GameState.pots[0].amount;

        io.emit('hand-finished', GameState);

        setTimeout(function() {
          resetHandState();
          io.emit('reset', GameState);
        }, WAIT_TO_RESET_MS);
      }
    } else {
      incrementActionIndex();

      const laa = getLatestAggressiveAction();
      if (GameState.actionIndex === GameState.bigBlindIndex && laa.type === ActionType.BIG_BLIND) {
        io.emit('big-blind-option', GameState);
      } else if (shouldMoveToNextStreet(ActionType.FOLD, laa.playerIndex)) {
        if (GameState.street === Street.RIVER) {
          showdownProc();
        } else {
          moveToNextStreet();
          io.emit('next-street', GameState);
        }
      } else {
        io.emit('fold', GameState);
      }
    }
  });

  client.on('top-off', function(playerIndex) {
    if (!GameState.players[playerIndex]) {
      console.error(`Could not find player at index ${playerIndex}.`);
      return;
    }

    const topOffString = `${GameState.players[playerIndex].username} topped off for `
      + `${10000 - GameState.players[playerIndex].stack}\n\n`;

    fs.appendFile('game-logs.txt', topOffString, function(err) {
      if (err) console.error(err);
    });

    GameState.players[playerIndex].stack = 10000;
    io.emit('top-off', GameState);
  });
});

server.listen(8080, function() {
  console.log('Listening on port 8080...');
});

function incrementActionIndex() {
  GameState.actionIndex = (GameState.actionIndex + 1) % GameState.players.length;

  while (GameState.players[GameState.actionIndex].folded) {
    GameState.actionIndex = (GameState.actionIndex + 1) % GameState.players.length;
  }
}

function shouldMoveToNextStreet(actionType, latestAggressorIndex) {
  if (actionType === ActionType.CHECK) {
    if (GameState.street === Street.PRE_FLOP) {
      if (GameState.actionIndex === GameState.bigBlindIndex) return true;
      else return false;
    } else {
      if (GameState.actionIndex === GameState.dealerIndex) return true;
      else return false;
    }
  } else {
    assert(actionType === ActionType.CALL || actionType === ActionType.FOLD);
    assert(!isNaN(latestAggressorIndex));

    if (latestAggressorIndex === GameState.actionIndex) return true;
    else return false;
  }
}

function moveToNextStreet() {
  GameState.street++;

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

  GameState.currentBetTotal = 0;
}

function getLatestAggressiveAction() {
  let action;
  for (const a of GameState.actions[GameState.street]) {
    if (a.amount && a.type !== ActionType.CALL) {
      action = a;
    }
  }

  return action;
}

function resetHandState() {
  GameState.hands = [];
  GameState.pots = [{ amount: 0, playerIndexesInvolved: [] }];
  GameState.winnerIndexesPerPot = [];
  GameState.board = [];
  GameState.deck = generateDeck();
  GameState.status = Status.LOBBY;
  GameState.street = Street.PRE_FLOP;
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
  let latestAggressorIndex;
  for (const a of GameState.actions[GameState.street]) {
    if (a.type === ActionType.BET || a.type === ActionType.RAISE) {
      latestAggressorIndex = a.playerIndex
    }
  }

  let currentBetTotal = 0;
  for (const a of GameState.actions[GameState.street]) {
    if (a.playerIndex === latestAggressorIndex && a.amount) {
      currentBetTotal += a.amount;
    }
  }

  return currentBetTotal;
}

function sumContributionsOfPlayerThisStreet(playerIndex) {
  const actions = GameState.actions[GameState.street];

  let sum = 0;
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].playerIndex === playerIndex && actions[i].amount) {
      sum += actions[i].amount;
    }
  }

  return sum;
}

function allInRunoutProc() {
  // Fire next-street events every 2.5 seconds until streetIndex is 3 (river)
  const runoutInterval = setInterval(function() {
    if (GameState.street >= Street.RIVER) {
      showdownProc();
      clearInterval(runoutInterval);
    } else {
      moveToNextStreet();
      io.emit('next-street', GameState, true);
    }
  }, ALLIN_BETWEEN_STREETS_MS);
}

function showdownProc() {
  GameState.status = Status.FINISHED;
  const handId = uniqid();

  assert(GameState.winnerIndexesPerPot.length === 0);

  let winnerIndexes;
  for (let i = 0; i < GameState.pots.length; i++) {
    assert(GameState.pots[i].amount >= 0);
    assert(GameState.pots[i].playerIndexesInvolved.length >= 1)

    winnerIndexes = calculateWinnerIndexes(GameState.pots[i].playerIndexesInvolved);
    GameState.winnerIndexesPerPot.push(winnerIndexes);

    for (const index of winnerIndexes) {
      // TODO: Implement "odd chip" functionality. As is this division may result in a floating point number.
      GameState.players[index].stack += GameState.pots[i].amount / winnerIndexes.length;
    }
  }

  let handHistoryString = `NEW HAND WITH ID ${handId}\n\n`
  for (let i = 0; i < GameState.players.length; i++) {
    handHistoryString += `Username: ${GameState.players[i].username}\n`
      + `Hand: ${GameState.hands[i].reduce((acc, c) => acc + `${c.value}${c.suit}`, '')}\n\n`;
  }

  handHistoryString += 'Board: ';
  for (const card of GameState.board) {
    handHistoryString += `${card.value}${card.suit}`;
  }

  handHistoryString += '\n\n';

  for (let i = 0; i < GameState.pots.length; i++) {
    handHistoryString += `Pot ${i + 1}: ${GameState.pots[i].amount}\n`;

    handHistoryString += `Winner(s): `
    const winnerUsernames = [];
    for (const index of GameState.winnerIndexesPerPot[i]) {
      winnerUsernames.push(GameState.players[index].username);
    }

    handHistoryString += winnerUsernames.join();
    handHistoryString += '\n\n';
  }

  // TODO: Send handId back on this and on the rest of hand-finisheds as well.
  io.emit('hand-finished', GameState);

  setTimeout(function() {
    resetHandState();
    io.emit('reset', GameState);
  }, WAIT_TO_RESET_MS);

  fs.appendFile('game-logs.txt', handHistoryString, function(err) {
    if (err) console.error(err);
  });
}

function calculateWinnerIndexes(playerIndexes) {
  if (playerIndexes.length === 1) return [playerIndexes[0]];

  const showdownHands = [];
  const handRanks = [];
  let combinedHand, possibleHands, tmp, currBestHandIndexes, currBestHandRank;

  for (const index of playerIndexes) {
    combinedHand = GameState.hands[index].concat(GameState.board);
    combinedHand.sort((a, b) => a.value - b.value);

    possibleHands = [];
    tmp = Array(5).fill(null);

    kSubsets(combinedHand, tmp, possibleHands);

    currBestHandIndexes = [0];
    currBestHandRank = getHandRank(possibleHands[0]);
    let currHandRank;

    // DEBUG:
    assert(possibleHands.length === 21);

    for (let i = 1; i < possibleHands.length; i++) {
      currHandRank = getHandRank(possibleHands[i]);

      if (currHandRank < currBestHandRank) {
        currBestHandIndexes = [i];
        currBestHandRank = currHandRank;
      } else if (currHandRank > currBestHandRank) {
        // Do nothing?
      } else if (currHandRank === currBestHandRank) {
        currBestHandIndexes.push(i);
      } else {
        assert(false);
      }
    }

    let resolvedTiesBestHandIndex = currBestHandIndexes[0];
    let cmpResult;
    for (const index of currBestHandIndexes) {
      cmpResult = resolveTie(
        currBestHandRank,
        possibleHands[resolvedTiesBestHandIndex],
        possibleHands[index]
      );

      if (cmpResult === 2) resolvedTiesBestHandIndex = index;
    }

    showdownHands.push(possibleHands[resolvedTiesBestHandIndex]);
    handRanks.push(currBestHandRank);
  }

  let currWinningHandIndexes = [0];
  let currWinningHandRank = handRanks[0];
  let cmpResult;
  for (let i = 1; i < showdownHands.length; i++) {
    if (handRanks[i] < currWinningHandRank) {
      currWinningHandIndexes = [i];
      currWinningHandRank = handRanks[i];
    } else if (handRanks[i] > currWinningHandRank) {
      // Do nothing?
    } else if (handRanks[i] === currWinningHandRank) {
      cmpResult = resolveTie(
        handRanks[i],
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

  return currWinningHandIndexes;
}
