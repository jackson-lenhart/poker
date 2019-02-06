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

/* GLOBALS */

const players = [];
const hands = [];
const buyin = 10000;
let deck = generateDeck();
let smallBlindIndex = 0;
let bigBlindIndex = 1;
let actionIndex;
let pot = 0;
// 'contributions' array will be reset to empty after each round of betting.
// It is mainly to keep track of bets made before a raise
let contributions = [];
let board = [];

const stages = ['lobby', 'pre-flop', 'flop', 'turn', 'river', 'showdown'];
let stageIndex = 0;

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
  client.on('login', function(username) {
    if (players.some(p => p.username === username)) {
      client.emit('login-failure', `User ${username} already exists.`);
    }
    else {
      const player = { username, stack: buyin, ready: false };
      // A copy of players before adding the new one will be the opponents
      // of the player being added.
      players.push(player);
      client.username = player.username;

      client.emit('login-success', { player, players });

      client.broadcast.emit('join', players);
    }
  });

  client.on('gateway', function(username) {
    let playerFound = false;
    for (let i = 0; i < players.length; i++) {
      if (players[i].username === username) {
        playerFound = true;
        client.username = username;

        // Note: The only way of determining whether we are in the middle of
        // hand right now is whether or not finding the hand returns null.
        let hand = hands.find(h => h.username === players[i].username);
        if (hand) hand = hand.hand;

        const gatewayData = {
          players,
          actionIndex,
          pot,
          hand,
          contributions,
          board,
          stage: stages[stageIndex],
          player: players[i],
          position: getPosition(i)
        };

        client.emit('gateway-success', gatewayData);
        break;
      }
    }

    if (!playerFound) {
      client.emit('gateway-failure');
    }
  });

  client.on('ready', function(username) {
    for (const p of players) {
      if (p.username === username) {
        p.ready = true;
      }
    }

    // If everyone is ready, initialize a pot and deal out some hands
    if (!players.some(p => p.ready === false)) {
      stageIndex++;

      smallBlindIndex = bigBlindIndex - 1;
      if (smallBlindIndex < 0) {
        smallBlindIndex = players.length - 1;
      }

      // Post small and big blinds. Blinds hard coded to 50-100 for now (no ante)
      for (let i = 0; i < players.length; i++) {
        if (i === bigBlindIndex) {
          players[i].stack -= 100;
          contributions.push({ amount: 100, username: players[i].username, type: 'big-blind' });
        }
        else if (i === smallBlindIndex) {
          players[i].stack -= 50;
          // Unshifting this because the bets need to ordered smallest to greatest
          contributions.unshift({ amount: 50, username: players[i].username, type: 'small-blind' });
        }
      }
      pot = 150;

      // This is where we emit the 'hand' event to all clients.
      // Maybe it should be called 'start-hand'?
      let hand;
      let s;
      for (const k in io.sockets.connected) {
        s = io.sockets.connected[k];
        for (let i = 0; i < players.length; i++) {
          if (players[i].username === s.username) {

            // Just playing Texas Hold 'em for now. (Starting with 2 cards)
            hand = [extractRandomCard(deck), extractRandomCard(deck)];
            hands.push({ username: players[i].username, hand });

            // Action will always start out left of the big blind
            actionIndex = bigBlindIndex + 1;
            if (actionIndex >= players.length) {
              actionIndex = 0;
            }

            s.emit('start-hand', {
              hand,
              players,
              actionIndex,
              pot,
              contributions,
              stage: stages[stageIndex],
              player: players[i],
              position: getPosition(i)
            });
            break;
          }
        }
      }
    }
  });

  client.on('raise', function({ amount, username }) {
    players[actionIndex].stack -= amount;
    pot += amount
    contributions.push({ amount, username, type: 'raise' });

    incrementActionIndex();

    const raiseData = {
      players,
      pot,
      contributions,
      actionIndex,
      player: players[actionIndex]
    };

    io.sockets.emit('raise', raiseData);
  });

  client.on('call', function({ username, amountToCall }) {
    players[actionIndex].stack -= amountToCall;
    pot += amountToCall;
    contributions.push({ username, amount: amountToCall, type: 'call' });
    const player = players[actionIndex];

    incrementActionIndex();

    const callData = { players, player, pot, contributions, actionIndex };

    let latestContribution;
    for (const c of contributions) {
      if (c.type === 'bet' || c.type === 'raise' || c.type === 'big-blind') {
        latestContribution = c;
      }
    }

    // Find out whether action index is same as last bettor?
    if (players[actionIndex].username === latestContribution.username) {
      if (latestContribution.type === 'big-blind') {
        callData.bigBlindOption = true;
      }
      else {
        // In the body of this we are moving to the next 'street'

        // This shouldn't get bigger than or equal to the stages array size
        // because the 'call' message type should never be received when in
        // 'showdown' stage.
        stageIndex++;
        contributions = [];
        callData.contributions = [];

        // Action always starts to the 'left' of the button
        if (players.length === 2) actionIndex = bigBlindIndex;
        else actionIndex = smallBlindIndex;

        if (board.length === 0) {
          for (let i = 0; i < 3; i++) {
            board.push(extractRandomCard(deck));
          }
        }
        else if (board.length === 3) {
          board.push(extractRandomCard(deck));
        }
        else if (board.length === 4) {
          board.push(extractRandomCard(deck));
        }
        else if (board.length === 5) {
          // TODO: Showdown
        }

        callData.actionIndex = actionIndex;
        callData.board = board;
        callData.stage = stages[stageIndex];
      }
    }

    io.sockets.emit('call', callData);
  });

  client.on('bet', function({ amount, username }) {
    players[actionIndex].stack -= amount;
    pot += amount;
    contributions.push({ username, amount, type: 'bet' });
    const player = players[actionIndex];

    incrementActionIndex();

    const betData = {
      players,
      player,
      amount,
      pot,
      actionIndex,
      contributions
    };

    io.sockets.emit('bet', betData);
  });

  client.on('check', function({ username }) {
    const checkData = { username };
    const prevActionIndex = actionIndex;

    incrementActionIndex();

    // There is a better way to do this.
    if (prevActionIndex === bigBlindIndex && stages[stageIndex] === 'pre-flop'
      // Because small blind acts last post-flop if only 2 players.
      || prevActionIndex === smallBlindIndex && players.length === 2 && stages[stageIndex] !== 'pre-flop'
      || actionIndex === smallBlindIndex && players.length !== 2 && stages[stageIndex] !== 'pre-flop') {

      // If big blind checks or button checks, we move to next stage.
      stageIndex++;
      contributions = [];
      checkData.stage = stages[stageIndex];

      // Action always starts to the 'left' of the button
      if (players.length === 2) actionIndex = bigBlindIndex;
      else actionIndex = smallBlindIndex;

      if (board.length === 0) {
        for (let i = 0; i < 3; i++) {
          board.push(extractRandomCard(deck));
        }
      }
      else if (board.length === 3) {
        board.push(extractRandomCard(deck));
      }
      else if (board.length === 4) {
        board.push(extractRandomCard(deck));
      }
      else if (board.length === 5) {
        // TODO: Showdown
      }

      checkData.board = board;
      checkData.actionIndex = actionIndex;
    }
    else {
      checkData.actionIndex = actionIndex;
    }

    io.sockets.emit('check', checkData);
  });
});

server.listen(8080, function() {
  console.log('Listening on port 8080...');
});

// Position is 0 if big blind, 1 if small blind, 2, if dealer,
// 3 if cutoff, etc. Wraps around the bigBlindIndex
function getPosition(index) {
  if (index >= bigBlindIndex) {
    return index - bigBlindIndex;
  }
  else {
    return players.length - bigBlindIndex + index;
  }
}

function incrementActionIndex() {
  actionIndex++;
  if (actionIndex === players.length) actionIndex = 0;
  return actionIndex;
}
