const express = require('express');
const WebSocket = require('ws');

const app = express();

const wss = new WebSocket.Server({ port: 9090 });

// Only one table for now with a 10,000 buyin
const players = [];
const hands = [];
const buyin = 100000
let handInProgress = false;

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
          players.push({ username: messageData.username, stack: buyin });
          const loginData = { type: 'login', username: messageData.username };
          ws.send(JSON.stringify(loginData));
        }
        break;

      // This is for return visits in the same session (i.e. refresh browser)
      case 'gateway':
        const player = players.find(p => p.username === messageData.username);
        if (player) {
          const gatewayData = { type: 'gateway', player };
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
      default:
        console.error('Unrecognized message type:', messageData.type);
    }
  });

  /*app.get('/gateway/:username', function(req, res) {
    const username = req.params.username.toLowerCase();

    if (usernames.includes(username)) {
      // We are logged in
      if (username in activeSessions === false) {
        activeSessions[username] = true;
      }

      res.sendStatus(200);
    }
    else {
      // Oooohhh!! suspicious!
      res.sendStatus(401);
    }
  });*/

  /*players.push({ id: uuid(), stack: buyin });

  if (players.length === 1) {
    ws.send('Waiting on others to join');
  }
  else if (players.length >= 2 && !handInProgress) {
    wss.clients.forEach(function(client) {
      client.send('New player joined. Starting now!');
    });

    handInProgress = true;
  }
  else if (players.length >= 2) {
    wss.clients.forEach(function(client) {
      client.send('New player joined!');
    });
  }*/

  // DEBUG:
  console.log(players);
});
