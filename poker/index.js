const assert = require('assert');

function generateDeck() {
  const deck = [];

  // Outer loop is suits, inner loop is card value
  for (let i = 0; i < 4; i++) {
    for (let j = 2; j < 15; j++) {
      deck.push({ suit: i, value: j });
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

/*
// DEBUG:
const mockHand1 = [
  { value: 3, suit: 0 },
  { value: 9, suit: 0 },
  { value: 11, suit: 0 },
  { value: 11, suit: 1 },
  { value: 11, suit: 2 }
];

const mockHand2 = [
  { value: 11, suit: 0 },
  { value: 11, suit: 1 },
  { value: 11, suit: 3 },
  { value: 12, suit: 1 },
  { value: 13, suit: 1 }
];

resolveTie(6, mockHand1, mockHand2);
*/

module.exports = { generateDeck, extractRandomCard, getHandRank, resolveTie };
