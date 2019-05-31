'use strict';

const assert = require('assert');

const suits = ['c', 's', 'h', 'd'];

function generateDeck() {
  const deck = [];

  // Outer loop is suits, inner loop is card value
  for (let i = 0; i < 4; i++) {
    for (let j = 2; j < 15; j++) {
      deck.push({ suit: suits[i], value: j });
    }
  }

  return deck;
}

function extractRandomCard(deck) {
  const index = Math.floor(Math.random() * deck.length);
  return deck.splice(index, 1)[0];
}

function getHandRank(hand) {
  // Expects sorted 5 card hand as input.

  /* FLUSH & STRAIGHT FLUSH */

  if (hand.every(card => card.suit === hand[0].suit)) {
    // Flush
    if (isStraight(hand)) return 1;
    else return 4; // Just a normal flush.
  }

  /* STRAIGHT */

  if (isStraight(hand)) return 5;

  /* QUADS */

  const firstCard = hand[0];
  const secondCard = hand[1];

  // If quads, the amount of matches (including itself) the first or second card has
  // will be 4. Almost certainly a better way to do this...
  if (hand.reduce((acc, c) => c.value === firstCard.value ? acc + 1 : acc, 0) === 4
    || hand.reduce((acc, c) => c.value === secondCard.value ? acc + 1 : acc, 0) === 4
  ) {
    return 2;
  }

  /* FULL HOUSE */

  const firstCardValue = hand[0].value;
  let occurencesOfFirstCardValue = 1;
  let i = 1;

  while (i < 5 && hand[i].value === firstCardValue) {
    occurencesOfFirstCardValue++;
    i++;
  }

  if (i >= 2) {
    const nextCardValue = hand[i].value;
    let occurencesOfNextCardValue = 1;
    i++;

    while (i < 5 && hand[i].value === nextCardValue) {
      occurencesOfNextCardValue++;
      i++;
    }

    if (occurencesOfFirstCardValue === 2 && occurencesOfNextCardValue === 3
      || occurencesOfFirstCardValue === 3 && occurencesOfNextCardValue === 2
    ) return 3;
  }

  /* TRIPS */

  for (let i = 0; i < 3; i++) {
    if (hand[i].value === hand[i + 1].value && hand[i].value === hand[i + 2].value) {
      return 6;
    }
  }

  /* 1 or 2 PAIR */

  // Optimize: do not need to check every single one here. Just doing it for simplicity
  let pairCount = 0;
  for (let i = 0; i < 4; i++) {
    if (hand[i].value === hand[i + 1].value) pairCount++;
  }

  if (pairCount === 2) return 7;
  else if (pairCount === 1) return 8;

  // High card
  return 9;
}

function isStraight(hand) {
  // Check for wheel
  const wheelValues = [2, 3, 4, 5, 14];
  const handValues = hand.map(c => c.value);

  if (handValues.every((v, i) => v === wheelValues[i])) {
    return true;
  }

  for (let i = 0; i < 4; i++) {
    if (hand[i + 1].value - hand[i].value !== 1) return false;
  }

  return true;
}

