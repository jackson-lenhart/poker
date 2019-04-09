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
  if (hand[4].value - hand[0].value === 4) {
    return true;
  }

  // Check for wheel
  const wheelValues = [2, 3, 4, 5, 14];
  const handValues = hand.map(c => c.value);

  return handValues.every((v, i) => v === wheelValues[i]);
}

module.exports = { generateDeck, extractRandomCard, getHandRank };
