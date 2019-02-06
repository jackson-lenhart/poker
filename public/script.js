(function() {
  'use strict';

  /* GLOBALS */

  var container;
  var username = localStorage.getItem('username');
  var players;
  var player;
  var hand;
  var pot;
  var position;
  var board = [];
  var stage;
  var actionIndex;
  var contributions;

  /* COMPONENTS */

  // Loading spinner
  var spinner = document.createElement('div');
  spinner.id = 'spinner';
  var spinnerText = document.createTextNode('Loading...');
  spinner.appendChild(spinnerText);

  // Login form
  var loginForm = document.createElement('form');
  loginForm.id = 'login-form';
  // login function defined below
  loginForm.onsubmit = login;

  var usernameLabel = document.createElement('label');
  usernameLabel.htmlFor = 'username';
  usernameLabel.textContent = 'Username:';

  var usernameField = document.createElement('input');
  usernameField.type = 'text';
  usernameField.name = 'username';
  usernameField.id = 'username';

  loginForm.appendChild(usernameLabel);
  loginForm.appendChild(usernameField);

  // Game
  var game = document.createElement('div');
  game.id = 'game';

  // Ready button (player clicks to signify ready to begin new hand)
  var readyButton = document.createElement('button');
  readyButton.type = 'button';
  readyButton.textContent = 'Ready';
  readyButton.onclick = signifyReadiness;

  // Pot
  var potContainer = document.createElement('div');
  potContainer.className = 'pot';
  var potTextElement = document.createElement('h2');
  potContainer.appendChild(potTextElement);

  // Stack
  var stack = document.createElement('div');
  stack.id = 'stack';

  // Players bar
  var playersBar = document.createElement('div');

  // The board
  var boardContainer = document.createElement('div');
  var boardTextElement = document.createElement('h5');
  boardContainer.appendChild(boardTextElement);

  // Bet text
  var betText = document.createElement('p');

  // Bet/check form
  var betForm = document.createElement('form');
  betForm.onsubmit = bet;

  var betInputLabel = document.createElement('label');
  betInputLabel.htmlFor = 'bet';
  betInputLabel.textContent = 'Bet amount:';

  var betInputField = document.createElement('input');
  betInputField.type = 'text';
  betInputField.name = 'bet';
  betInputField.id = 'bet';

  var betButton = document.createElement('button');
  betButton.type = 'submit';
  betButton.textContent = 'Bet';

  var checkButton = document.createElement('button');
  checkButton.type = 'button';
  checkButton.onclick = check;
  checkButton.textContent = 'Check';

  betForm.appendChild(betInputLabel);
  betForm.appendChild(betInputField);
  betForm.appendChild(betButton);
  betForm.appendChild(checkButton);

  // Raise/fold form
  var raiseForm = document.createElement('form');
  raiseForm.id = 'raise-form';
  raiseForm.onsubmit = raise;

  var raiseInputLabel = document.createElement('label');
  raiseInputLabel.htmlFor = 'raise';
  raiseInputLabel.textContent = 'Raise:';

  var raiseInputField = document.createElement('input');
  raiseInputField.type = 'text';
  raiseInputField.name = 'raise';
  raiseInputField.id = 'raise';

  var raiseButton = document.createElement('button');
  raiseButton.type = 'submit';
  raiseButton.textContent = 'Raise';

  var callButton = document.createElement('button');
  callButton.type = 'button';
  callButton.onclick = call;
  callButton.textContent = 'Call';

  var foldButton = document.createElement('button');
  foldButton.type = 'button';
  foldButton.onclick = fold;
  foldButton.textContent = 'Fold';

  raiseForm.appendChild(raiseInputLabel);
  raiseForm.appendChild(raiseInputField);
  raiseForm.appendChild(raiseButton);
  raiseForm.appendChild(callButton);
  raiseForm.appendChild(foldButton);

  var divider = document.createElement('hr');
  divider.id = 'divider';

  // Waiting text (this probably shouldn't be global but w/e)
  var waitingText = document.createTextNode('Waiting for others to join...');
  var readyWaitingText = document.createTextNode('Waiting for others to signify readiness');

  var playerText = document.createTextNode('You');

  window.onload = function() {
    // Our main container where we dynamically inject html
    container = document.getElementById('container');
    container.appendChild(spinner);
  };

  var socket = io();

  socket.on('connect', function() {
    if (username) {
      socket.emit('gateway', username);
    }
    else {
      container.removeChild(spinner);
      container.appendChild(loginForm);
    }
  });

  socket.on('login-success', function(loginData) {
    player = loginData.player;
    players = loginData.players;
    stage = 'lobby';

    initGame();

    localStorage.setItem('username', player.username);
  });

  socket.on('login-failure', function(msg) {
    alert(msg);
    container.removeChild(spinner);
    container.appendChild(loginForm);
  });

  socket.on('join', function(_players) {
    players = _players;
    // Render Ready button if we just got our first opponent
    if (players.length === 2) {
      if (waitingText.parentNode === game) game.removeChild(waitingText);
      game.appendChild(readyButton);
    }
  });

  socket.on('gateway-success', function(gatewayData) {
    players = gatewayData.players;
    player = gatewayData.player;
    // This will be null if we're not in hand
    hand = gatewayData.hand;
    pot = gatewayData.pot;
    stage = gatewayData.stage;
    board = gatewayData.board;
    actionIndex = gatewayData.actionIndex;
    contributions = gatewayData.contributions;

    if (hand) resumeHand();
    else if (player.ready) resumeGame();
    else initGame();
  });

  socket.on('gateway-failure', function() {
    container.removeChild(spinner);
    container.appendChild(loginForm);
    localStorage.removeItem('username');
  });

  socket.on('start-hand', function(handData) {
    hand = handData.hand;
    players = handData.players;
    player = handData.player;
    pot = handData.pot;
    stage = 'pre-flop';
    actionIndex = handData.actionIndex;
    position = handData.position;
    contributions = handData.contributions;

    initHand();
    game.removeChild(readyWaitingText);
  });

  socket.on('raise', function(raiseData) {
    players = raiseData.players;
    if (player.username === raiseData.player.username) player = raiseData.player;
    pot = raiseData.pot;
    contributions = raiseData.contributions;
    actionIndex = raiseData.actionIndex;

    // Update view
    stack.textContent = player.stack;
    potTextElement.textContent = 'Pot: ' + pot;
    updatePlayersBar();

    // Render bet/check or raise/call/fold input if action is on us
    if (players[actionIndex].username === player.username) {
      if (contributions.length > 0) {
        updateBetText();

        game.insertBefore(raiseForm, divider);
        game.insertBefore(betText, raiseForm);
      }
      else {
        game.prepend(betForm);
      }
    }
  });

  socket.on('call', function(callData) {
    players = callData.players;
    pot = callData.pot;
    contributions = callData.contributions;
    actionIndex = callData.actionIndex;

    // Update view
    potTextElement.textContent = 'Pot: ' + pot;
    updatePlayersBar();

    if (callData.player.username === player.username) {
      player = callData.player;
      stack.textContent = player.stack;
      game.removeChild(raiseForm);
      game.removeChild(betText);
    }

    if (callData.stage && callData.stage !== stage) {
      stage = callData.stage;
      board = callData.board;

      switch (stage) {
        case 'flop':
          flop();
          break;
        case 'turn':
          turn();
          break;
        case 'river':
          river();
          break;
        default:
          console.error(`Unrecognized stage ${stage}`);
      }
    }
    else {
      if (players[actionIndex].username === player.username) {
        if (callData.bigBlindOption) {
          game.insertBefore(betForm, divider);
        }
        else {
          updateBetText();
          game.insertBefore(raiseForm, divider);
          game.insertBefore(betText, raiseForm);
        }
      }
    }
  });

  socket.on('check', function(checkData) {
    actionIndex = checkData.actionIndex;

    if (checkData.stage && checkData.stage !== stage) {
      stage = checkData.stage;
      board = checkData.board;

      switch (stage) {
        case 'flop':
          flop();
          break;
        case 'turn':
          turn();
          break;
        case 'river':
          river();
          break;
        default:
          console.error(`Unrecognized stage ${stage}`);
      }
    }

    if (players[actionIndex].username === player.username) {
      game.insertBefore(betForm, divider);
    }
  });

  socket.on('bet', function(betData) {
    players = betData.players;
    pot = betData.pot;
    contributions = betData.contributions;
    actionIndex = betData.actionIndex;

    // Update view
    potTextElement.textContent = 'Pot: ' + pot;
    updatePlayersBar();

    if (betData.player.username === player.username) {
      player = betData.player;
      stack.textContent = player.stack;
    }
    else {
      if (players[actionIndex].username === player.username) {
        updateBetText();
        game.insertBefore(raiseForm, divider);
        game.insertBefore(betText, raiseForm);
      }
    }
  });

  function login(event) {
    event.preventDefault();

    var container = document.getElementById('container');

    var usernameInput = document.getElementById('username');
    var username = usernameInput.value;

    if (username === '') {
      usernameInput.style.color = 'red';
      alert('Error: please enter a username');
      return;
    }

    container.removeChild(loginForm);
    container.appendChild(spinner);

    // var loginData = { type: 'login', username: username };
    socket.emit('login', username);
    // ws.send(JSON.stringify(loginData));
  }

  // If player has just refreshed the page and has not signified readiness,
  // or if player has just logged in, this will be called.
  function initGame() {
    game.appendChild(playerText);

    var br = document.createElement('br');
    game.appendChild(br);

    stack.textContent = player.stack;
    game.appendChild(stack);

    if (players.length >= 2) game.appendChild(readyButton);
    else game.appendChild(waitingText);

    container.removeChild(spinner);
    container.appendChild(game);
  }

  function signifyReadiness() {
    game.removeChild(readyButton);
    game.appendChild(readyWaitingText);

    socket.emit('ready', player.username);
  }

  // If player has signified readiness
  function resumeGame() {
    game.appendChild(playerText);

    var br = document.createElement('br');
    game.appendChild(br);

    stack.textContent = player.stack;
    game.appendChild(stack);

    game.appendChild(readyWaitingText);

    container.removeChild(spinner);
    container.appendChild(game);
  }

  function initHand() {
    game.prepend(divider);

    // Render bet/check or raise/call/fold input if action is on us
    if (players[actionIndex].username === player.username) {
      if (contributions.length > 0) {
        updateBetText();
        game.prepend(raiseForm);
        game.prepend(betText);
      }
      else {
        game.prepend(betForm);
      }
    }

    // Render hand
    var handContainer = document.createElement('div');
    var handTextElement = document.createElement('h3');
    handTextElement.textContent = JSON.stringify(hand);
    handContainer.appendChild(handTextElement);
    game.prepend(handContainer);

    // Update stack text
    stack.textContent = player.stack;

    // Render pot
    potTextElement.textContent = 'Pot: ' + pot;
    game.prepend(potContainer);

    updatePlayersBar();
    game.prepend(playersBar);
  }

  // For page refresh/initial load during hand
  function resumeHand() {
    // Render bet/check or raise/call/fold input if action is on us
    if (players[actionIndex].username === player.username) {
      if (contributions.length > 0) {
        updateBetText();
        game.appendChild(betText);

        game.appendChild(raiseForm);
      }
      else {
        game.appendChild(betForm);
      }
    }

    game.appendChild(divider);

    game.appendChild(playerText);

    var br = document.createElement('br');
    game.appendChild(br);

    stack.textContent = player.stack;
    game.appendChild(stack);

    // Render hand
    var handContainer = document.createElement('div');
    var handTextElement = document.createElement('h3');
    handTextElement.textContent = JSON.stringify(hand);
    handContainer.appendChild(handTextElement);
    game.prepend(handContainer);

    // Render pot
    potTextElement.textContent = 'Pot: ' + pot;
    game.prepend(potContainer);

    if (board.length > 0) {
      boardTextElement.textContent = JSON.stringify(board);

      game.prepend(boardContainer);
    }

    updatePlayersBar();
    game.prepend(playersBar);

    container.removeChild(spinner);
    container.appendChild(game);
  }

  function updatePlayersBar() {
    // Removing the players bar if its already there.
    // Might want to optimize this...
    playersBar.innerHTML = '';

    var playerItem;
    for (var i = 0; i < players.length; i++) {
      playerItem = document.createElement('span');

      if (i === actionIndex) playerItem.className = 'player-item-has-action';
      else playerItem.className = 'player-item';

      if (players[i].username === player.username) {
        playerItem.textContent = 'You';
      }
      else {
        playerItem.textContent = players[i].username + ': ' + players[i].stack;
      }

      playersBar.appendChild(playerItem);
    }
  }

  function updateBetText() {
    var currentBet = getCurrentBetTotal();
    // Note: inefficient. Calculating total bet twice
    var amountToCall = calculateAmountToCall();

    betText.textContent = 'Bet is ' + currentBet + ', ' + amountToCall + ' to call.';
  }

  function flop() {
    boardTextElement.textContent = JSON.stringify(board);
    game.insertBefore(boardContainer, potContainer);

    if (players[actionIndex].username === player.username) {
      game.insertBefore(betForm, divider);
    }

    updatePlayersBar();
  }

  function turn() {
    boardTextElement.textContent = JSON.stringify(board);

    if (players[actionIndex].username === player.username) {
      game.insertBefore(betForm, divider);
    }

    updatePlayersBar();
  }

  function river() {
    boardTextElement.textContent = JSON.stringify(board);

    if (players[actionIndex].username === player.username) {
      game.insertBefore(betForm, divider);
    }

    updatePlayersBar();
  }

  function bet(event) {
    event.preventDefault();

    // TODO: validate amount more thoroughly
    var amount = betInputField.value;
    if (amount === '') {
      alert('Please enter an amount.');
      return;
    }

    amount = parseInt(amount, 10);
    if (amount > player.stack) {
      alert('Please enter an amount less than your stack');
      return;
    }

    betInputField.value = '';
    game.removeChild(betForm);

    var betData = { amount: amount, username: player.username };
    socket.emit('bet', betData);
  }

  function check() {
    event.preventDefault();

    betInputField.value = '';
    game.removeChild(betForm);

    var checkData = { username: player.username };
    socket.emit('check', checkData);
  }

  function raise(event) {
    event.preventDefault();

    // TODO: validate amount more thoroughly
    var amount = raiseInputField.value
    if (amount === '') {
      alert('Please enter an amount.');
      return;
    }

    amount = parseInt(amount, 10);
    if (amount > player.stack) {
      alert('Please enter an amount less than your stack');
      return;
    }

    raiseInputField.value = '';
    game.removeChild(raiseForm);
    game.removeChild(betText);

    player.stack -= amount;

    var raiseData = { amount: amount, username: player.username };

    socket.emit('raise', raiseData);
  }

  function call() {
    var amountToCall = calculateAmountToCall();
    player.stack -= amountToCall;

    socket.emit('call', { username: player.username, amountToCall: amountToCall });
  }

  function fold() {
    // TODO:
  }

  function calculateAmountToCall() {
    // Sum up all bets from the latest bettor to get the current bet
    var latestContribution = contributions[contributions.length - 1];
    var latestContributor = latestContribution.username;
    var currentBet = latestContribution.amount;
    for (var i = 0; i < contributions.length - 1; i++) {
      if (contributions[i].username === latestContributor) {
        currentBet += contributions[i].amount;
      }
    }

    // Sum up all bets from player. Difference between 'currentBet' and 'myBet'
    // is the amount required to call.
    var myBet = 0;
    for (var i = 0; i < contributions.length - 1; i++) {
      if (contributions[i].username === player.username) {
        myBet += contributions[i].amount;
      }
    }

    return currentBet - myBet;
  }

  function getCurrentBetTotal() {
    // Sum up all bets from the latest bettor to get the current bet
    var latestContribution = contributions[contributions.length - 1];
    var latestContributor = latestContribution.username;
    var currentBet = latestContribution.amount;
    for (var i = 0; i < contributions.length - 1; i++) {
      if (contributions[i].username === latestContributor) {
        currentBet += contributions[i].amount;
      }
    }

    return currentBet;
  }
})();
