'use strict';

function makeEnum() {
  var e = {};

  for (var i = 0; i < arguments.length; i++) {
    if (typeof arguments[i] === 'string') {
      e[arguments[i]] = i;
    } else {
      throw new Error('Invalid value of type ' + typeof arguments[i] + ' passed to makeEnum');
    }
  }

  return e;
}

var Status = makeEnum('LOBBY', 'HAND', 'FINISHED');
var Street = makeEnum('PRE_FLOP', 'FLOP', 'TURN', 'RIVER');

// If we are in a Node.js environment, export the module
if (typeof window === 'undefined') {
  module.exports = { makeEnum, Status, Street };
}
