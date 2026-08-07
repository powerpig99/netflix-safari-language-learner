(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};

  const DEFAULTS = {
    referenceWidth: 1280,
    referenceHeight: 720,
    minScale: 1,
    maxScale: 2.1,
    baseBottomInsetRatio: 0.1,
    minBottomInsetPx: 10,
    maxWidthRatio: 0.96,
    maxWidthCap: 1480,
    minWidth: 260,
    estimatedOverlayHeight: 72,
    exclusionPaddingPx: 12,
    bottomBandRatio: 0.68
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeRect(rect) {
    if (!rect) {
      return null;
    }

    const left = Number(rect.left);
    const top = Number(rect.top);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return null;
    }

    return {
      left,
      top,
      width,
      height,
      right: Number.isFinite(Number(rect.right)) ? Number(rect.right) : left + width,
      bottom: Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : top + height
    };
  }

  function rectsIntersect(a, b) {
    return a.left < b.right
      && a.right > b.left
      && a.top < b.bottom
      && a.bottom > b.top;
  }

  function computeVideoScale(contentRect, options = {}) {
    const referenceWidth = Number(options.referenceWidth) || DEFAULTS.referenceWidth;
    const referenceHeight = Number(options.referenceHeight) || DEFAULTS.referenceHeight;
    const minScale = Number(options.minScale) || DEFAULTS.minScale;
    const maxScale = Number(options.maxScale) || DEFAULTS.maxScale;
    const rect = normalizeRect(contentRect);
    if (!rect) {
      return minScale;
    }

    const widthScale = rect.width / referenceWidth;
    const heightScale = rect.height / referenceHeight;
    return clamp(Math.min(widthScale, heightScale), minScale, maxScale);
  }

  function computeBaseBottomInset(contentRect, options = {}) {
    const rect = normalizeRect(contentRect);
    if (!rect) {
      return Number(options.minBottomInsetPx) || DEFAULTS.minBottomInsetPx;
    }

    const ratio = Number(options.baseBottomInsetRatio);
    const minInset = Number(options.minBottomInsetPx);
    return Math.max(
      Number.isFinite(minInset) ? minInset : DEFAULTS.minBottomInsetPx,
      Math.round(rect.height * (Number.isFinite(ratio) ? ratio : DEFAULTS.baseBottomInsetRatio))
    );
  }

  /**
   * Raise the subtitle block so it clears exclusion rects that sit in the lower
   * video band. Exclusions are viewport-coordinate rects (same space as contentRect).
   */
  function computeBottomInsetFromExclusions(contentRect, baseBottomInset, exclusions, options = {}) {
    const content = normalizeRect(contentRect);
    if (!content) {
      return baseBottomInset;
    }

    const estimatedOverlayHeight = Number(options.estimatedOverlayHeight) || DEFAULTS.estimatedOverlayHeight;
    const padding = Number(options.exclusionPaddingPx);
    const pad = Number.isFinite(padding) ? padding : DEFAULTS.exclusionPaddingPx;
    const bottomBandRatio = Number(options.bottomBandRatio);
    const bandRatio = Number.isFinite(bottomBandRatio) ? bottomBandRatio : DEFAULTS.bottomBandRatio;
    const projectedOverlayTop = content.bottom - baseBottomInset - estimatedOverlayHeight;
    let bottomInset = baseBottomInset;
    const bandTop = content.top + (content.height * bandRatio);

    (Array.isArray(exclusions) ? exclusions : []).forEach((raw) => {
      const exclusion = normalizeRect(raw);
      if (!exclusion) {
        return;
      }

      const centerY = exclusion.top + (exclusion.height / 2);
      const centerX = exclusion.left + (exclusion.width / 2);
      if (centerY < bandTop) {
        return;
      }
      if (centerX < content.left || centerX > content.right) {
        return;
      }
      if (!rectsIntersect(exclusion, content)) {
        return;
      }

      const overlapsProjectedSubtitleBand = exclusion.top < (content.bottom - baseBottomInset)
        && exclusion.bottom > projectedOverlayTop;
      if (!overlapsProjectedSubtitleBand) {
        return;
      }

      bottomInset = Math.max(bottomInset, Math.round(content.bottom - exclusion.top + pad));
    });

    return bottomInset;
  }

  /**
   * Pure subtitle placement relative to the mount target.
   * Input rects are viewport coordinates. Output left/bottom are mount-local
   * (suitable for absolute positioning inside the mount shell).
   */
  function computeSubtitlePlacement(input = {}) {
    const mountRect = normalizeRect(input.mountRect);
    const contentRect = normalizeRect(input.contentRect);
    if (!mountRect || !contentRect) {
      return null;
    }

    const options = { ...DEFAULTS, ...(input.options || {}) };
    const scale = computeVideoScale(contentRect, options);
    const baseBottomInset = computeBaseBottomInset(contentRect, options);
    const estimatedOverlayHeight = Number(input.estimatedOverlayHeight) || options.estimatedOverlayHeight;
    const bottomInset = computeBottomInsetFromExclusions(
      contentRect,
      baseBottomInset,
      input.exclusions,
      { ...options, estimatedOverlayHeight }
    );
    const videoBottomInset = Math.max(0, mountRect.bottom - contentRect.bottom);
    const horizontalCenter = (contentRect.left - mountRect.left) + (contentRect.width / 2);
    const maxWidth = Math.min(
      contentRect.width * options.maxWidthRatio,
      options.maxWidthCap * scale
    );

    return {
      scale,
      left: horizontalCenter,
      width: Math.max(options.minWidth, Math.round(maxWidth)),
      bottom: Math.round(videoBottomInset + bottomInset),
      baseBottomInset,
      bottomInset,
      videoBottomInset
    };
  }

  /**
   * Stable top/bottom control bands from a player shell rect when finer
   * exclusions are unavailable. Viewport coordinates.
   */
  function computeControlBandExclusions(playerRect, options = {}) {
    const rect = normalizeRect(playerRect);
    if (!rect) {
      return [];
    }

    const topRatio = Number(options.topBandRatio);
    const bottomRatio = Number(options.bottomBandRatio);
    const topHeight = Math.max(44, Math.round(rect.height * (Number.isFinite(topRatio) ? topRatio : 0.12)));
    const bottomHeight = Math.max(56, Math.round(rect.height * (Number.isFinite(bottomRatio) ? bottomRatio : 0.16)));

    return [
      {
        id: 'top-controls-band',
        type: 'band',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: topHeight,
        right: rect.right,
        bottom: rect.top + topHeight
      },
      {
        id: 'bottom-controls-band',
        type: 'band',
        left: rect.left,
        top: rect.bottom - bottomHeight,
        width: rect.width,
        height: bottomHeight,
        right: rect.right,
        bottom: rect.bottom
      }
    ];
  }

  function createLayoutExclusionStore() {
    const bySource = new Map();
    const listeners = new Set();

    function snapshot() {
      const all = [];
      bySource.forEach((rects, source) => {
        (Array.isArray(rects) ? rects : []).forEach((rect) => {
          all.push({
            ...rect,
            source
          });
        });
      });
      return all;
    }

    function set(source, rects) {
      const key = String(source || 'default');
      const next = Array.isArray(rects) ? rects.map(normalizeRect).filter(Boolean) : [];
      bySource.set(key, next);
      const current = snapshot();
      listeners.forEach((listener) => {
        try {
          listener(current);
        } catch (_error) {
          // Listeners must not break publishers.
        }
      });
      return current;
    }

    function clear(source) {
      if (source == null) {
        bySource.clear();
      } else {
        bySource.delete(String(source));
      }
      const current = snapshot();
      listeners.forEach((listener) => {
        try {
          listener(current);
        } catch (_error) {
          // ignore
        }
      });
      return current;
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    return {
      set,
      clear,
      getAll: snapshot,
      subscribe
    };
  }

  core.overlayLayoutEngine = {
    DEFAULTS,
    normalizeRect,
    rectsIntersect,
    computeVideoScale,
    computeBaseBottomInset,
    computeBottomInsetFromExclusions,
    computeSubtitlePlacement,
    computeControlBandExclusions,
    createLayoutExclusionStore
  };

  // Shared singleton so visibility and overlay controllers publish/consume one set.
  if (!core.layoutExclusionStore) {
    core.layoutExclusionStore = createLayoutExclusionStore();
  }
})();
