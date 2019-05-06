'use strict';

/* GLOBALS */

var username = localStorage.getItem('username');
var GameState;
var playerIndex;
var STREETS = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];

var elements = {
  root: makeElement('div', { className: 'container' }),
  joinForm: makeElement('form', {
    onsubmit: onJoinSubmit
  })
};

elements.usernameInputField = makeElement('input', {
  type: 'text',
  name: 'username'
});

appendChildren(elements.joinForm, [
  makeElement('label', {
    htmlFor: 'username',
    textContent: 'Username:'
  }),
  elements.usernameInputField
]);

// The whole thing relies on socket connection.
var socket = io();

socket.on('connect', function() {
  username = localStorage.getItem('username');
  if (username) {
    socket.emit('gateway', username);
  } else {
    elements.root.appendChild(elements.joinForm);
    clearBody();
    document.body.appendChild(elements.root);
  }
});

socket.on('join-success', function(_GameState, _playerIndex) {
  GameState = _GameState;
  playerIndex = _playerIndex;

  renderGame();

  localStorage.setItem('username', GameState.players[playerIndex].username);
});

socket.on('join-failure', function(msg) {
  alert(msg);
  elements.root.appendChild(elements.joinForm);
});

socket.on('join', function(_GameState) {
  GameState = _GameState;

  // Render Ready button if we just got our first opponent
  if (GameState.players.length === 2) {
    elements.game.removeChild(elements.waiting);

    if (!elements.hasOwnProperty('readyButton')) {
      elements.readyButton = makeElement('button', {
        type: 'button',
        textContent: 'Ready',
        onclick: signifyReadiness
      });
    }

    elements.game.appendChild(elements.readyButton);
  }
});

socket.on('gateway-success', function(_GameState, _playerIndex) {
  GameState = _GameState;
  playerIndex = _playerIndex;

  renderGame();
});

socket.on('gateway-failure', function(gatewayFailureData) {
  elements.root.appendChild(elements.joinForm);
  localStorage.removeItem('username');
});

socket.on('top-off', function(_GameState) {
  GameState = _GameState;

  elements.stack.textContent = GameState.players[playerIndex].stack;
  elements.game.removeChild(elements.topOffButton);
  if (!elements.game.contains(elements.readyButton)) {
    if (!elements.hasOwnProperty('readyButton')) {
      elements.readyButton = makeElement('button', {
        type: 'button',
        textContent: 'Ready',
        onclick: signifyReadiness
      });
    }

    elements.game.appendChild(elements.readyButton);
  }
});

socket.on('start-hand', function(_GameState) {
  GameState = _GameState;

  elements.game.removeChild(elements.readyWaiting);
  if (elements.game.contains(elements.topOffButton)){
    elements.game.removeChild(elements.topOffButton);
  }

  renderHand();
  renderPot();
  renderPlayersBar();

  if (GameState.actionIndex === playerIndex) {
    renderRaiseForm();
  }
});

socket.on('raise', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;

  if (GameState.actionIndex === playerIndex) {
    renderRaiseForm();
  }
});

socket.on('call', function(_GameState, isAllin) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;

  if (isAllin) {
    // Do nothing.
  } else if (GameState.actionIndex === playerIndex) {
    if (isBigBlindOption()) renderBetForm();
    else renderRaiseForm();
  }
});

socket.on('check', function(_GameState) {
  GameState = _GameState;

  updatePlayersBar();
  if (playerIndex === GameState.actionIndex) {
    renderBetForm();
  }
});

// TODO: Add handling for 'isAllin'
socket.on('bet', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;

  if (GameState.actionIndex === playerIndex) {
    renderRaiseForm();
  }
});

socket.on('fold', function(_GameState) {
  GameState = _GameState;

  updatePlayersBar();
  if (playerIndex === GameState.actionIndex) {
    renderRaiseForm();
  }
});

socket.on('big-blind-option', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;

  if (playerIndex === GameState.bigBlindIndex) {
    renderBetForm();
  }
});

socket.on('next-street', function(_GameState, isAllin) {
  GameState = _GameState;

  // If it is the flop
  if (GameState.streetIndex === 1) renderBoard();
  else appendCardToBoard();

  if (isAllin) return;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;

  if (GameState.actionIndex === playerIndex) {
    renderBetForm();
  }
});

socket.on('resolve-effective-stacks', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;
});

socket.on('hand-finished', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  elements.stack.textContent = GameState.players[playerIndex].stack;

  if (!elements.hasOwnProperty('handOver')) {
    elements.handOver = makeElement('p');
  }
  if (GameState.winnerIndexes.length === 1) {
    elements.handOver.textContent = 'Hand finished. '
      + GameState.players[GameState.winnerIndexes[0]].username
      + ' wins ' + GameState.pot + '.';
  } else {
    // TODO: Make this actually into a formatted string/sentence with all
    // players' usernames who split the pot.
    elements.handOver.textContent = 'Split pot.';
  }

  elements.game.prepend(elements.handOver);
});

socket.on('reset', function(_GameState) {
  GameState = _GameState;
  renderGame();
});

/* Rendering/game logic procedures */

