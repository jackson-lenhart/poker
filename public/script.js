'use strict';

/* GLOBALS */

var GameState;

var username = localStorage.getItem('username');
var playerIndex;

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

elements.actionsContainer = makeElement('div', { className: 'actions-container' });

// The whole thing relies on socket connection.
var socket = io();

socket.on('connect', function() {
  username = localStorage.getItem('username');
  if (username) {
    socket.emit('gateway', username);
  } else {
    clearElement(elements.root);
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
  localStorage.removeItem('username');

  clearElement(elements.root);
  elements.root.appendChild(elements.joinForm);

  clearBody();
  document.body.appendChild(elements.root);
});

socket.on('top-off', function(_GameState) {
  GameState = _GameState;

  updateStack();
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

  updateStack();

  if (GameState.actionIndex === playerIndex) {
    const amountToCall = calculateAmountToCall();
    renderRaiseForm(amountToCall);
  }
});

socket.on('raise', function(_playerIndex, _GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();

  const amountToCall = calculateAmountToCall();

  if (GameState.actionIndex === playerIndex) {
    if (
      amountToCall === GameState.players[playerIndex].stack
      || GameState.players[_playerIndex].stack === 0 /* WARNING: Only works for heads-up. */
    ) {
      renderAllInToCallForm(amountToCall);
    } else {
      renderRaiseForm(amountToCall);
    }
  }
});

socket.on('call', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();

  if (GameState.actionIndex === playerIndex) {
    if (isBigBlindOption()) {
      renderBetForm();
    } else {
      const amountToCall = calculateAmountToCall();
      renderRaiseForm(amountToCall);
    }
  }
});

socket.on('all-in-runout', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();
});

socket.on('check', function(_GameState) {
  GameState = _GameState;

  updatePlayersBar();
  if (playerIndex === GameState.actionIndex) {
    renderBetForm();
  }
});

socket.on('bet', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();

  if (GameState.actionIndex === playerIndex) {
    const amountToCall = calculateAmountToCall();

    if (amountToCall >= GameState.players[playerIndex].stack) {
      renderAllInToCallForm();
    } else {
      renderRaiseForm(amountToCall);
    }
  }
});

socket.on('fold', function(_GameState) {
  GameState = _GameState;

  updatePlayersBar();

  if (playerIndex === GameState.actionIndex) {
    const amountToCall = calculateAmountToCall();
    renderRaiseForm(amountToCall);
  }
});

socket.on('big-blind-option', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();

  if (playerIndex === GameState.bigBlindIndex) {
    renderBetForm();
  }
});

socket.on('next-street', function(_GameState, isAllIn) {
  GameState = _GameState;

  if (GameState.street === Street.FLOP) renderBoard();
  else appendCardToBoard();

  if (isAllIn) return;

  updatePot();
  updatePlayersBar();
  updateStack();

  if (GameState.actionIndex === playerIndex) {
    renderBetForm();
  }
});

socket.on('resolve-effective-stacks', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();
});