function resolveTie(handRank, hand1, hand2) {
  // Returns 1 if hand1 wins, 2 if hand2 wins, and 0 if absolute tie (hands are exactly the same).

  // Check for absolute tie (split pot).
  // Given that the hand rank (should be) the same, this will always detect
  // an absolute tie.
  if (hand1.every((c, i) => c.value === hand2[i].value)) return 0;

  /* STRAIGHT-FLUSH AND STRAIGHT */

  if (handRank === 1 || handRank === 5) {
    if (hand1[0].value > hand2[0].value) return 1;
    else return 2;
  }

  /* QUADS */

  if (handRank === 2) {
    let value1;
    if (hand1[0].value === hand1[1].value) value1 = hand1[0].value;
    else value1 = hand1[1].value;

    let value2;
    if (hand2[0].value === hand2[1].value) value2 = hand2[0].value;
    else value2 = hand2[1].value;

    if (value1 > value2) {
      return 1;
    } else if (value1 === value2) {
      const kicker1 = hand1.find(c => c.value !== value1);
      const kicker2 = hand2.find(c => c.value !== value2);

      if (kicker1 > kicker2) return 1;
      else return 2;
    } else {
      return 2;
    }
  }

  /* FULL HOUSE */

  if (handRank === 3) {
    let value1;
    for (let i = 0; i < 3; i++) {
      if (hand1[i].value === hand1[i + 1].value && hand1[i].value === hand1[i + 2].value) {
        value1 = hand1[i].value;
      }
    }

    let fullOf1;
    for (let i = 0; i < 4; i++) {
      if (hand1[i].value === value1) continue;
      if (hand1[i].value === hand1[i + 1].value) fullOf1 = hand1[i].value;
    }

    let value2;
    for (let i = 0; i < 3; i++) {
      if (hand2[i].value === hand2[i + 1].value && hand2[i].value === hand2[i + 2].value) {
        value2 = hand2[i].value;
      }
    }

    let fullOf2;
    for (let i = 0; i < 4; i++) {
      if (hand2[i].value === value2) continue;
      if (hand2[i].value === hand2[i + 1].value) fullOf2 = hand2[i].value;
    }

    if (value1 > value2) {
      return 1;
    } else if (value1 === value2) {
      if (fullOf1 > fullOf2) return 1;
      else return 2;
    } else {
      return 2;
    }
  }

  /* FLUSH AND HIGH CARD */

  if (handRank === 4 || handRank === 9) {
    for (let i = 4; i >= 0; i--) {
      if (hand1[i].value > hand2[i].value) return 1;
      else if (hand1[i].value === hand2[i].value) continue;
      else return 2;
    }

    // This should never run.
    throw new Error(
      'Unexpected state reached. Loop terminated while resolving ' +
      'flush/high-card tie without returning a value.'
    );
  }

  /* TRIPS */

  if (handRank === 6) {
    let value1, value2;
    for (let i = 0; i < 3; i++) {
      if (value1 === undefined
        && hand1[i].value === hand1[i + 1].value
        && hand1[i].value === hand1[i + 2].value
      ) value1 = hand1[i].value;

      if (value2 === undefined
        && hand2[i].value === hand2[i + 1].value
        && hand2[i].value === hand2[i + 2].value
      ) value2 = hand2[i].value;

      if (value1 !== undefined && value2 !== undefined) break;
    }

    if (value1 > value2) return 1;
    else if (value2 > value1) return 2;
    else {
      const kickers1 = hand1.filter(c => c.value !== value1).map(c => c.value);
      const kickers2 = hand2.filter(c => c.value !== value2).map(c => c.value);

      if (kickers1[1] > kickers2[1]) return 1;
      else if (kickers1[1] < kickers2[1]) return 2;
      else {
        if (kickers1[0] > kickers2[0]) return 1;
        else if (kickers1[0] < kickers2[0]) return 2;
        else {
          throw new Error(
            'Unexpected state reached. Either unrecognized absolute tie ' +
            'or kickers1 and kickers2 are not comparable as numbers.'
          );
        }
      }
    }
  }

  /* 2-PAIR */

  if (handRank === 7) {
    // These arrays will each contain the value of each pair in the 2-pair
    // hands respectively.
    const values1 = [];
    const values2 = [];

    for (let i = 0; i < 4; i++) {
      if (hand1[i].value === hand1[i + 1].value) values1.push(hand1[i].value);
      if (hand2[i].value === hand2[i + 1].value) values2.push(hand2[i].value);
    }

    if (values1[1] > values2[1]) return 1;
    else if (values1[1] < values2[1]) return 2;
    else {
      if (values1[0] > values2[0]) return 1;
      else if (values1[0] < values2[0]) return 2;
      else {
        const kicker1 = hand1.find(c =>
          c.value !== values1[0] && c.value !== values1[1]
        ).value;
        const kicker2 = hand2.find(c =>
          c.value !== values2[0] && c.value !== values2[1]
        ).value;

        if (kicker1 > kicker2) return 1;
        else if (kicker1 < kicker2) return 2;
        else {
          throw new Error(
            'Unexpected state reached. Either unrecognized absolute tie ' +
            'or entries in values1 and/or values2 and/or kicker1/kicker2 ' +
            'are not comparable as numbers.'
          );
        }
      }
    }
  }

  /* 1-PAIR */

  if (handRank === 8) {
    let value1, value2;
    for (let i = 0; i < 4; i++) {
      if (hand1[i].value === hand1[i + 1].value) value1 = hand1[i].value;
      if (hand2[i].value === hand2[i + 1].value) value2 = hand2[i].value;
    }

    if (value1 > value2) return 1;
    else if (value1 < value2) return 2;
    else {
      const kickers1 = hand1.filter(c => c.value !== value1).map(c => c.value);
      const kickers2 = hand2.filter(c => c.value !== value2).map(c => c.value);

      for (let i = 3; i >= 0; i--) {
        if (kickers1[i] > kickers2[i]) return 1;
        else if (kickers1[i] < kickers2[i]) return 2;
      }

      throw new Error(
        'This section should never run. We probably have values not ' +
        'comparable as numbers or an unrecognized absolute tie.'
      );
    }
  }
}

