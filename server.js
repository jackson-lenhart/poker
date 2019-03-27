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
let hands = [];
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
let winner;

const streets = ['lobby', 'pre-flop', 'flop', 'turn', 'river', 'showdown', 'finished'];
let streetIndex = 0;

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
      const player = { username, stack: buyin, ready: false, folded: false };
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
          street: streets[streetIndex],
          player: players[i],
          position: getPosition(i)
        };

        if (streetIndex === 6) gatewayData.winner = winner;

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
      streetIndex++;

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
              streete: streets[streetIndex],
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

    const callData = { players, player, pot, contributions };

    const lac = getLatestAggressiveContribution();
    if (lac.type === 'big-blind') {
      callData.bigBlindOption = true;
    } else {
      if (shouldMoveToNextStreet('call', { lac })) {
        moveToNextStreet();

        callData.contributions = [];
        callData.board = board;
        callData.street = streets[streetIndex];
      }
    }

    callData.actionIndex = actionIndex;

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

// Position is 0 if big blind, 1 if small blind, 2, if dealer,
// 3 if cutoff, etc. Wraps around the bigBlindIndex
function getPosition(index) {
  if (index >= bigBlindIndex) {
    return index - bigBlindIndex;
  } else {
    return players.length - bigBlindIndex + index;
  }
}

function incrementActionIndex() {
  actionIndex++;
  if (actionIndex === players.length) actionIndex = 0;

  while (players[actionIndex].folded) {
    actionIndex++;
    if (actionIndex === players.length) actionIndex = 0;
  }

  return actionIndex;
}

function shouldMoveToNextStreet(eventType, infoObj) {
  if (eventType === 'check') {
    if (streets[streetIndex] === 'pre-flop') {
      if (infoObj.prevActionIndex === bigBlindIndex) return true;
      else return false;
    } else {
      if (players.length === 2) {
        // Because small blind acts last post-flop if only 2 players.
        if (infoObj.prevActionIndex === smallBlindIndex) return true;
        else return false;
      } else {
        if (actionIndex === smallBlindIndex) return true;
        else return false;
      }
    }
  } else {
    if (infoObj.lac.username === players[actionIndex].username) return true;
    else return false;
  }
}

function moveToNextStreet() {
  streetIndex++;
  contributions = [];

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
}

function getLatestAggressiveContribution() {
  let contrib;
  for (const c of contributions) {
    if (c.type === 'bet' || c.type === 'raise' || c.type === 'big-blind') {
      contrib = c;
    }
  }

  return contrib;
}

function resetHandState() {
  pot = 0;
  contributions = [];
  board = [];
  deck = generateDeck();
  hands = [];
  streetIndex = 0;

  for (const p of players) {
    if (p.folded) p.folded = false;
  }

  bigBlindIndex++;
  if (bigBlindIndex >= players.length) bigBlindIndex = 0;

  smallBlindIndex++;
  if (smallBlindIndex >= players.length) smallBlindIndex = 0;
}