function renderGame() {
  if (!elements.hasOwnProperty('game')) {
    elements.game = makeElement('div', { className: 'game' });
  } else {
    clearElement(elements.game);
  }

  elements.player = makeElement('p', {
    className: 'player',
    textContent: 'You'
  });

  elements.stack = makeElement('p', {
    className: 'stack',
    textContent: GameState.players[playerIndex].stack
  });

  appendChildren(elements.game, [elements.player, elements.stack]);

  if (GameState.statusIndex === 0) {
    if (GameState.players.length >= 2) {
      if (GameState.players[playerIndex].stack > 0) {
        // Another if statement here so that ready waiting text
        // shows if player has already signified readiness.
        if (GameState.players[playerIndex].ready) {
          if (!elements.hasOwnProperty('readyWaiting')) {
            elements.readyWaiting = makeElement('p', {
              textContent: 'Waiting for others to signify readiness...'
            });
          }

          elements.game.appendChild(elements.readyWaiting);
        } else {
          if (!elements.hasOwnProperty('readyButton')) {
            elements.readyButton = makeElement('button', {
              type: 'button',
              textContent: 'Ready',
              onclick: signifyReadiness
            });
          }

          elements.game.appendChild(elements.readyButton);
        }
      }
    } else {
      if (!elements.hasOwnProperty('waiting')) {
        elements.waiting = makeElement('p', {
          textContent: 'Waiting for others to join...'
        });
      }

      elements.game.appendChild(elements.waiting);
    }

    if (GameState.players[playerIndex].stack < 10000) {
      if (!elements.hasOwnProperty('topOffButton')) {
        elements.topOffButton = makeElement('button', {
          type: 'button',
          textContent: 'Top off',
          onclick: onTopOffClick
        });
      }

      elements.game.appendChild(elements.topOffButton);
    }
  } else {
    renderHand();
    renderPot();
    if (GameState.board.length > 0) renderBoard();

    if (GameState.statusIndex === 1) {
      renderPlayersBar();

      if (GameState.actionIndex === playerIndex) {
        // Check if 1 or fewer players are left without their chips all-in
        var numPlayersNotAllin = 0;
        for (var i = 0; i < GameState.players.length; i++) {
          if (GameState.players[i].stack > 0) numPlayersNotAllin++;
        }

        // HACK: This condition will only work if playing heads-up.
        // Temporary hack until side-pots are implemented.
        var actions = GameState.actions[STREETS[GameState.streetIndex]];
        var len = actions.length;
        if (numPlayersNotAllin <= 1 && len && actions[len - 1].type === 'call') {
          // Do nothing.
        } else {
          // TODO: Cleanup
          if ((GameState.actions[STREETS[GameState.streetIndex]].length
              && GameState.actions[STREETS[GameState.streetIndex]].every(a => a.type === 'check'))
            || isBigBlindOption()) {
            renderBetForm();
          } else {
            renderRaiseForm();
          }
        }
      }
    } else if (GameState.statusIndex === 2) {
      if (!elements.hasOwnProperty('handOver')) {
        elements.handOver = makeElement('p');
      }

      if (GameState.winnerIndexes.length === 1) {
        elements.handOver.textContent = 'Hand finished. '
          + GameState.players[GameState.winnerIndexes[0]].username
          + ' wins ' + GameState.pot + '.';
      } else {
        elements.handOver.textContent = 'Split pot.';
      }

      elements.game.prepend(elements.handOver);
    }
  }

  elements.root.appendChild(elements.game);

  clearBody();
  document.body.appendChild(elements.root);
}

function renderPlayersBar() {
  if (!elements.hasOwnProperty('playersBar')) {
    elements.playersBar = makeElement('div');
  } else {
    clearElement(elements.playersBar);
  }

  var fragment = document.createDocumentFragment();
  var playerItem;
  for (var i = 0; i < GameState.players.length; i++) {
    playerItem = makeElement('span');

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

    fragment.appendChild(playerItem);
  }

  elements.playersBar.appendChild(fragment);
  elements.game.prepend(elements.playersBar);
}

function updatePlayersBar() {
  for (var i = 0; i < GameState.players.length; i++) {
    if (i === GameState.actionIndex && GameState.statusIndex !== 2) {
      elements.playersBar.children[i].className = 'player-item-has-action';
    } else if (GameState.players[i].folded) {
      elements.playersBar.children[i].className = 'player-item-folded';
    } else {
      elements.playersBar.children[i].className = 'player-item';
    }
  }
}

function updateBetText() {
  var betTotal = GameState.currentBetTotal;
  var amountToCall = calculateAmountToCall();

  betText.textContent = 'Bet is ' + betTotal + ', ' + amountToCall + ' to call.';
}

function renderPot() {
  elements.pot = makeElement('div', { className: 'pot' });
  elements.pot.appendChild(makeElement('h2', {
    textContent: 'Pot: ' + GameState.pot
  }));

  elements.game.prepend(elements.pot);
}

function updatePot() {
  elements.pot.children[0].textContent = 'Pot: ' + GameState.pot;
}

