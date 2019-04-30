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

  // Top off button
  var topOffButton = document.createElement('button');
  topOffButton.type = 'button';
  topOffButton.textContent = 'Top off';
  topOffButton.onclick = topOff;

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

  var betAllinButton = document.createElement('button');
  betAllinButton.type = 'button';
  betAllinButton.onclick = allin.bind(null, 'bet');
  betAllinButton.textContent = 'All in';

  betForm.appendChild(betInputLabel);
  betForm.appendChild(betInputField);
  betForm.appendChild(betButton);
  betForm.appendChild(checkButton);
  betForm.appendChild(betAllinButton);

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

  var raiseAllinButton = document.createElement('button');
  raiseAllinButton.type = 'button';
  raiseAllinButton.onclick = allin.bind(null, 'raise');
  raiseAllinButton.textContent = 'All in';

  raiseForm.appendChild(raiseInputLabel);
  raiseForm.appendChild(raiseInputField);
  raiseForm.appendChild(raiseButton);
  raiseForm.appendChild(callButton);
  raiseForm.appendChild(foldButton);
  raiseForm.appendChild(raiseAllinButton);

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
    username = localStorage.getItem('username');
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
      if (GameState.players[playerIndex].ready) {
        game.appendChild(playerText);

        var br = document.createElement('br');
        game.appendChild(br);

        stack.textContent = GameState.players[playerIndex].stack;
        game.appendChild(stack);

        game.appendChild(readyWaitingText);

        container.removeChild(spinner);
        container.appendChild(game);
      } else {
        initGame();
      }
    } else if (GameState.statusIndex === 1) {
      // We are in a hand.
      game.appendChild(divider);
      game.appendChild(playerText);

      if (GameState.actionIndex === playerIndex) {
        // Check if 1 or fewer players are left without their chips all-in
        var numPlayersNotAllin = 0;
        for (var i = 0; i < GameState.players.length; i++) {
          if (GameState.players[i].stack > 0) numPlayersNotAllin++;
        }

        // HACK: This condition will only work if playing heads-up.
        // Temporary hack until side-pots are implemented.
        // debugger;
        var actions = GameState.actions[STREETS[GameState.streetIndex]];
        var len = actions.length;
        if (numPlayersNotAllin <= 1 && actions[len - 1].type === 'call') {
          // Do nothing.
        } else {
          renderBetOrRaiseForm();
        }
      }

      var br = document.createElement('br');
      game.appendChild(br);

      stack.textContent = GameState.players[playerIndex].stack;
      game.appendChild(stack);

      // Render hand
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
    } else if (GameState.statusIndex === 2) {
      // We are in the 'finished' stage (within 4 seconds of someone winning a hand).
      game.appendChild(divider);
      game.appendChild(playerText);

      var br = document.createElement('br');
      game.appendChild(br);

      stack.textContent = GameState.players[playerIndex].stack;
      game.appendChild(stack);

      // Render hand
      var handTextElement = document.createElement('h3');
      handTextElement.textContent = JSON.stringify(GameState.hands[playerIndex]);
      handContainer.appendChild(handTextElement);
      game.prepend(handContainer);

      // Render pot
      potTextElement.textContent = 'Pot: ' + GameState.pot;
      game.prepend(potContainer);

      boardTextElement.textContent = JSON.stringify(GameState.board);

      game.prepend(boardContainer);

      updatePlayersBar();
      game.prepend(playersBar);

      var handOverText;
      if (GameState.winnerIndexes.length === 1) {
        handOverText = document.createTextNode(
          'Hand finished. ' + GameState.players[GameState.winnerIndexes[0]].username
          + ' wins ' + GameState.pot + '.'
        )
      } else {
        handOverText = document.createTextNode('Tie.');
      }

      handOverDisplay.appendChild(handOverText);
      game.prepend(handOverDisplay);

      container.removeChild(spinner);
      container.appendChild(game);
    }
  });

  socket.on('gateway-failure', function(gatewayFailureData) {
    container.removeChild(spinner);
    container.appendChild(joinForm);
    localStorage.removeItem('username');

    console.log('Gateway failure:', gatewayFailureData.msg);
  });

  socket.on('top-off', function(_GameState) {
    GameState = _GameState;

    stack.textContent = GameState.players[playerIndex].stack;
    game.removeChild(topOffButton);
    if (!game.contains(readyButton)) game.appendChild(readyButton);
  });

  socket.on('start-hand', function(_GameState) {
    GameState = _GameState;

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

    game.removeChild(readyWaitingText);
    if (game.contains(topOffButton)) game.removeChild(topOffButton);
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

  socket.on('call', function(_GameState, isAllin) {
    GameState = _GameState;

    // Update view
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;

    if (isAllin) {
      // Do nothing.
    } else if (GameState.actionIndex === playerIndex) {
      updateBetText();
      game.insertBefore(raiseForm, divider);
      game.insertBefore(betText, raiseForm);
    }
  });

  socket.on('check', function(_GameState) {
    GameState = _GameState;

    updatePlayersBar();
    if (playerIndex === GameState.actionIndex) {
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

  socket.on('fold', function(_GameState) {
    GameState = _GameState;

    updatePlayersBar();

    if (playerIndex === GameState.actionIndex) {
      updateBetText();
      game.insertBefore(raiseForm, divider);
      game.insertBefore(betText, raiseForm);
    }
  });

  socket.on('big-blind-option', function(_GameState) {
    GameState = _GameState;

    // Update view
    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;

    if (playerIndex === GameState.bigBlindIndex) {
      game.insertBefore(betForm, divider);
    }
  });

  socket.on('next-street', function(_GameState, isAllin) {
    GameState = _GameState;

    boardTextElement.textContent = JSON.stringify(GameState.board);

    // If it is the flop and we haven't inserted the board into the view yet.
    if (!game.contains(boardContainer)) {
      game.insertBefore(boardContainer, potContainer);
    }

    if (isAllin) return;

    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;

    if (GameState.actionIndex === playerIndex) {
      game.insertBefore(betForm, divider);
    }
  });

  socket.on('resolve-effective-stacks', function(_GameState) {
    GameState = _GameState;

    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;
  });

  socket.on('hand-finished', function(_GameState) {
    GameState = _GameState;

    potTextElement.textContent = 'Pot: ' + GameState.pot;
    updatePlayersBar();
    stack.textContent = GameState.players[playerIndex].stack;

    var handOverText;
    if (GameState.winnerIndexes.length === 1) {
      handOverText = document.createTextNode(
        'Hand finished. ' + GameState.players[GameState.winnerIndexes[0]].username
        + ' wins ' + GameState.pot + '.'
      );
    } else {
      // TODO: Make this actually into a formatted string/sentence with all
      // players' usernames who split the pot.
      handOverText = document.createTextNode('Split pot.');
    }

    handOverDisplay.appendChild(handOverText);
    game.prepend(handOverDisplay);
  });

  socket.on('reset', function(_GameState) {
    GameState = _GameState;

    handOverDisplay.removeChild(handOverDisplay.firstChild);
    container.removeChild(game);
    container.appendChild(spinner);
    while (game.firstChild) game.removeChild(game.firstChild);

    initGame();
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

    if (GameState.players.length >= 2) {
      if (GameState.players[playerIndex].stack > 0) game.appendChild(readyButton);
    } else {
      game.appendChild(waitingText);
    }

    if (GameState.players[playerIndex].stack < 10000) game.appendChild(topOffButton);

    container.removeChild(spinner);
    container.appendChild(game);
  }

  function signifyReadiness() {
    game.removeChild(readyButton);
    game.appendChild(readyWaitingText);
    if (game.contains(topOffButton)) game.removeChild(topOffButton);

    socket.emit('ready', playerIndex);
  }

  function topOff() {
    socket.emit('top-off', playerIndex);
  }

  function renderBetOrRaiseForm() {
    if (GameState.actions[STREETS[GameState.streetIndex]].every(a => a.type === 'check')
      || isBigBlindOption()
    ) {
      game.prepend(betForm);
    } else {
      updateBetText();
      game.insertBefore(raiseForm, divider);
      game.insertBefore(betText, raiseForm);
    }
  }

  function isBigBlindOption() {
    return GameState.streetIndex === 0
      && playerIndex === GameState.bigBlindIndex
      && GameState.currentBetTotal === 100; // <-- big blind
  }

  function updatePlayersBar() {
    // Removing the players bar if its already there.
    // Might want to optimize this...
    while (playersBar.firstChild) playersBar.removeChild(playersBar.firstChild);

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

  function bet(event) {
    event.preventDefault();

    var amount = betInputField.value;
    if (amount === '') {
      return;
    }

    if (!(/^\d+$/.test(amount))) {
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

  function allin(allinType) {
    if (allinType === 'bet') {
      betInputField.value = '';
      game.removeChild(betForm);

      socket.emit('bet', {
        playerIndex: playerIndex,
        amount: GameState.players[playerIndex].stack
      });
    } else if (allinType == 'raise') {
      raiseInputField.value = '';
      game.removeChild(raiseForm);
      game.removeChild(betText);

      socket.emit('raise', {
        playerIndex: playerIndex,
        amount: GameState.players[playerIndex].stack
      });
    } else {
      throw new Error('Invalid allinType passed to allin:', allinType);
    }
  }

  function check() {
    event.preventDefault();

    betInputField.value = '';
    game.removeChild(betForm);

    socket.emit('check', { playerIndex: playerIndex });
  }

  function raise(event) {
    event.preventDefault();

    var amount = raiseInputField.value
    if (amount === '') {
      return;
    }

    if (!(/^\d+$/.test(amount))) {
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
    game.removeChild(raiseForm);
    game.removeChild(betText);
    game.removeChild(handContainer);

    socket.emit('fold', { playerIndex: playerIndex });
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

    const amountToCall = GameState.currentBetTotal - myBetTotal;
    if (amountToCall > GameState.players[playerIndex].stack) {
      // Special case for all-in to call.
      return GameState.players[playerIndex].stack;
    } else {
      return amountToCall;
    }
  }
})();