function calculateWinnerIndexes(board, hands, players, logStr) {
  const showdownHands = [];
  const handRanks = [];

  let combinedHand, possibleHands, tmp, currBestHandIndexes, currBestHandRank;

}

// NOTE: The 'players' parameter may only be needed for debug logging.
function calculateWinnerIndexesAtShowdown(board, hands, players) {
  // Difference between GameState.hands and showdownHands is GameState.hands
  // is just 2 cards, showdownHands will be the best 5 cards of those 2 combined w/ board.
  const showdownHands = [];
  const handRanks = [];
  let combinedHand, possibleHands, tmp, currBestHandIndexes, currBestHandRank;
  console.log('Board:', board);
  for (let i = 0; i < hands.length; i++) {
    combinedHand = hands[i].concat(board);
    combinedHand.sort((a, b) => a.value - b.value);

    possibleHands = [];
    tmp = Array(5).fill(null);

    kSubsets(combinedHand, tmp, possibleHands);

    // DEBUG:
    console.log('Username:', players[i].username);
    console.log('Pocket cards:', hands[i]);

    // All indexes of hands w/ same (winning) rank get put in currBestHandIndexes
    currBestHandIndexes = [0];
    currBestHandRank = getHandRank(possibleHands[0]);
    let currHandRank;
    for (let i = 1; i < possibleHands.length/* 21? */; i++) {
      currHandRank = getHandRank(possibleHands[i]);

      if (currHandRank < currBestHandRank) {
        currBestHandIndexes = [i];
        currBestHandRank = currHandRank;
      } else if (currHandRank > currBestHandRank) {
        // Do nothing?
      } else if (currHandRank === currBestHandRank) {
        currBestHandIndexes.push(i);
      } else {
        console.error(
          'Somethings gone wrong. currHandRank and currBestHandRank ' +
          'are probably not comparable as numbers.'
        );
      }
    }

    // DEBUG:
    console.log('Hand rank:', currBestHandRank);

    let resolvedTiesBestHandIndex = currBestHandIndexes[0];
    let cmpResult;
    for (const index of currBestHandIndexes) {
      cmpResult = resolveTie(
        currBestHandRank,
        possibleHands[resolvedTiesBestHandIndex],
        possibleHands[index]
      );

      if (cmpResult === 2) resolvedTiesBestHandIndex = index;
    }

    // DEBUG:
    console.log('Hand:', possibleHands[resolvedTiesBestHandIndex]);

    showdownHands.push(possibleHands[resolvedTiesBestHandIndex]);
    handRanks.push(currBestHandRank);
  }

  // DEBUG:
  console.log('Showdown hands:', showdownHands);

  let currWinningHandIndexes = [0];
  let currWinningHandRank = handRanks[0];
  let cmpResult;
  for (let i = 1; i < showdownHands.length; i++) {
    if (handRanks[i] < currWinningHandRank) {
      currWinningHandIndexes = [i];
      currWinningHandRank = handRanks[i];
    } else if (handRanks[i] > currWinningHandRank) {
      // Do nothing?
    } else if (handRanks[i] === currWinningHandRank) {
      cmpResult = resolveTie(
        handRanks[i],
        showdownHands[i],
        showdownHands[currWinningHandIndexes[0]]
      );

      if (cmpResult === 1) {
        currWinningHandIndexes = [i];
      } else if (cmpResult === 2) {
        // Do nothing.
      } else if (cmpResult === 0) {
        currWinningHandIndexes.push(i);
      } else {
        console.error(
          'Unexpected value of cmpResult. Expected 0, 1, or 2; got ' + cmpResult + '.'
        );
      }
    }
  }

  // DEBUG:
  console.log('Winning hand rank:', currWinningHandRank);
  console.log('Winning hand(s):', currWinningHandIndexes.map(index => showdownHands[index]));

  let winnersString = players[currWinningHandIndexes[0]].username;
  for (let i = 1; i < currWinningHandIndexes.length; i++) {
    winnersString += ',' + players[currWinningHandIndexes[i]].username;
  }
  console.log('Winner(s):', winnersString);

  return currWinningHandIndexes;
}

function kSubsets(combinedHand, tmp, possibleHands, i = 0, j = 0) {
  if (j === 5) {
    possibleHands.push(tmp.slice());
    return;
  }

  if (i >= combinedHand.length) return;

  tmp[j] = combinedHand[i];
  kSubsets(combinedHand, tmp, possibleHands, i + 1, j + 1);

  kSubsets(combinedHand, tmp, possibleHands, i + 1, j);
}

module.exports = {
  generateDeck,
  extractRandomCard,
  getHandRank,
  resolveTie,
  calculateWinnerIndexesAtShowdown,
  kSubsets
};
