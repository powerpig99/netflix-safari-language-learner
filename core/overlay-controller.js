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

      return root;
    }

    function render() {
      const settings = settingsStore.get();
      const state = subtitleStore.getState();
      if (!ensureRoot()) {
        return;
      }

      root.dataset.fontSize = settings.subtitleFontSize;

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
      }
    };
  }

  core.createOverlayController = createOverlayController;
})();
