const assert = require('assert');
const { expect } = require('chai');

const { generateDeck, extractRandomCard, getHandRank } = require('../poker');

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

describe('getHandRank', function() {
  it('Recognizes a straight flush', function() {
    const mockHand = [
      { value: 5, suit: 1 },
      { value: 6, suit: 1 },
      { value: 7, suit: 1 },
      { value: 8, suit: 1 },
      { value: 9, suit: 1 }
    ];

    expect(getHandRank(mockHand)).to.equal(1);
  });

  it('Recognizes a plain flush', function() {
    const mockHand = [
      { value: 5, suit: 3 },
      { value: 7, suit: 3 },
      { value: 10, suit: 3 },
      { value: 11, suit: 3 },
      { value: 13, suit: 3 }
    ];

    expect(getHandRank(mockHand)).to.equal(4);
  });

  it('Recognizes a plain straight', function() {
    const mockHand = [
      { value: 7, suit: 1 },
      { value: 8, suit: 2 },
      { value: 9, suit: 1 },
      { value: 10, suit: 0 },
      { value: 11, suit: 0 }
    ];

    expect(getHandRank(mockHand)).to.equal(5);
  });

  it('Recognizes a wheel', function() {
    const mockHand = [
      { value: 2, suit: 4 },
      { value: 3, suit: 3 },
      { value: 4, suit: 0 },
      { value: 5, suit: 1 },
      { value: 14, suit: 3 }
    ];

    expect(getHandRank(mockHand)).to.equal(5);
  });

  it('Recognizes quads', function() {
    const mockHand = [
      { value: 2, suit: 3 },
      { value: 8, suit: 0 },
      { value: 8, suit: 3 },
      { value: 8, suit: 2 },
      { value: 8, suit: 1 }
    ];

    expect(getHandRank(mockHand)).to.equal(2);
  });

  it('Recognizes full house', function() {
    const mockHand = [
      { value: 12, suit: 3 },
      { value: 12, suit: 0 },
      { value: 12, suit: 1 },
      { value: 13, suit: 2 },
      { value: 13, suit: 1 }
    ];

    expect(getHandRank(mockHand)).to.equal(3);
  });

  it('Recognizes trips', function() {
    const mockHand = [
      { value: 3, suit: 0 },
      { value: 8, suit: 1 },
      { value: 8, suit: 0 },
      { value: 8, suit: 3 },
      { value: 10, suit: 3 }
    ];

    expect(getHandRank(mockHand)).to.equal(6);
  });

  it('Recognizes 2-pair', function() {
    const mockHand = [
      { value: 3, suit: 0 },
      { value: 3, suit: 1 },
      { value: 8, suit: 0 },
      { value: 8, suit: 3 },
      { value: 10, suit: 3 }
    ];

    expect(getHandRank(mockHand)).to.equal(7);
  });

  it('Recognizes 1-pair', function() {
    const mockHand = [
      { value: 3, suit: 0 },
      { value: 3, suit: 1 },
      { value: 8, suit: 0 },
      { value: 9, suit: 3 },
      { value: 10, suit: 3 }
    ];

    expect(getHandRank(mockHand)).to.equal(8);
  });

  it('Recognizes high card', function() {
    const mockHand = [
      { value: 3, suit: 0 },
      { value: 4, suit: 1 },
      { value: 8, suit: 0 },
      { value: 9, suit: 3 },
      { value: 10, suit: 3 }
    ];

    expect(getHandRank(mockHand)).to.equal(9);
  });
});
