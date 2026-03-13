(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const domUtils = app.domUtils = app.domUtils || {};

  function clearElement(element) {
    if (!element) {
      return;
    }

    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);

    if (options.className) {
      element.className = options.className;
    }

    if (options.text) {
      element.textContent = options.text;
    }

    if (options.html) {
      element.innerHTML = options.html;
    }

    if (options.attributes && typeof options.attributes === 'object') {
      Object.entries(options.attributes).forEach(([name, value]) => {
        if (value !== undefined && value !== null) {
          element.setAttribute(name, String(value));
        }
      });
    }

    if (options.dataset && typeof options.dataset === 'object') {
      Object.entries(options.dataset).forEach(([name, value]) => {
        element.dataset[name] = String(value);
      });
    }

    return element;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function positionFloatingElement(anchor, floatingElement) {
    if (!anchor || !floatingElement) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const elementRect = floatingElement.getBoundingClientRect();
    const usesFixedPosition = globalThis.getComputedStyle(floatingElement).position === 'fixed';
    const scrollX = globalThis.scrollX || globalThis.pageXOffset || 0;
    const scrollY = globalThis.scrollY || globalThis.pageYOffset || 0;
    const viewportWidth = globalThis.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = globalThis.innerHeight || document.documentElement.clientHeight || 0;
    const horizontalOffset = usesFixedPosition ? 0 : scrollX;
    const verticalOffset = usesFixedPosition ? 0 : scrollY;

    const preferredLeft = anchorRect.left + horizontalOffset + (anchorRect.width / 2) - (elementRect.width / 2);
    const preferredTop = anchorRect.top + verticalOffset - elementRect.height - 12;

    const left = clamp(preferredLeft, horizontalOffset + 12, horizontalOffset + viewportWidth - elementRect.width - 12);
    const top = preferredTop > verticalOffset + 12
      ? preferredTop
      : anchorRect.bottom + verticalOffset + 12;

    const maxTop = Math.max(verticalOffset + 12, verticalOffset + viewportHeight - elementRect.height - 12);

    floatingElement.style.left = `${left}px`;
    floatingElement.style.top = `${clamp(top, verticalOffset + 12, maxTop)}px`;
  }

  function ensureRelativePosition(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return;
    }

    const currentPosition = globalThis.getComputedStyle(element).position;
    if (currentPosition === 'static') {
      element.style.position = 'relative';
    }
  }

  function getFullscreenRoot() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.body;
  }

  domUtils.clearElement = clearElement;
  domUtils.createElement = createElement;
  domUtils.clamp = clamp;
  domUtils.positionFloatingElement = positionFloatingElement;
  domUtils.ensureRelativePosition = ensureRelativePosition;
  domUtils.getFullscreenRoot = getFullscreenRoot;
})();
