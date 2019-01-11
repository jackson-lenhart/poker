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

module.exports = { generateDeck, extractRandomCard };
