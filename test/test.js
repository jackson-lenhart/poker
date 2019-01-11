const assert = require('assert');
const { expect } = require('chai');

const { generateDeck, extractRandomCard } = require('../poker');

const deck = generateDeck();

describe('generateDeck', function() {
  it('Generates 52 items', function() {
    expect(deck.length).to.equal(52);
  });
});

describe('extractRandomCard', function() {
  it('Gets a random card and removes it from the deck', function() {
    expect(extractRandomCard(deck)).to.have.property('suit');
    expect(deck.length).to.equal(51);
  });
});
