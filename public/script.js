var ws = new WebSocket('ws://localhost:40510');

ws.onopen = function() {
  ws.send('Connected from client');
};

ws.onmessage = function(message) {
  console.log('Message received from server:', message);
};
