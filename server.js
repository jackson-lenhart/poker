const express = require('express');
const uuid = require('uuid/v1');
const WebSocketServer = require('ws').Server;

const app = express();

const wss = new WebSocketServer({ port: 40510 });

// Only one table for now
const players = [];
const hands = [];

app.listen(8080, function() {
  console.log('Listening on port 8080...');
});

wss.on('connection', function(ws) {
  ws.on('message', function(message) {
    console.log('Message received from client:', message);
  });

  ws.send('Connected from server');
});

app.use(express.static('public'));

app.get('/', function(req, res) {
  res.sendFile('index.html');
});
