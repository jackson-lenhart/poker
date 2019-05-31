'use strict';

function mapCardDataToImgSrc(card) {
  var src = 'card-images/';

  if (card.value >= 2 && card.value <= 10) src += card.value;
  else if (card.value === 11) src += 'J';
  else if (card.value === 12) src += 'Q';
  else if (card.value === 13) src += 'K';
  else if (card.value === 14) src += 'A';

return src + card.suit.toUpperCase() + '.png';
}
