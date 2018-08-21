/*
@license
Copyright (c) 2018 https://github.com/dima-dv
Based on work by The Polymer Project
@license
Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

const partDataKey = '__cssParts';
const partIdKey = '__partId';

/**
 * Converts any style elements in the shadowRoot to replace ::part/::theme
 * with custom properties used to transmit this data down the dom tree. Also
 * caches part metadata for later lookup.
 * @param {Element} element
 */

function initializeParts(element) {
  let root = element.shadowRoot || element;
  Array.from(root.querySelectorAll('style')).forEach(style => {
    const info = partCssToCustomPropCss(element, style.textContent);
    if (info.parts) {
      element[partDataKey] = element[partDataKey] || [];
      element[partDataKey].push(...info.parts);
      style.textContent = info.css;
    }
  });
  if (typeof element[partDataKey] === 'undefined') {
    element[partDataKey]= null;
  }
}

function ensurePartData(element) {
  if (!element.hasOwnProperty(partDataKey)) {
    initializeParts(element);
  }
}

function partDataForElement(element) {
  ensurePartData(element);
  return element[partDataKey];
}

// TODO(sorvell): brittle due to regex-ing css. Instead use a css parser.
/**
 * Turns css using `::part` into css using variables for those parts.
 * Also returns part metadata.
 * @param {Element} element
 * @param {string} cssText
 * @returns {Object} css: partified css, parts: array of parts of the form
 * {name, selector, props}
 * Example of part-ified css, given:
 * .foo::part(bar) { color: red }
 * output:
 * .foo { --e1-part-bar-color: red; }
 * where `e1` is a guid for this element.
 */
function partCssToCustomPropCss(element, cssText) {
  let parts;
  let css = cssText.replace(cssRe, (m, selector, type, name, endSelector, propsStr) => {
    parts = parts || [];
    let props = {};
    const propsArray = propsStr.split(/\s*;\s*/);
    propsArray.forEach(prop => {
      prop = prop.trim();
      if (prop) {
        const s = prop.split(':');
        const name = s.shift().trim();
        const value = s.join(':').trim();
        props[name] = value;
      }
    });
    const id = partIdForElement(element);
    parts.push({selector, endSelector, name, props, isTheme: type == theme});
    let partProps = '';
    for (let p in props) {
      partProps = `${partProps}\n\t${varForPart(id, name, p, endSelector)}: ${props[p]};`;
    }
    return `\n${selector || '*'} {\n\t${partProps.trim()}\n}`;
  });
  return {parts, css};
}

// guid for element part scopes
let partId = 0;
function partIdForElement(element) {
  if (element[partIdKey] == undefined) {
    element[partIdKey] = partId++;
  }
  return element[partIdKey];
}

const theme = '::theme';
const cssRe = /\s*(.*)(::(?:part|theme))\(([^)]+)\)([^\s{]*)\s*{\s*([^}]*)}/g

// creates a custom property name for a part.
function varForPart(id, name, prop, endSelector) {
  return `--e${id}-part-${name}-${prop}${endSelector ? `-${endSelector.replace(/\:/g, '')}` : ''}`;
}

/**
 * Produces a style using css custom properties to style ::part/::theme
 * for all the dom in the element's shadowRoot.
 * @param {Element} element
 */
export function applyPartTheme(element) {
  let root = element.shadowRoot || element;
  const oldStyle = root.querySelector('style[parts]');
  if (oldStyle) {
    oldStyle.parentNode.removeChild(oldStyle);
  }

  let container = element.getRootNode()
  container = container.host || container;
  if (container !== element) {
    // note: ensure host has part data so that elements that boot up
    // while the host is being connected can style parts.
    ensurePartData(container);
    const css = cssForElementDom(element);
    if (css) {
      const newStyle = document.createElement('style');
      newStyle.setAttribute("parts", "");
      newStyle.textContent = css;
      root.appendChild(newStyle);
    }
  }
}

/**
 * Produces cssText a style element to apply part css to a given element.
 * The element's shadowRoot dom is scanned for nodes with a `part` attribute.
 * Then selectors are created matching the part attribute containing properties
 * with parts defined in the element's host.
 * The ancestor tree is traversed for forwarded parts and theme.
 * e.g.
 * [part="bar"] {
 *   color: var(--e1-part-bar-color);
 * }
 * @param {Element} element Element for which to apply part css
 */
