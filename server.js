const express = require('express');
const WebSocket = require('ws');

const { generateDeck, extractRandomCard } = require('./poker');

const app = express();

const wss = new WebSocket.Server({ port: 9090 });

// Only one table for now with a 10,000 buyin.
// Will probably use a message queue for this eventually
// rather than having the server be stateful.

/* GLOBALS */

const players = [];
const hands = [];
const buyin = 10000;
let deck = generateDeck();
let bigBlindIndex = 0;
let smallBlindIndex = 1;
let actionIndex;
let pot = 0;
// 'bets' array will be reset to empty after each round of betting.
// It is mainly to keep track of bets made before a raise
let bets = [];

app.listen(8080, function() {
  console.log('Listening on port 8080...');
});

app.use(express.static('public'));

app.get('/', function(req, res) {
  res.sendFile('index.html');
});

wss.on('connection', function(ws) {
  ws.on('message', function(message) {
    const messageData = JSON.parse(message);

    switch (messageData.type) {

      // This is effectively a signup and login combined (lol)
      case 'login':
        // we just reject if the username already exists
        if (players.some(p => p.username === messageData.username)) {
          const loginFailureData = {
            type: 'login-failure',
            msg: `User ${messageData.username} already exists.`
          };
          ws.send(JSON.stringify(loginFailureData));
        }
        else {
          const player = { username: messageData.username, stack: buyin, ready: false };
          // A copy of players before adding the new one will be the opponents
          // of the player being added.
          players.push(player);
          ws.username = player.username;

          const loginData = { type: 'login', player, players };
          ws.send(JSON.stringify(loginData));

          const joinData = { type: 'join', players };
          const joinDataSerialized = JSON.stringify(joinData);

          // Broadcast to rest of clients that someone joined
          wss.clients.forEach(function(client) {
            if (client !== ws) {
              client.send(joinDataSerialized);
            }
          });
        }
        break;

      // This is for return visits in the same session (i.e. refresh browser)
      case 'gateway':
        let playerFound = false;
        for (let i = 0; i < players.length; i++) {
          if (players[i].username === messageData.username) {

            // Note: The only way of determining whether we are in the middle of
            // hand right now is whether or not finding the hand returns null.
            let hand = hands.find(h => h.username === players[i].username);
            if (hand) hand = hand.hand;

            const gatewayData = {
              players,
              actionIndex,
              pot,
              hand,
              bets,
              player: players[i],
              position: getPosition(i),
              type: 'gateway'
            };
            ws.send(JSON.stringify(gatewayData));

            playerFound = true;
            break;
          }
        }

        if (!playerFound) {
          const gatewayFailureData = {
            type: 'gateway-failure',
            msg: `Could not find player with username ${messageData.username}`
          };
          ws.send(JSON.stringify(gatewayFailureData));
        }
        break;

      case 'ready':
        for (const p of players) {
          if (p.username === messageData.username) {
            p.ready = true;
          }
        }

        // If everyone is ready, initialize a pot and deal out some hands
        if (!players.some(p => p.ready === false)) {
          smallBlindIndex = bigBlindIndex + 1;
          if (smallBlindIndex === players.length) {
            smallBlindIndex = 0;
          }

          // Post small and big blinds. Blinds hard coded to 50-100 for now (no ante)
          for (let i = 0; i < players.length; i++) {
            if (i === bigBlindIndex) {
              players[i].stack -= 100;
              bets.push({ amount: 100, username: players[i].username });
            }
            else if (i === smallBlindIndex) {
              players[i].stack -= 50;
              // Unshifting this because the bets need to ordered smallest to greatest
              bets.unshift({ amount: 50, username: players[i].username });
            }
          }
          pot = 150;

          // This is where we emit the 'hand' event to all clients.
          // Maybe it should be called 'start-hand'?
          let hand;
          wss.clients.forEach(function(client) {
            for (let i = 0; i < players.length; i++) {
              if (players[i].username === client.username) {

                // Just playing Texas Hold 'em for now. (Starting with 2 cards)
                hand = [extractRandomCard(deck), extractRandomCard(deck)];
                hands.push({ username: players[i].username, hand });

                // Action will always start out left of the big blind
                actionIndex = bigBlindIndex - 1;
                if (actionIndex < 0) {
                  actionIndex = players.length - 1;
                }

                client.send(JSON.stringify({
                  hand,
                  players,
                  actionIndex,
                  pot,
                  bets,
                  type: 'hand',
                  player: players[i],
                  position: getPosition(i)
                }));
                break;
              }
            }
          });
        }
        break;

      case 'raise':
        players[actionIndex].stack -= messageData.amount;
        pot += messageData.amount
        bets.push({ amount: messageData.amount, username: messageData.username });

        actionIndex++;
        if (actionIndex === players.length) actionIndex = 0;

        const raiseData = JSON.stringify({ players, pot, bets, actionIndex, type: 'raise' });
        wss.clients.forEach(function(client) {
          client.send(raiseData);
        });
        break;

      default:
        console.error('Unrecognized message type:', messageData.type);
    }
  });
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
