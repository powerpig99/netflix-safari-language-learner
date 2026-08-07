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
    let layoutTimer = null;
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

    function isVisibleNode(node) {
      if (domUtils && typeof domUtils.isVisibleElement === 'function') {
        return domUtils.isVisibleElement(node);
      }

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
    function collectLayoutExclusions(contentRect) {
      const exclusions = [];

      if (layoutExclusionStore && typeof layoutExclusionStore.getAll === 'function') {
        layoutExclusionStore.getAll().forEach((rect) => {
          exclusions.push(rect);
        });
      }

      if (mountTarget && typeof mountTarget.querySelectorAll === 'function') {
        const interactiveNodes = mountTarget.querySelectorAll('button, [role="button"], input, [aria-label], [data-uia]');
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
          if (rect.width <= 4 || rect.height <= 4) {
            return;
          }

          exclusions.push({
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom
          });
        });

        const panel = mountTarget.querySelector('.nll-control-panel.is-visible');
        if (panel instanceof Element && isVisibleNode(panel)) {
          const panelRect = panel.getBoundingClientRect();
          if (panelRect.width > 4 && panelRect.height > 4) {
            exclusions.push({
              id: 'extension-control-panel',
              left: panelRect.left,
              top: panelRect.top,
              width: panelRect.width,
              height: panelRect.height,
              right: panelRect.right,
              bottom: panelRect.bottom
            });
          }
        }
      }

      // Prefer live exclusions; fall back to stable bands only when nothing else is known.
      if (exclusions.length === 0 && layoutEngine && contentRect) {
        return layoutEngine.computeControlBandExclusions(contentRect);
      }

      return exclusions;
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
      if (!layoutTimer) {
        layoutTimer = globalThis.setInterval(() => {
          requestLayoutUpdate();
        }, 250);
      }

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
        if (layoutTimer) {
          globalThis.clearInterval(layoutTimer);
          layoutTimer = null;
        }
      }
    };
  }

  core.createOverlayController = createOverlayController;
})();