function cssForElementDom(element) {
  ensurePartData(element);
  const id = partIdForElement(element);
  const partNodes = element.shadowRoot.querySelectorAll('[part]');
  let css = '';
  for (let i=0; i < partNodes.length; i++) {
    let attr = partNodes[i].getAttribute('part');
    let partInfo = partInfoFromAttr(attr);
    css = `${css}\n\t${ruleForPartInfo(partInfo, attr, element)}`
  }
  return css;
}

/**
 * Creates a css rule that applies a part.
 * @param {*} partInfo Array of part info from part attribute
 * @param {*} attr Part attribute
 * @param {*} element Element within which the part exists
 * @returns {string} Text of the css rule of the form `selector { properties }`
 */
function ruleForPartInfo(partInfo, attr, element) {
  let text = '';
  partInfo.forEach(info => {
    if (!info.forward) {
      const props = propsForPart(info.name, element);
      if (props) {
        for (let bucket in props) {
          let propsBucket = props[bucket];
          let partProps = [];
          for (let p in propsBucket) {
            partProps.push(`${p}: ${propsBucket[p]};`);
          }
          text = `${text}\n[part="${attr}"]${bucket} {\n\t${partProps.join('\n\t')}\n}`;
        }
      }
    }
  });
  return text;
}

/**
 * Parses a part attribute into an array of part info
 * @param {*} attr Part attribute value
 * @returns {array} Array of part info objects of the form {name, foward}
 */
function partInfoFromAttr(attr) {
  const pieces = attr ? attr.split(',') : [];
  let parts = [];
  pieces.forEach(p => {
    parts.push({name: p.trim(), forward: null});
  });
  return parts;
}

/**
 * Parses a partmap attribute into an array of part info
 * @param {*} attr Partmap attribute value
 * @returns {array} Array of part info objects of the form {name, foward}
 */
function partInfoFromPartmap(attr) {
  const pieces = attr ? attr.split(',') : [];
  let parts = [];
  pieces.forEach(p => {
    const m = p ? p.match(/\s*([^\s]+)(?:\s+([^\s]+))?\s*/) : [];
    if (m) {
      parts.push({name: m[2] || m[1], forward: m[1]});
    }
  });
  return parts;
}

/**
 * For a given part name returns a properties object which sets any ancestor
 * provided part properties to the proper ancestor provided css variable name.
 * e.g.
 * color: `var(--e1-part-bar-color);`
 * @param {string} name Name of part
 * @param {Element} element Element within which dom with part exists
 * @param {boolean} requireTheme True if only ::theme should be collected.
 * @returns {object} Object of properties for the given part set to part variables
 * provided by the elements ancestors.
 */
function propsForPart(name, element, requireTheme) {
  let container = element.getRootNode();
  container = container.host || container;
  if (container === element) {
    return;
  }
  // collect props from host element.
  let props = propsFromElement(name, container, element, requireTheme);
  // now recurse ancestors to find matching `theme` properties
  const themeProps = propsForPart(name, container, true);
  props = mixPartProps(props, themeProps);
  // now recurse ancestors to find *forwarded* part properties
  if (!requireTheme) {
    // forwarding: recurses up ancestor tree!
    const partInfo = partInfoFromPartmap(element.getAttribute('partmap'));
    // {name, forward} where `*` can be included
    partInfo.forEach(info => {
      let catchAll = info.forward && (info.forward.indexOf('*') >= 0);
      if (name == info.forward || catchAll) {
        const ancestorName = catchAll ? info.name.replace('*', name) : info.name;
        const forwarded = propsForPart(ancestorName, container);
        props = mixPartProps(props, forwarded);
      }
    });
  }

  return props;
}

/**
 * Collects css for the given part of an element from the part data for the given
 * container element.
 *
 * @param {string} name Name of part
 * @param {Element} container Element with part css/data.
 * @param {Element} element Element with a part.
 * @param {Boolean} requireTheme True if should only match ::theme
 * @returns {object} Object of properties for the given part set to part variables
 * provided by the element.
 */
