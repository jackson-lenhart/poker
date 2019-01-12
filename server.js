const express = require('express');
const WebSocket = require('ws');

const { generateDeck, extractRandomCard } = require('./poker');

const app = express();

const wss = new WebSocket.Server({ port: 9090 });

// Only one table for now with a 10,000 buyin.
// Will probably use a message queue for this eventually
// rather than having the server be stateful.
const players = [];
const hands = [];
const buyin = 100000;
let deck = generateDeck();

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
          const opponents = players.slice();
          players.push(player);
          ws.username = player.username;

          const loginData = { type: 'login', player, opponents };
          ws.send(JSON.stringify(loginData));

          const joinData = { type: 'join', playerJoined: player };
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
        const player = players.find(p => p.username === messageData.username);
        if (player) {
          const opponents = players.filter(p => p.username !== player.username);
          // Note: The only way of determining whether we are in the middle of
          // hand right now is whether or not finding the hand returns null.
          const hand = hands.find(h => h.username === player.username);

          const gatewayData = { type: 'gateway', player, opponents, hand: hand.hand };
          ws.send(JSON.stringify(gatewayData));
        }
        else {
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

        // If everyone is ready, deal out some hands
        if (!players.some(p => p.ready === false)) {
          let player;
          let hand;
          wss.clients.forEach(function(client) {
            player = players.find(p => p.username === client.username);
            if (player) {
              // Just playing Texas Hold 'em for now. (Starting with 2 cards)
              hand = [extractRandomCard(deck), extractRandomCard(deck)];
              hands.push({ username: player.username, hand });

              client.send(JSON.stringify({ type: 'hand', hand }));
            }
          });
        }
        break;

      default:
        console.error('Unrecognized message type:', messageData.type);
    }
  });

  // DEBUG:
  console.log(players);
});
