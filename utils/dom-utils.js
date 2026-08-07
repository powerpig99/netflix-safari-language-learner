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

  function isVisibleElement(node, minSize = 4) {
    if (!(node instanceof Element)) {
      return false;
    }

    const style = globalThis.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) < 0.05) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    return rect.width > minSize && rect.height > minSize;
  }

  /**
   * Return the letterboxed/pillarboxed rendered video rect in viewport coordinates.
   * When intrinsic dimensions are unavailable, falls back to the element box or
   * an optional fallback element (e.g. player shell).
   */
  function getRenderedVideoRect(video, fallbackElement = null) {
    if (video && typeof video.getBoundingClientRect === 'function') {
      const boxRect = video.getBoundingClientRect();
      if (boxRect.width > 0 && boxRect.height > 0) {
        const videoWidth = Number(video.videoWidth);
        const videoHeight = Number(video.videoHeight);

        if (videoWidth > 0 && videoHeight > 0) {
          const intrinsicAspect = videoWidth / videoHeight;
          const boxAspect = boxRect.width / boxRect.height;
          let renderedWidth = boxRect.width;
          let renderedHeight = boxRect.height;

          if (boxAspect > intrinsicAspect) {
            renderedHeight = boxRect.height;
            renderedWidth = renderedHeight * intrinsicAspect;
          } else {
            renderedWidth = boxRect.width;
            renderedHeight = renderedWidth / intrinsicAspect;
          }

          const insetX = (boxRect.width - renderedWidth) / 2;
          const insetY = (boxRect.height - renderedHeight) / 2;

          return {
            left: boxRect.left + insetX,
            right: boxRect.left + insetX + renderedWidth,
            top: boxRect.top + insetY,
            bottom: boxRect.top + insetY + renderedHeight,
            width: renderedWidth,
            height: renderedHeight
          };
        }

        return {
          left: boxRect.left,
          right: boxRect.right,
          top: boxRect.top,
          bottom: boxRect.bottom,
          width: boxRect.width,
          height: boxRect.height
        };
      }
    }

    if (fallbackElement && typeof fallbackElement.getBoundingClientRect === 'function') {
      const fallbackRect = fallbackElement.getBoundingClientRect();
      if (fallbackRect.width > 0 && fallbackRect.height > 0) {
        return {
          left: fallbackRect.left,
          right: fallbackRect.right,
          top: fallbackRect.top,
          bottom: fallbackRect.bottom,
          width: fallbackRect.width,
          height: fallbackRect.height
        };
      }
    }

    return null;
  }

  /**
   * Convert a viewport rect into coordinates local to a mount element's box.
   */
  function toLocalRect(viewportRect, mountRect) {
    if (!viewportRect || !mountRect) {
      return null;
    }

    return {
      x: viewportRect.left - mountRect.left,
      y: viewportRect.top - mountRect.top,
      left: viewportRect.left - mountRect.left,
      top: viewportRect.top - mountRect.top,
      right: viewportRect.right - mountRect.left,
      bottom: viewportRect.bottom - mountRect.top,
      width: viewportRect.width,
      height: viewportRect.height
    };
  }

  domUtils.clearElement = clearElement;
  domUtils.createElement = createElement;
  domUtils.clamp = clamp;
  domUtils.positionFloatingElement = positionFloatingElement;
  domUtils.ensureRelativePosition = ensureRelativePosition;
  domUtils.getFullscreenRoot = getFullscreenRoot;
  domUtils.isVisibleElement = isVisibleElement;
  domUtils.getRenderedVideoRect = getRenderedVideoRect;
  domUtils.toLocalRect = toLocalRect;
})();