function propsFromElement(name, container, element, requireTheme) {
  let props;
  const parts = partDataForElement(container);
  if (parts) {
    const id = partIdForElement(container);
    parts.forEach((part) => {
      if (part.name == name && (!requireTheme || part.isTheme) && isMatchingPossible(element, part.selector)) {
        props = addPartProps(props, part, id, name);
      }
    });
  }
  return props;
}

/**
 * Match sequence of simple selectors in selector
 * (split on combinators)
 * @param {string} text CSS selector (not a group, without ",")
 * @returns [0: sequence, 1: isLast]
 */
const selectorSeqRe = /([^\s>~+]+$)|(?:[^\s>~+]+)/g

/**
 * Match possible dynamic single simple selector in sequence of simple selectors
 * @param {string} text Sequence of simple selectors (no white-space)
 * @returns [0: simpleSelector, 1: prefix, 2: name, 3: attributeName]
 */
const constSelectorRe = /(?:(\.|:|::)([^.#:[]+))|(?:\[([^=]+)(?:=[^\]]+)?\])/g

/**
 * Checks if given element could match the static part of selector
 *
 * @param {Element} element Element with a constAttributes and constClasses.
 * @param {string}  selector CSS selector string
 * @returns {Boolean}
 */
function isMatchingPossible(element, selector) {
  let constSelector = selector.replace(selectorSeqRe, (sequence, isLast) => {
    return sequence.replace(constSelectorRe, (m, classOrPseudoPrefix, classOrPseudoName, attributeName) => {
      return isLast && 
             ((classOrPseudoPrefix === '.' && element.constructor.constClasses && (typeof element.constructor.constClasses === 'boolean' || element.constructor.constClasses.indexOf(classOrPseudoName) !== -1)) ||
             (attributeName && element.constructor.constAttributes && element.constructor.constAttributes.indexOf(attributeName) !== -1))
             ? m : '';
    });
  });
  return element.matches(constSelector);
}

/**
 * Add part css to the props object for the given part/name.
 * @param {object} props Object containing part css
 * @param {object} part Part data
 * @param {nmber} id element part id
 * @param {string} name name of part
 */
function addPartProps(props, part, id, name) {
  props = props || {};
  const bucket = part.endSelector || '';
  const b = props[bucket] = props[bucket] || {};
  for (let p in part.props) {
    b[p] = `var(${varForPart(id, name, p, part.endSelector)})`;
  }
  return props;
}

function mixPartProps(a, b) {
  if (a && b) {
    for (let i in b) {
      // ensure storage exists
      if (!a[i]) {
        a[i] = {};
      }
      Object.assign(a[i], b[i]);
    }
  }
  return a || b;
}

/**
 * CustomElement mixin that can be applied to provide ::part/::theme support.
 * @param {*} superClass
 */
export let PartThemeMixin = (superClass, constAttributes, constClasses) => {

  return class PartThemeClass extends superClass {

    connectedCallback() {
      if (super.connectedCallback) {
        super.connectedCallback();
      }
      this._queueApplyPartTheme();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (super.attributeChangedCallback) {
        super.attributeChangedCallback(name, oldValue, newValue);
      }
      this._queueApplyPartTheme();
    }

    static get observedAttributes() {
      if (typeof this._observedAttributes === 'undefined') {
        let result = super.observedAttributes || [];
        let constClasses = this.constClasses;
        if (constClasses !== true) {
          result.indexOf('class') === -1 && result.push('class');
        }
        let constAttributes = this.constAttributes;
        if (constAttributes && constAttributes.length) {
          for(let attr in constAttributes) {
            result.indexOf(attr) === -1 && result.push(attr);
          }
        }
        this._observedAttributes = result;
      }

      return this._observedAttributes;
    }

    static get constAttributes() {
      return constAttributes;
    }

    static get constClasses() {
      return constClasses;
    }

    _queueApplyPartTheme() {
      requestAnimationFrame((time) => this._applyPartTheme(time));
    }

    _applyPartTheme(time) {
      if (time !== this._lastApplyTime) {
        this._lastApplyTime = time;
        applyPartTheme(this);
      }
    }
  }
};