socket.on('hand-finished', function(_GameState) {
  GameState = _GameState;

  updatePot();
  updatePlayersBar();
  updateStack();

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

  // TODO: Clean this up
  if (GameState.status === Status.LOBBY) {
    if (GameState.players.length >= 2) {
      // Only allowing play if stack is at least the big-blind (will fix this later)
      if (GameState.players[playerIndex].stack >= 100) {
        // Another if statement here so that ready waiting text
        // shows if player has already signified readiness.
        if (GameState.players[playerIndex].ready) {
          createElementIfNotExist('readyWaiting', 'p', {
            textContent: 'Waiting for others to signify readiness...'
          });

          elements.game.appendChild(elements.readyWaiting);
        } else {
          createElementIfNotExist('readyButton', 'button', {
            type: 'button',
            textContent: 'Ready',
            onclick: signifyReadiness
          });

          elements.game.appendChild(elements.readyButton);
        }
      }
    } else {
      createElementIfNotExist('waiting', 'p', {
        textContent: 'Waiting for others to join...'
      });

      elements.game.appendChild(elements.waiting);
    }

    if (GameState.players[playerIndex].stack < 10000) {
      createElementIfNotExist('topOffButton', 'button', {
        type: 'button',
        textContent: 'Top off',
        onclick: onTopOffClick
      });

      elements.game.appendChild(elements.topOffButton);
    }
  } else {
    renderHand();
    renderPot();
    if (GameState.board.length > 0) renderBoard();

    if (GameState.status === Status.HAND) {
      renderPlayersBar();

      if (GameState.actionIndex === playerIndex) {
        // Check if 1 or fewer players are left without their chips all-in
        var numPlayersNotAllIn = 0;
        for (var i = 0; i < GameState.players.length; i++) {
          if (GameState.players[i].stack > 0) numPlayersNotAllIn++;
        }

        // HACK: This condition will only work if playing heads-up.
        // Temporary hack until side-pots are implemented.
        var actions = GameState.actions[GameState.street];
        var len = actions.length;

        if (numPlayersNotAllIn <= 1) {
          if (len && actions[len - 1].type !== ActionType.CALL) {
            const amountToCall = calculateAmountToCall();

            renderAllInToCallForm(amountToCall);
          }
        } else {
          if (!len || actions.every(a => a.type === ActionType.CHECK) || isBigBlindOption()) {
            renderBetForm();
          } else {
            const amountToCall = calculateAmountToCall();

            if (amountToCall === GameState.players[playerIndex].stack) {
              renderAllInToCallForm();
            } else if (amountToCall > GameState.players[playerIndex].stack) {
              // DEBUG:
              throw new Error(
                'Unexpected amount to call: ' + amountToCall + '.'
                + ' Greater than current player\'s stack: ' + GameState.players[playerIndex].stack
              );
            } else {
              renderRaiseForm(amountToCall);
            }
          }
        }
      }
    } else if (GameState.status === Status.FINISHED) {
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

    if (i === GameState.actionIndex && GameState.status !== Status.FINISHED) {
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
    if (i === GameState.actionIndex && GameState.status !== Status.FINISHED) {
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

function updateStack() {
  elements.stack.textContent = GameState.players[playerIndex].stack;
}

function renderRaiseForm(amountToCall) {
  createElementIfNotExist('raiseForm', 'form', { onsubmit: onRaiseSubmit });
  createElementIfNotExist('raiseInputField', 'input', {
    type: 'text',
    name: 'raise'
  });

  // OPTIMIZE: Probably shouldn't have to clear this here, figure out how to update it piecemeal.
  clearElement(elements.raiseForm);
  appendChildren(elements.raiseForm, [
    elements.raiseInputField,
    makeElement('button', { type: 'submit', textContent: 'Raise' }),
    makeElement('button', {
      type: 'button',
      onclick: onCallClick.bind(null, amountToCall),
      textContent: 'Call'
    }),
    makeElement('button', { type: 'button', onclick: onFoldClick, textContent: 'Fold' })
  ]);

  createElementIfNotExist('betText', 'p', {});

  var betTotal = GameState.currentBetTotal;
  elements.betText.textContent = 'Bet is ' + betTotal + ', ' + amountToCall + ' to call.';

  clearElement(elements.actionsContainer);
  appendChildren(elements.actionsContainer, [elements.betText, elements.raiseForm]);

  elements.game.insertBefore(elements.actionsContainer, elements.player);
}

function renderBetForm() {
  // Not using createElementIfNotExist here because want to do certain other things
  // if the element does not exist yet.
  if (!elements.hasOwnProperty('betForm')) {
    elements.betForm = makeElement('form', { onsubmit: onBetSubmit });
    createElementIfNotExist('betInputField', 'input', { type: 'text', name: 'bet' });

    appendChildren(elements.betForm, [
      makeElement('label', { htmlFor: 'bet', textContent: 'Bet amount:' }),
      elements.betInputField,
      makeElement('button', { type: 'submit', textContent: 'Bet' }),
      makeElement('button', { type: 'button', onclick: onCheckClick, textContent: 'Check' })
    ]);
  }

  clearElement(elements.actionsContainer);
  elements.actionsContainer.appendChild(elements.betForm);

  elements.game.insertBefore(elements.actionsContainer, elements.player);
}

function renderAllInToCallForm(amountToCall) {
  if (!amountToCall) {
    amountToCall = calculateAmountToCall();
  }

  createElementIfNotExist('allInText', 'p', {});
  elements.allInText.textContent = 'Call all in for ' + amountToCall + '?';

  createElementIfNotExist('callButton', 'button', {
    type: 'button',
    textContent: 'Call'
  });

  elements.callButton.onclick = onCallClick.bind(null, amountToCall),

  createElementIfNotExist('foldButton', 'button', {
    type: 'button',
    onclick: onFoldClick,
    textContent: 'Fold'
  });

  var fragment = document.createDocumentFragment();

  fragment.appendChild(elements.allInText);
  fragment.appendChild(elements.callButton);
  fragment.appendChild(elements.foldButton);

  clearElement(elements.actionsContainer);
  elements.actionsContainer.appendChild(fragment);
  elements.game.insertBefore(elements.actionsContainer, elements.player);
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

function createElementIfNotExist(elementName, tagName, props) {
  if (!elements.hasOwnProperty(elementName)) {
    elements[elementName] = makeElement(tagName, props);
  }
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
  var actions = GameState.actions[GameState.street];
  for (var i = 0; i < actions.length; i++) {
    if (actions[i].playerIndex === playerIndex && actions[i].amount) {
      myBetTotal += actions[i].amount;
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
  return GameState.street === Street.PRE_FLOP
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

  socket.emit('join', username);

  elements.usernameInputField.value = '';
  elements.root.removeChild(elements.joinForm);
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

  elements.game.removeChild(elements.topOffButton);

  if (!elements.hasOwnProperty('readyButton')) {
    elements.readyButton = makeElement('button', {
      type: 'button',
      textContent: 'Ready',
      onclick: signifyReadiness
    });
  }

  elements.game.appendChild(elements.readyButton);
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
  elements.game.removeChild(elements.actionsContainer);

  socket.emit('bet', { playerIndex: playerIndex, amount: amount });
}

function onCheckClick() {
  elements.betInputField.value = '';
  elements.game.removeChild(elements.actionsContainer);

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

  // OPTIMIZE: Shouldn't need to calculate this again.
  var amountToCall = calculateAmountToCall();

  amount = parseInt(amount, 10);
  // This will not catch a particular illegal small blind vs big blind raise yet.
  if (typeof amount !== 'number' || amount < 100) {
    return;
  }

  // DEBUG:
  console.log('Current bet total is: ', GameState.currentBetTotal);

  // WARNING: This will only work heads-up.
  var minimumRaise = amountToCall * 2;
  if (
    amount < minimumRaise
    && GameState.players[playerIndex].stack >= minimumRaise
    && amount !== GameState.players[playerIndex].stack
  ) {
    return;
  }

  if (amount > GameState.players[playerIndex].stack) {
    return;
  }

  elements.raiseInputField.value = '';
  elements.game.removeChild(elements.actionsContainer);

  socket.emit('raise', { amount: amount, playerIndex: playerIndex });
}

function onCallClick(amountToCall) {
  if (!amountToCall) {
    amountToCall = calculateAmountToCall();
  }

  socket.emit('call', { playerIndex: playerIndex, amountToCall: amountToCall });

  elements.game.removeChild(elements.actionsContainer);
}

function onFoldClick() {
  elements.game.removeChild(elements.actionsContainer);
  elements.game.removeChild(elements.hand);

  socket.emit('fold', { playerIndex: playerIndex });
}
