(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const domUtils = app.domUtils;
  const languageUtils = app.languageUtils;
  const extensionApi = app.extensionApi;
  const layoutEngine = core.overlayLayoutEngine;
  const layoutExclusionStore = core.layoutExclusionStore;

  const PANEL_INSET_PX = 16;

  function traceTranslation(stage, detail) {
    if (globalThis.__NLL_TRACE_TRANSLATION__ === false) {
      return;
    }

    extensionApi && extensionApi.debugLog && extensionApi.debugLog.record('translation', stage, detail);
    console.debug('[NLL translation]', stage, detail);
  }

  function createOverlayController({ adapter, settingsStore, subtitleStore, translationQueue, wordController }) {
    let mountTarget = null;
    let sceneRoot = null;
    let subtitleRoot = null;
    let panelHost = null;
    let originalLine = null;
    let translatedLine = null;
    let statusLine = null;
    let lastTranslationRenderSignature = '';
    let resizeObserver = null;
    let observedScaleTarget = null;
    let layoutFrame = null;
    const sceneListeners = new Set();

    function emitSceneChange() {
      const host = getPanelHost();
      sceneListeners.forEach((listener) => {
        try {
          listener({ host, sceneRoot, mountTarget });
        } catch (_error) {
          // Scene listeners must not break layout.
        }
      });
    }

    function getPanelHost() {
      return panelHost || sceneRoot || null;
    }

    function getLayoutRects() {
      if (!sceneRoot || !mountTarget || typeof mountTarget.getBoundingClientRect !== 'function') {
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

    function collectLayoutExclusions() {
      if (layoutExclusionStore && typeof layoutExclusionStore.getAll === 'function') {
        return layoutExclusionStore.getAll();
      }
      return [];
    }

    function updateLayoutMetrics() {
      const rects = getLayoutRects();
      if (!rects || !sceneRoot || !subtitleRoot) {
        return;
      }

      const { mountRect, contentRect } = rects;
      const contentLocal = domUtils && typeof domUtils.toLocalRect === 'function'
        ? domUtils.toLocalRect(contentRect, mountRect)
        : {
          left: contentRect.left - mountRect.left,
          top: contentRect.top - mountRect.top,
          width: contentRect.width,
          height: contentRect.height
        };

      // Scene owns the rendered video rect in mount-local coordinates.
      sceneRoot.style.left = `${Math.round(contentLocal.left)}px`;
      sceneRoot.style.top = `${Math.round(contentLocal.top)}px`;
      sceneRoot.style.width = `${Math.round(contentLocal.width)}px`;
      sceneRoot.style.height = `${Math.round(contentLocal.height)}px`;

      const subtitleBox = subtitleRoot.querySelector('.nll-overlay__surface') || subtitleRoot;
      const estimatedOverlayHeight = Math.max(
        subtitleBox.getBoundingClientRect?.().height || 0,
        subtitleRoot.scrollHeight || 0,
        72
      );

      // Placement is computed against a synthetic mount that matches the scene
      // (content rect), so bottom inset is scene-local.
      const sceneAsMount = {
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
        right: contentRect.right,
        bottom: contentRect.bottom
      };

      let placement = null;
      if (layoutEngine && typeof layoutEngine.computeSubtitlePlacement === 'function') {
        placement = layoutEngine.computeSubtitlePlacement({
          mountRect: sceneAsMount,
          contentRect,
          exclusions: collectLayoutExclusions(),
          estimatedOverlayHeight
        });
      }

      if (!placement) {
        const scale = Math.min(2.1, Math.max(1, Math.min(contentRect.width / 1280, contentRect.height / 720)));
        const baseBottomInset = Math.max(10, Math.round(contentRect.height * 0.1));
        placement = {
          scale,
          left: contentRect.width / 2,
          width: Math.max(260, Math.round(Math.min(contentRect.width * 0.96, 1480 * scale))),
          bottom: baseBottomInset
        };
      }

      subtitleRoot.style.setProperty('--nll-video-scale', String(placement.scale.toFixed(3)));
      subtitleRoot.style.left = `${placement.left}px`;
      subtitleRoot.style.width = `${placement.width}px`;
      subtitleRoot.style.bottom = `${placement.bottom}px`;
      subtitleRoot.style.top = 'auto';
      subtitleRoot.style.right = 'auto';
      subtitleRoot.style.transform = 'translateX(-50%)';

      if (panelHost) {
        panelHost.style.top = `${PANEL_INSET_PX}px`;
        panelHost.style.right = `${PANEL_INSET_PX}px`;
        panelHost.style.left = 'auto';
        panelHost.style.bottom = 'auto';
      }
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
        if (sceneRoot) {
          sceneRoot.remove();
          sceneRoot = null;
          subtitleRoot = null;
          panelHost = null;
          originalLine = null;
          translatedLine = null;
          statusLine = null;
          emitSceneChange();
        }
        return null;
      }

      if (sceneRoot && mountTarget === nextMountTarget) {
        return sceneRoot;
      }

      mountTarget = nextMountTarget;
      if (domUtils && typeof domUtils.ensureRelativePosition === 'function') {
        domUtils.ensureRelativePosition(mountTarget);
      }

      if (sceneRoot) {
        sceneRoot.remove();
      }

      sceneRoot = document.createElement('div');
      sceneRoot.className = 'nll-scene';
      sceneRoot.dataset.nllScene = '1';

      panelHost = document.createElement('div');
      panelHost.className = 'nll-scene__panel-host';

      subtitleRoot = document.createElement('div');
      subtitleRoot.className = 'nll-overlay';

      const surface = document.createElement('div');
      surface.className = 'nll-overlay__surface';

      originalLine = document.createElement('div');
      originalLine.className = 'nll-overlay__original';

      translatedLine = document.createElement('div');
      translatedLine.className = 'nll-overlay__translation';

      statusLine = document.createElement('div');
      statusLine.className = 'nll-overlay__status';

      surface.append(originalLine, translatedLine, statusLine);
      subtitleRoot.appendChild(surface);
      sceneRoot.append(panelHost, subtitleRoot);
      mountTarget.appendChild(sceneRoot);

      core.overlayScene = {
        getHost: getPanelHost,
        getSceneRoot: () => sceneRoot,
        getMountTarget: () => mountTarget,
        requestLayout: requestLayoutUpdate,
        subscribe(listener) {
          sceneListeners.add(listener);
          return () => {
            sceneListeners.delete(listener);
          };
        }
      };

      observeVideoScaleTarget();
      emitSceneChange();
      return sceneRoot;
    }

    function render() {
      const settings = settingsStore.get();
      const state = subtitleStore.getState();
      if (!ensureRoot()) {
        wordController.hideTooltip();
        return;
      }

      subtitleRoot.dataset.fontSize = settings.subtitleFontSize;
      observeVideoScaleTarget();
      updateLayoutMetrics();

      const sceneEnabled = Boolean(settings.extensionEnabled);
      sceneRoot.hidden = !sceneEnabled;
      if (!sceneEnabled) {
        wordController.hideTooltip();
        return;
      }

      const hasSubtitleContent = Boolean(state.activeSubtitle.cue || state.platformError);
      subtitleRoot.hidden = !hasSubtitleContent;
      if (!hasSubtitleContent) {
        wordController.hideTooltip();
        requestLayoutUpdate();
        return;
      }

      if (domUtils && typeof domUtils.clearElement === 'function') {
        domUtils.clearElement(originalLine);
      } else {
        originalLine.textContent = '';
      }

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
      getPanelHost,
      getSceneRoot: () => sceneRoot,
      subscribeScene: (listener) => {
        sceneListeners.add(listener);
        return () => {
          sceneListeners.delete(listener);
        };
      },
      destroy() {
        unsubscribeSettings();
        unsubscribeStore();
        unsubscribeQueue();
        unsubscribeExclusions();
        sceneListeners.clear();
        wordController.hideTooltip();
        if (sceneRoot) {
          sceneRoot.remove();
        }
        sceneRoot = null;
        subtitleRoot = null;
        panelHost = null;
        mountTarget = null;
        if (core.overlayScene) {
          core.overlayScene = null;
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
