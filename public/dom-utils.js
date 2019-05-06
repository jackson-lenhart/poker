'use strict';

function makeElement(tagName, props) {
  var element = document.createElement(tagName);

  for (var k in props) {
    element[k] = props[k];
  }

  return element;
}

function clearBody() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

function clearElement(element) {
  for (var i = element.children.length - 1; i >= 0; i--) {
    element.removeChild(element.children[i]);
  }
}

function appendChildren(element, children) {
  var fragment = document.createDocumentFragment();
  for (var i = 0; i < children.length; i++) {
    fragment.appendChild(children[i]);
  }

  element.appendChild(fragment);
}
