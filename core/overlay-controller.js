(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const domUtils = app.domUtils;
  const languageUtils = app.languageUtils;
  const extensionApi = app.extensionApi;

  function traceTranslation(stage, detail) {
    if (globalThis.__NLL_TRACE_TRANSLATION__ === false) {
      return;
    }

    extensionApi && extensionApi.debugLog && extensionApi.debugLog.record('translation', stage, detail);
    console.debug('[NLL translation]', stage, detail);
  }

  function createOverlayController({ adapter, settingsStore, subtitleStore, translationQueue, wordController }) {
    let mountTarget = null;
    let root = null;
    let originalLine = null;
    let translatedLine = null;
    let statusLine = null;
    let lastTranslationRenderSignature = '';
    let resizeObserver = null;
    let observedScaleTarget = null;
    let layoutTimer = null;

    function getLayoutRects() {
      if (!root || !mountTarget || typeof mountTarget.getBoundingClientRect !== 'function') {
        return null;
      }

      const video = adapter.getVideo();
      const scaleTarget = (video && typeof video.getBoundingClientRect === 'function') ? video : mountTarget;
      if (!scaleTarget || typeof scaleTarget.getBoundingClientRect !== 'function') {
        return null;
      }

      const mountRect = mountTarget.getBoundingClientRect();
      const videoRect = scaleTarget.getBoundingClientRect();
      if (!mountRect.width || !mountRect.height || !videoRect.width || !videoRect.height) {
        return null;
      }

      let contentRect = videoRect;

      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const intrinsicAspect = video.videoWidth / video.videoHeight;
        const boxAspect = videoRect.width / videoRect.height;
        let renderedWidth = videoRect.width;
        let renderedHeight = videoRect.height;

        if (boxAspect > intrinsicAspect) {
          renderedHeight = videoRect.height;
          renderedWidth = renderedHeight * intrinsicAspect;
        } else {
          renderedWidth = videoRect.width;
          renderedHeight = renderedWidth / intrinsicAspect;
        }

        const insetX = (videoRect.width - renderedWidth) / 2;
        const insetY = (videoRect.height - renderedHeight) / 2;

        contentRect = {
          left: videoRect.left + insetX,
          right: videoRect.left + insetX + renderedWidth,
          top: videoRect.top + insetY,
          bottom: videoRect.top + insetY + renderedHeight,
          width: renderedWidth,
          height: renderedHeight
        };
      }

      return {
        mountRect,
        videoRect,
        contentRect
      };
    }

    function isVisibleNode(node) {
      if (!(node instanceof Element)) {
        return false;
      }

      const style = globalThis.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) < 0.05) {
        return false;
      }

      const rect = node.getBoundingClientRect();
      return rect.width > 4 && rect.height > 4;
    }

    function getBottomControlLift(contentRect) {
      if (!mountTarget || typeof mountTarget.querySelectorAll !== 'function') {
        return Math.max(14, Math.round(contentRect.height * 0.02));
      }

      const defaultLift = Math.max(14, Math.round(contentRect.height * 0.02));
      const interactiveNodes = mountTarget.querySelectorAll('button, [role="button"], input, [aria-label], [data-uia]');
      const overlayRect = root ? root.getBoundingClientRect() : null;
      const projectedOverlayHeight = overlayRect && overlayRect.height ? overlayRect.height : 72;
      const projectedOverlayTop = contentRect.bottom - defaultLift - projectedOverlayHeight;
      let overlapLift = defaultLift;

      interactiveNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }

        if (node.closest('.nll-overlay, .nll-control-panel, .nll-word-tooltip')) {
          return;
        }

        if (!isVisibleNode(node)) {
          return;
        }

        const rect = node.getBoundingClientRect();
        const centerY = rect.top + (rect.height / 2);
        const centerX = rect.left + (rect.width / 2);
        if (centerY < contentRect.top + (contentRect.height * 0.68)) {
          return;
        }
        if (centerX < contentRect.left || centerX > contentRect.right) {
          return;
        }
        if (rect.bottom < contentRect.top || rect.top > contentRect.bottom) {
          return;
        }

        const overlapsProjectedSubtitleBand = rect.top < (contentRect.bottom - defaultLift)
          && rect.bottom > projectedOverlayTop;
        if (!overlapsProjectedSubtitleBand) {
          return;
        }

        overlapLift = Math.max(overlapLift, Math.round(contentRect.bottom - rect.top + 12));
      });

      return overlapLift;
    }

    function updateLayoutMetrics() {
      const rects = getLayoutRects();
      if (!rects) {
        if (root) {
          root.style.setProperty('--nll-video-scale', '1');
        }
        return;
      }

      const { mountRect, contentRect } = rects;
      const widthScale = contentRect.width / 1280;
      const heightScale = contentRect.height / 720;
      const nextScale = Math.min(2.1, Math.max(1, Math.min(widthScale, heightScale)));
      const horizontalCenter = (contentRect.left - mountRect.left) + (contentRect.width / 2);
      const maxWidth = Math.min(contentRect.width * 0.92, 1720);
      const bottomLift = getBottomControlLift(contentRect);
      const videoBottomInset = Math.max(0, mountRect.bottom - contentRect.bottom);

      root.style.setProperty('--nll-video-scale', String(nextScale.toFixed(3)));
      root.style.left = `${horizontalCenter}px`;
      root.style.width = `${Math.max(260, Math.round(maxWidth))}px`;
      root.style.bottom = `${Math.round(videoBottomInset + bottomLift)}px`;
    }

    function observeVideoScaleTarget() {
      if (typeof ResizeObserver !== 'function') {
        updateLayoutMetrics();
        return;
      }

      const scaleTarget = adapter.getVideo() || mountTarget;
      if (!scaleTarget || observedScaleTarget === scaleTarget) {
        updateLayoutMetrics();
        return;
      }

      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          updateLayoutMetrics();
        });
      }

      if (observedScaleTarget) {
        resizeObserver.unobserve(observedScaleTarget);
      }

      observedScaleTarget = scaleTarget;
      resizeObserver.observe(scaleTarget);
      updateLayoutMetrics();
    }

    function buildContextWindow(activeCue, timeline) {
      const index = timeline.findIndex((cue) => {
        return cue.startTime === activeCue.startTime && cue.endTime === activeCue.endTime && cue.text === activeCue.text;
      });

      if (index < 0) {
        return {
          current: activeCue.text,
          before: [],
          after: []
        };
      }

      return {
        current: activeCue.text,
        before: timeline.slice(Math.max(0, index - 2), index).map((cue) => cue.text),
        after: timeline.slice(index + 1, index + 3).map((cue) => cue.text)
      };
    }

    function ensureRoot() {
      const nextMountTarget = adapter.getMountTarget() || adapter.getSubtitleContainer() || document.body;
      if (!nextMountTarget) {
        return null;
      }

      if (root && mountTarget === nextMountTarget) {
        return root;
      }

      mountTarget = nextMountTarget;
      domUtils.ensureRelativePosition(mountTarget);

      if (root) {
        root.remove();
      }

      root = document.createElement('div');
      root.className = 'nll-overlay';

      const surface = document.createElement('div');
      surface.className = 'nll-overlay__surface';

      originalLine = document.createElement('div');
      originalLine.className = 'nll-overlay__original';

      translatedLine = document.createElement('div');
      translatedLine.className = 'nll-overlay__translation';

      statusLine = document.createElement('div');
      statusLine.className = 'nll-overlay__status';

      surface.append(originalLine, translatedLine, statusLine);
      root.appendChild(surface);
      mountTarget.appendChild(root);
      observeVideoScaleTarget();
      if (!layoutTimer) {
        layoutTimer = globalThis.setInterval(() => {
          updateLayoutMetrics();
        }, 250);
      }

      return root;
    }

    function render() {
      const settings = settingsStore.get();
      const state = subtitleStore.getState();
      if (!ensureRoot()) {
        return;
      }

      root.dataset.fontSize = settings.subtitleFontSize;
      observeVideoScaleTarget();
      updateLayoutMetrics();

      if (!settings.extensionEnabled) {
        root.hidden = true;
        wordController.hideTooltip();
        return;
      }

      if (!state.activeSubtitle.cue && !state.platformError) {
        root.hidden = true;
        wordController.hideTooltip();
        return;
      }

      root.hidden = false;

      domUtils.clearElement(originalLine);
      if (state.activeSubtitle.cue) {
        const context = buildContextWindow(state.activeSubtitle.cue, state.timeline);
        originalLine.appendChild(wordController.createInteractiveText(state.activeSubtitle.cue.text, {
          context,
          sourceLanguage: state.sourceLanguage
        }));
      }

      const shouldShowTranslation = settings.dualSubEnabled && settingsStore.shouldTranslate(state.sourceLanguage);
      const translationEntry = state.activeSubtitle.translationKey
        ? translationQueue.getEntry(state.activeSubtitle.translationKey)
        : null;
      const renderSignature = JSON.stringify([
        shouldShowTranslation,
        state.activeSubtitle.translationKey,
        translationEntry?.status || null,
        translationEntry?.text || null,
        translationEntry?.error || null
      ]);

      if (renderSignature !== lastTranslationRenderSignature) {
        lastTranslationRenderSignature = renderSignature;
        traceTranslation('overlay:render', {
          translationKey: state.activeSubtitle.translationKey,
          shouldShowTranslation,
          entryStatus: translationEntry?.status || null,
          entryText: translationEntry?.text || null,
          entryError: translationEntry?.error || null
        });
      }

      translatedLine.hidden = !shouldShowTranslation;
      translatedLine.textContent = '';

      if (shouldShowTranslation) {
        if (!translationEntry || translationEntry.status === 'pending') {
          translatedLine.textContent = 'Translating...';
          translatedLine.dataset.state = 'loading';
        } else if (translationEntry.status === 'error') {
          translatedLine.textContent = translationEntry.error || 'Translation unavailable';
          translatedLine.dataset.state = 'error';
        } else {
          translatedLine.textContent = translationEntry.text || '';
          translatedLine.dataset.state = 'success';
        }
      }

      statusLine.hidden = !state.platformError;
      statusLine.textContent = state.platformError || '';
    }

    const unsubscribeSettings = settingsStore.subscribe(render);
    const unsubscribeStore = subtitleStore.subscribe(render);
    const unsubscribeQueue = translationQueue.subscribe(render);

    return {
      syncMount: ensureRoot,
      render,
      destroy() {
        unsubscribeSettings();
        unsubscribeStore();
        unsubscribeQueue();
        wordController.hideTooltip();
        if (root) {
          root.remove();
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        if (layoutTimer) {
          globalThis.clearInterval(layoutTimer);
          layoutTimer = null;
        }
      }
    };
  }

  core.createOverlayController = createOverlayController;
})();
