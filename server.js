const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const assert = require('assert');

const {
  generateDeck,
  extractRandomCard,
  getHandRank,
  resolveTie,
  calculateWinnerIndexesAtShowdown,
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

let GameState = {
  players: [],
  hands: [],
  deck: generateDeck(),
  smallBlindIndex: 0,
  bigBlindIndex: 1,
  dealerIndex: 0,
  actionIndex: 0,
  pot: 0,
  actions: {
    [Street.PRE_FLOP]: [],
    [Street.FLOP]: [],
    [Street.TURN]: [],
    [Street.RIVER]: []
  },
  board: [],
  currentBetTotal: 0,
  status: Status.LOBBY,
  street: Street.PRE_FLOP,
  winnerIndexes: []
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

    GameState.actions[GameState.street].push({
      amount,
      playerIndex,
      type: ActionType.RAISE
    });

    incrementActionIndex();
    GameState.currentBetTotal = getCurrentBetTotal();

    io.emit('raise', playerIndex, GameState);
  });

  client.on('call', function({ playerIndex, amountToCall }) {
    const action = { playerIndex, type: ActionType.CALL };

    if (amountToCall >= GameState.players[playerIndex].stack) {
      action.amount = GameState.players[playerIndex].stack;
      action.allIn = true;

      GameState.pot += GameState.players[playerIndex].stack;
      GameState.players[playerIndex].stack = 0;
      // TODO: If necessary, create side pot.
    } else {
      action.amount = amountToCall;

      GameState.pot += amountToCall;
      GameState.players[playerIndex].stack -= amountToCall;
    }

    GameState.actions[GameState.street].push(action);

    // TODO: Factor this into a "shouldDoAllInRunout" function.
    let numPlayersNotAllIn = 0;
    for (const player of GameState.players) {
      if (player.stack > 0) numPlayersNotAllIn++;
    }

    if (numPlayersNotAllIn <= 1) {
      // Calling all in for the effective stack.
      io.emit('all-in-runout', GameState);
      return allInRunoutProc();
    }

    incrementActionIndex();
    const laa = getLatestAggressiveAction();

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
    GameState.pot += amount;

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
      GameState.status = Status.FINISHED;
      GameState.players[potentialWinnerIndex].stack += GameState.pot;
      GameState.winnerIndexes = [potentialWinnerIndex];

      io.emit('hand-finished', GameState);

      setTimeout(function() {
        resetHandState();
        io.emit('reset', GameState);
      }, WAIT_TO_RESET_MS);
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

    console.log(
      `${GameState.players[playerIndex].username} topped off for ` +
      `${10000 - GameState.players[playerIndex].stack}.`
    );

    GameState.players[playerIndex].stack = 10000;
    io.emit('top-off', GameState);
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
  GameState.pot = 0;
  GameState.board = [];
  GameState.deck = generateDeck();
  GameState.status = Status.LOBBY;
  GameState.street = Street.PRE_FLOP;
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
  GameState.winnerIndexes =
    calculateWinnerIndexesAtShowdown(GameState.board, GameState.hands, GameState.players);

  for (const index of GameState.winnerIndexes) {
    GameState.players[index].stack += GameState.pot / GameState.winnerIndexes.length;
  }

  io.emit('hand-finished', GameState);

  // TODO: Save hand history in some sort of database/persistence layer here.

  setTimeout(function() {
    resetHandState();
    io.emit('reset', GameState);
  }, WAIT_TO_RESET_MS);
}
