(function() {
  'use strict';

  /* GLOBALS */

  var username = localStorage.getItem('username');
  var GameState;
  var playerIndex;
  var STREETS = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];

  /* COMPONENTS */

  var container;

  // Loading spinner
  var spinner = document.createElement('div');
  spinner.id = 'spinner';
  var spinnerText = document.createTextNode('Loading...');
  spinner.appendChild(spinnerText);

  // Join form
  var joinForm = document.createElement('form');
  joinForm.id = 'join-form';
  // join function defined below
  joinForm.onsubmit = join;

  var usernameLabel = document.createElement('label');
  usernameLabel.htmlFor = 'username';
  usernameLabel.textContent = 'Username:';

  var usernameField = document.createElement('input');
  usernameField.type = 'text';
  usernameField.name = 'username';
  usernameField.id = 'username';

  joinForm.appendChild(usernameLabel);
  joinForm.appendChild(usernameField);

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

  // Hand
  var handContainer = document.createElement('div');
  var handTextElement = document.createElement('h3');

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

  var handOverDisplay = document.createElement('div');

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

  // The whole thing relies on socket connection.
  var socket = io();

  socket.on('connect', function() {
    if (username) {
      socket.emit('gateway', username);
    } else {
      container.removeChild(spinner);
      container.appendChild(joinForm);
    }
  });

  socket.on('join-success', function(joinData) {
    GameState = joinData.GameState;
    playerIndex = joinData.playerIndex;

    initGame();

    localStorage.setItem('username', GameState.players[playerIndex].username);
  });

  socket.on('join-failure', function(msg) {
    alert(msg);
    container.removeChild(spinner);
    container.appendChild(joinForm);
  });

  socket.on('join', function(_GameState) {
    GameState = _GameState;
    // Render Ready button if we just got our first opponent
    if (GameState.players.length === 2) {
      if (waitingText.parentNode === game) game.removeChild(waitingText);
      game.appendChild(readyButton);
    }
  });

  socket.on('gateway-success', function(gatewayData) {
    GameState = gatewayData.GameState;
    playerIndex = gatewayData.playerIndex;

    if (GameState.statusIndex === 0) {
      if (GameState.players[playerIndex].ready) resumeGame();
      else initGame();
    } else if (GameState.statusIndex === 1) {
      resumeHand();
    } else if (GameState.statusIndex === 2) {
      /* TODO */
    }
  });

  socket.on('gateway-failure', function(gatewayFailureData) {
    container.removeChild(spinner);
    container.appendChild(joinForm);
    localStorage.removeItem('username');

    console.log('Gateway failure:', gatewayFailureData.msg);
  });

  socket.on('start-hand', function(_GameState) {
    GameState = _GameState;
    initHand();

    game.removeChild(readyWaitingText);
  });

  socket.on('raise', function(_GameState) {
    GameState = _GameState;

    // Update view
    stack.textContent = GameState.players[playerIndex].stack;
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();

    // Render bet/check or raise/call/fold input if action is on us
    if (GameState.actionIndex === playerIndex) renderBetOrRaiseForm();
  });

  socket.on('call', function(callData) {
    GameState = callData.GameState;

    // Update view
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;

    if (callData.shouldMoveToNextStreet) {
      boardTextElement.textContent = JSON.stringify(GameState.board);
      // Optimize
      game.insertBefore(boardContainer, potContainer);

      if (GameState.actionIndex === playerIndex) {
        game.insertBefore(betForm, divider);
      }

      updatePlayersBar();
    } else if (GameState.actionIndex === playerIndex) {
      if (callData.bigBlindOption) {
        game.insertBefore(betForm, divider);
      } else {
        updateBetText();
        game.insertBefore(raiseForm, divider);
        game.insertBefore(betText, raiseForm);
      }
    }
  });

  socket.on('check', function(checkData) {
    actionIndex = checkData.actionIndex;

    if (checkData.street && checkData.street !== street) {
      street = checkData.street;
      board = checkData.board;

      switch (street) {
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
          console.error(`Unrecognized street ${street}`);
      }
    }

    if (players[actionIndex].username === player.username) {
      game.insertBefore(betForm, divider);
    }
  });

  socket.on('bet', function(_GameState) {
    GameState = _GameState;

    // Update view
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;

    if (GameState.actionIndex === playerIndex) {
      updateBetText();
      game.insertBefore(raiseForm, divider);
      game.insertBefore(betText, raiseForm);
    }
  });

  socket.on('fold', function(foldData) {
    players = foldData.players;
    actionIndex = foldData.actionIndex;

    updatePlayersBar();

    if (players[actionIndex].username === player.username) {
      updateBetText();
      game.insertBefore(raiseForm, divider);
      game.insertBefore(betText, raiseForm);
    }
  });

  socket.on('hand-finished', function(finishedData) {
    players = finishedData.players;
    winner = finishedData.winner;
    street = 'finished';

    for (var p of players) {
      if (p.username === player.username) player = p;
    }
    stack.textContent = player.stack;

    var handOverText = document.createTextNode(
      'Hand finished. ' + winner.username + ' wins ' + pot + '.'
    );
    handOverDisplay.appendChild(handOverText);

    game.prepend(handOverDisplay);

    updatePlayersBar();
  });

  function join(event) {
    event.preventDefault();

    var container = document.getElementById('container');

    var usernameInput = document.getElementById('username');
    var username = usernameInput.value;

    if (username === '') {
      usernameInput.style.color = 'red';
      alert('Error: please enter a username');
      return;
    }

    container.removeChild(joinForm);
    container.appendChild(spinner);

    socket.emit('join', username);
  }

  // If player has just refreshed the page and has not signified readiness,
  // or if player has just logged in, this will be called.
  function initGame() {
    game.appendChild(playerText);

    var br = document.createElement('br');
    game.appendChild(br);

    stack.textContent = GameState.players[playerIndex].stack;
    game.appendChild(stack);

    if (GameState.players.length >= 2) game.appendChild(readyButton);
    else game.appendChild(waitingText);

    container.removeChild(spinner);
    container.appendChild(game);
  }

  function signifyReadiness() {
    game.removeChild(readyButton);
    game.appendChild(readyWaitingText);

    socket.emit('ready', playerIndex);
  }

  // If player has signified readiness
  function resumeGame() {
    game.appendChild(playerText);

    var br = document.createElement('br');
    game.appendChild(br);

    stack.textContent = GameState.players[playerIndex].stack;
    game.appendChild(stack);

    game.appendChild(readyWaitingText);

    container.removeChild(spinner);
    container.appendChild(game);
  }

  function renderBetOrRaiseForm() {
    if (GameState.actions[STREETS[GameState.streetIndex]].some(x => x.type !== 'CHECK')) {
      updateBetText();

      game.insertBefore(raiseForm, divider);
      game.insertBefore(betText, raiseForm);
    } else {
      game.prepend(betForm);
    }
  }

  function initHand() {
    game.prepend(divider);

    // Render bet/check or raise/call/fold input if action is on us
    if (GameState.actionIndex === playerIndex) {
      renderBetOrRaiseForm();
    }

    // Render hand
    handTextElement.textContent = JSON.stringify(GameState.hands[playerIndex]);
    handContainer.appendChild(handTextElement);
    game.prepend(handContainer);

    // Update stack text
    stack.textContent = GameState.players[playerIndex].stack;

    // Render pot
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    game.prepend(potContainer);

    updatePlayersBar();
    game.prepend(playersBar);
  }

  // For page refresh/initial load during hand
  function resumeHand() {
    game.appendChild(divider);
    game.appendChild(playerText);

    if (GameState.actionIndex === playerIndex) {
      renderBetOrRaiseForm();
    }

    var br = document.createElement('br');
    game.appendChild(br);

    stack.textContent = GameState.players[playerIndex].stack;
    game.appendChild(stack);

    // Render hand
    var handContainer = document.createElement('div');
    var handTextElement = document.createElement('h3');
    handTextElement.textContent = JSON.stringify(GameState.hands[playerIndex]);
    handContainer.appendChild(handTextElement);
    game.prepend(handContainer);

    // Render pot
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    game.prepend(potContainer);

    if (GameState.board.length > 0) {
      boardTextElement.textContent = JSON.stringify(GameState.board);

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
    for (var i = 0; i < GameState.players.length; i++) {
      playerItem = document.createElement('span');

      if (i === GameState.actionIndex && GameState.statusIndex !== 2) {
        playerItem.className = 'player-item-has-action';
      } else if (GameState.players[i].folded) {
        playerItem.className = 'player-item-folded';
      } else {
        playerItem.className = 'player-item';
      }

      if (i === playerIndex) {
        playerItem.textContent = 'You';
      } else {
        playerItem.textContent = GameState.players[i].username + ': ' + GameState.players[i].stack;
      }

      playersBar.appendChild(playerItem);
    }
  }

  function updateBetText() {
    var betTotal = GameState.currentBetTotal;
    var amountToCall = calculateAmountToCall();

    betText.textContent = 'Bet is ' + betTotal + ', ' + amountToCall + ' to call.';
  }

  function flop() {
    boardTextElement.textContent = JSON.stringify(GameState.board);
    game.insertBefore(boardContainer, potContainer);

    if (GameState.actionIndex === playerIndex) {
      game.insertBefore(betForm, divider);
    }

    updatePlayersBar();
  }

  function turn() {
    boardTextElement.textContent = JSON.stringify(GameState.board);

    if (GameState.actionIndex === playerIndex) {
      game.insertBefore(betForm, divider);
    }

    updatePlayersBar();
  }

  function river() {
    boardTextElement.textContent = JSON.stringify(GameState.board);

    if (GameState.actionIndex === playerIndex) {
      game.insertBefore(betForm, divider);
    }

    updatePlayersBar();
  }

  function bet(event) {
    event.preventDefault();

    var amount = betInputField.value;
    if (amount === '') {
      return;
    }

    amount = parseInt(amount, 10);
    if (typeof amount !== 'number' || amount < 100 // <-- big blind
      || amount > GameState.players[playerIndex].stack) {
      return;
    }

    betInputField.value = '';
    game.removeChild(betForm);

    socket.emit('bet', { playerIndex: playerIndex, amount: amount });
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
      return;
    }

    amount = parseInt(amount, 10);
    // This will not catch a particular illegal small blind vs big blind raise yet.
    if (typeof amount !== 'number' || amount < 100 || amount < calculateAmountToCall() * 2) {
      return;
    }

    if (amount > GameState.players[playerIndex].stack) {
      return;
    }

    raiseInputField.value = '';
    game.removeChild(raiseForm);
    game.removeChild(betText);

    socket.emit('raise', { amount: amount, playerIndex: playerIndex });
  }

  function call() {
    var amountToCall = calculateAmountToCall();
    socket.emit('call', { playerIndex: playerIndex, amountToCall: amountToCall });

    game.removeChild(raiseForm);
    game.removeChild(betText);
  }

  function fold() {
    player.folded = true;
    game.removeChild(raiseForm);
    game.removeChild(betText);
    game.removeChild(handContainer);

    socket.emit('fold', { username: player.username });
  }

  function calculateAmountToCall() {
    // Sum up all bets from player. Difference between 'currentBet' and 'myBet'
    // is the amount required to call.
    var myBetTotal = 0;
    for (var a of GameState.actions[STREETS[GameState.streetIndex]]) {
      if (a.playerIndex === playerIndex && a.amount) {
        myBetTotal += a.amount
      }
    }

    return GameState.currentBetTotal - myBetTotal;
  }
})();