function renderRaiseForm() {
  if (!elements.hasOwnProperty('raiseForm')) {
    elements.raiseForm = makeElement('form', { onsubmit: onRaiseSubmit });

    elements.raiseInputField = makeElement('input', {
      type: 'text',
      name: 'raise'
    });

    appendChildren(elements.raiseForm, [
      makeElement('label', { htmlFor: 'raise', textContent: 'Raise:' }),
      elements.raiseInputField,
      makeElement('button', { type: 'submit', textContent: 'Raise' }),
      makeElement('button', { type: 'button', onclick: onCallClick, textContent: 'Call' }),
      makeElement('button', { type: 'button', onclick: onFoldClick, textContent: 'Fold' })
    ]);
  }

  if (!elements.hasOwnProperty('betText')) {
    elements.betText = makeElement('p');
  }

  var betTotal = GameState.currentBetTotal;
  var amountToCall = calculateAmountToCall();

  elements.betText.textContent = 'Bet is ' + betTotal + ', ' + amountToCall + ' to call.';

  elements.game.insertBefore(elements.raiseForm, elements.player);
  elements.game.insertBefore(elements.betText, elements.raiseForm);
}

function renderBetForm() {
  if (!elements.hasOwnProperty('betForm')) {
    elements.betForm = makeElement('form', { onsubmit: onBetSubmit });
    elements.betInputField = makeElement('input', { type: 'text', name: 'bet' });

    appendChildren(elements.betForm, [
      makeElement('label', { htmlFor: 'bet', textContent: 'Bet amount:' }),
      elements.betInputField,
      makeElement('button', { type: 'submit', textContent: 'Bet' }),
      makeElement('button', { type: 'button', onclick: onCheckClick, textContent: 'Check' })
    ]);
  }

  elements.game.insertBefore(elements.betForm, elements.player);
}

function renderHand() {
  if (!elements.hasOwnProperty('hand')) {
    elements.hand = makeElement('div');
  }

  clearElement(elements.hand);

  appendChildren(elements.hand, GameState.hands[playerIndex].map(card =>
    makeElement('img', {
      width: 80,
      height: 120,
      src: mapCardDataToImgSrc(card)
    })
  ));

  elements.game.insertBefore(elements.hand, elements.player);
}

function renderBoard() {
  if (!elements.hasOwnProperty('board')) {
    elements.board = makeElement('div');
  }

  clearElement(elements.board);

  appendChildren(elements.board, GameState.board.map(card =>
    makeElement('img', {
      width: 80,
      height: 120,
      src: mapCardDataToImgSrc(card)
    })
  ));

  elements.game.insertBefore(elements.board, elements.hand);
}

function appendCardToBoard() {
  elements.board.appendChild(makeElement('img', {
    width: 80,
    height: 120,
    src: mapCardDataToImgSrc(GameState.board[GameState.board.length - 1])
  }));
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

function isBigBlindOption() {
  return GameState.streetIndex === 0
    && GameState.actionIndex === GameState.bigBlindIndex
    && GameState.currentBetTotal === 100; // <-- big blind
}

/* Event handlers */

function onJoinSubmit() {
  event.preventDefault();

  var username = elements.usernameInputField.value;

  if (username === '') {
    elements.usernameInputField.style.color = 'red';
    alert('Error: please enter a username');
    return;
  }

  elements.root.removeChild(elements.joinForm);

  socket.emit('join', username);
}

function signifyReadiness() {
  if (!elements.hasOwnProperty('readyWaiting')) {
    elements.readyWaiting = makeElement('p', {
      textContent: 'Waiting for others to signify readiness...'
    });
  }

  elements.game.removeChild(elements.readyButton);
  if (elements.game.contains(elements.topOffButton)) {
    elements.game.removeChild(elements.topOffButton);
  }

  elements.game.appendChild(elements.readyWaiting);

  socket.emit('ready', playerIndex);
}

function onTopOffClick() {
  socket.emit('top-off', playerIndex);
}

function onBetSubmit(event) {
  event.preventDefault();

  var amount = elements.betInputField.value;
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

  elements.betInputField.value = '';
  elements.game.removeChild(elements.betForm);

  socket.emit('bet', { playerIndex: playerIndex, amount: amount });
}

function onCheckClick() {
  elements.betInputField.value = '';
  elements.game.removeChild(elements.betForm);

  socket.emit('check', { playerIndex: playerIndex });
}

function onRaiseSubmit(event) {
  event.preventDefault();

  var amount = elements.raiseInputField.value
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

  elements.raiseInputField.value = '';
  elements.game.removeChild(elements.raiseForm);
  elements.game.removeChild(elements.betText);

  socket.emit('raise', { amount: amount, playerIndex: playerIndex });
}

function onCallClick() {
  var amountToCall = calculateAmountToCall();
  socket.emit('call', { playerIndex: playerIndex, amountToCall: amountToCall });

  elements.game.removeChild(elements.raiseForm);
  elements.game.removeChild(elements.betText);
}

function onFoldClick() {
  elements.game.removeChild(elements.raiseForm);
  elements.game.removeChild(elements.betText);
  elements.game.removeChild(elements.hand);

  socket.emit('fold', { playerIndex: playerIndex });
}
