(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const domUtils = app.domUtils;
  const languageUtils = app.languageUtils;
  const extensionApi = app.extensionApi;
  const layoutEngine = core.overlayLayoutEngine;
  const layoutExclusionStore = core.layoutExclusionStore;

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
    let layoutFrame = null;

    function getLayoutRects() {
      if (!root || !mountTarget || typeof mountTarget.getBoundingClientRect !== 'function') {
        return null;
      }

      const video = adapter.getVideo();
      const mountRect = mountTarget.getBoundingClientRect();
      if (!mountRect.width || !mountRect.height) {
        return null;
      }

      const scaleTarget = (video && typeof video.getBoundingClientRect === 'function') ? video : mountTarget;
      const videoRect = scaleTarget && typeof scaleTarget.getBoundingClientRect === 'function'
        ? scaleTarget.getBoundingClientRect()
        : null;
      if (!videoRect || !videoRect.width || !videoRect.height) {
        return null;
      }

      const contentRect = (domUtils && typeof domUtils.getRenderedVideoRect === 'function'
        ? domUtils.getRenderedVideoRect(video, mountTarget)
        : null) || videoRect;

      return {
        mountRect,
        videoRect,
        contentRect
      };
    }

    function collectLayoutExclusions(contentRect) {
      // Single exclusion path: published store from visibility/panel owners.
      // Do not re-scan interactive Netflix DOM here — that reintroduces a second
      // geometry authority and was the old bottom-lift heuristic.
      if (layoutExclusionStore && typeof layoutExclusionStore.getAll === 'function') {
        const published = layoutExclusionStore.getAll();
        if (published.length > 0) {
          return published;
        }
      }

      // When controls are hidden, there are no published bands — use base inset only.
      // contentRect is accepted for API stability; no implicit band inventing while hidden.
      void contentRect;
      return [];
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
      const overlayRect = root ? root.getBoundingClientRect() : null;
      const estimatedOverlayHeight = overlayRect && overlayRect.height
        ? overlayRect.height
        : Math.max(root?.scrollHeight || 0, 72);

      let placement = null;
      if (layoutEngine && typeof layoutEngine.computeSubtitlePlacement === 'function') {
        placement = layoutEngine.computeSubtitlePlacement({
          mountRect,
          contentRect,
          exclusions: collectLayoutExclusions(contentRect),
          estimatedOverlayHeight
        });
      }

      if (!placement) {
        // Minimal fallback if the layout engine script failed to load.
        const scale = Math.min(2.1, Math.max(1, Math.min(contentRect.width / 1280, contentRect.height / 720)));
        const baseBottomInset = Math.max(10, Math.round(contentRect.height * 0.1));
        const videoBottomInset = Math.max(0, mountRect.bottom - contentRect.bottom);
        placement = {
          scale,
          left: (contentRect.left - mountRect.left) + (contentRect.width / 2),
          width: Math.max(260, Math.round(Math.min(contentRect.width * 0.96, 1480 * scale))),
          bottom: Math.round(videoBottomInset + baseBottomInset)
        };
      }

      root.style.setProperty('--nll-video-scale', String(placement.scale.toFixed(3)));
      root.style.left = `${placement.left}px`;
      root.style.width = `${placement.width}px`;
      root.style.bottom = `${placement.bottom}px`;
    }
    function requestLayoutUpdate() {
      if (layoutFrame !== null) {
        return;
      }

      layoutFrame = globalThis.requestAnimationFrame(() => {
        layoutFrame = null;
        updateLayoutMetrics();
      });
    }

    function observeVideoScaleTarget() {
      if (typeof ResizeObserver !== 'function') {
        requestLayoutUpdate();
        return;
      }

      const scaleTarget = adapter.getVideo() || mountTarget;
      if (!scaleTarget || observedScaleTarget === scaleTarget) {
        requestLayoutUpdate();
        return;
      }

      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          requestLayoutUpdate();
        });
      }

      if (observedScaleTarget) {
        resizeObserver.unobserve(observedScaleTarget);
      }

      observedScaleTarget = scaleTarget;
      resizeObserver.observe(scaleTarget);
      requestLayoutUpdate();
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
      const video = adapter.getVideo();
      const nextMountTarget = video
        ? (adapter.getMountTarget() || adapter.getSubtitleContainer() || document.body)
        : null;
      if (!nextMountTarget) {
        mountTarget = null;
        if (root) {
          root.remove();
          root = null;
        }
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
      return root;
    }

    function render() {
      const settings = settingsStore.get();
      const state = subtitleStore.getState();
      if (!ensureRoot()) {
        wordController.hideTooltip();
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
      const shouldUseNetflixTargetSubtitles = Boolean(
        settings.useNetflixTargetSubtitlesIfAvailable
        && state.preferredTranslation.available
      );
      const netflixTargetCue = shouldUseNetflixTargetSubtitles
        ? state.preferredTranslation.cue
        : null;
      const translationEntry = state.activeSubtitle.translationKey
        ? translationQueue.getEntry(state.activeSubtitle.translationKey)
        : null;
      const renderSignature = JSON.stringify([
        shouldShowTranslation,
        shouldUseNetflixTargetSubtitles,
        netflixTargetCue?.text || null,
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
          shouldUseNetflixTargetSubtitles,
          netflixTargetText: netflixTargetCue?.text || null,
          entryStatus: translationEntry?.status || null,
          entryText: translationEntry?.text || null,
          entryError: translationEntry?.error || null
        });
      }

      translatedLine.hidden = !shouldShowTranslation;
      translatedLine.textContent = '';

      if (shouldShowTranslation) {
        if (netflixTargetCue && netflixTargetCue.text) {
          translatedLine.textContent = netflixTargetCue.text;
          translatedLine.dataset.state = 'netflix';
        } else if (shouldUseNetflixTargetSubtitles) {
          translatedLine.hidden = false;
          translatedLine.textContent = '\u00a0';
          translatedLine.dataset.state = 'netflix-unavailable';
        } else if (!translationEntry || translationEntry.status === 'pending') {
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
      requestLayoutUpdate();
    }

    const unsubscribeSettings = settingsStore.subscribe(render);
    const unsubscribeStore = subtitleStore.subscribe(render);
    const unsubscribeQueue = translationQueue.subscribe(render);
    const unsubscribeExclusions = layoutExclusionStore && typeof layoutExclusionStore.subscribe === 'function'
      ? layoutExclusionStore.subscribe(() => {
        requestLayoutUpdate();
      })
      : () => {};

    return {
      syncMount: ensureRoot,
      render,
      destroy() {
        unsubscribeSettings();
        unsubscribeStore();
        unsubscribeQueue();
        unsubscribeExclusions();
        wordController.hideTooltip();
        if (root) {
          root.remove();
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        if (layoutFrame !== null) {
          globalThis.cancelAnimationFrame(layoutFrame);
          layoutFrame = null;
        }
      }
    };
  }

  core.createOverlayController = createOverlayController;
})();
