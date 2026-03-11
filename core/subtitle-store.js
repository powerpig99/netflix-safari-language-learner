(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const languageUtils = app.languageUtils;
  const extensionApi = app.extensionApi;

  function traceTranslation(stage, detail) {
    if (globalThis.__NLL_TRACE_TRANSLATION__ === false) {
      return;
    }

    extensionApi && extensionApi.debugLog && extensionApi.debugLog.record('translation', stage, detail);
    console.debug('[NLL translation]', stage, detail);
  }

  const DEFAULT_FEATURE_AVAILABILITY = {
    dualSubs: false,
    wordLookup: false,
    subtitleNavigation: false,
    autoPause: false,
    repeat: false,
    playbackSpeed: true,
    settings: true
  };

  function normalizeCue(cue) {
    if (!cue) {
      return null;
    }
    const startTime = Number(cue.startTime);
    const endTime = Number(cue.endTime);
    const text = languageUtils.normalizeCueText(cue.text);

    if (!Number.isFinite(startTime) || !text) {
      return null;
    }

    return {
      startTime,
      endTime: Number.isFinite(endTime) ? endTime : startTime,
      text
    };
  }

  function createSubtitleStore() {
    const listeners = new Set();
    let state = {
      title: '',
      sourceLanguage: '',
      timeline: [],
      activeSubtitle: {
        cue: null,
        renderedText: null,
        translationKey: null
      },
      featureAvailability: { ...DEFAULT_FEATURE_AVAILABILITY },
      platformError: null,
      playerReady: false
    };

    function snapshot() {
      return {
        ...state,
        timeline: state.timeline.slice(),
        activeSubtitle: { ...state.activeSubtitle },
        featureAvailability: { ...state.featureAvailability }
      };
    }

    function emit() {
      const nextState = snapshot();
      listeners.forEach((listener) => listener(nextState));
    }

    function refreshTranslationKey(targetLanguage) {
      const cue = state.activeSubtitle.cue;
      const nextTranslationKey = cue ? languageUtils.toTranslationKey(state.title, targetLanguage, cue.text) : null;
      state = {
        ...state,
        activeSubtitle: {
          cue,
          renderedText: cue ? cue.text : null,
          translationKey: nextTranslationKey
        }
      };
      traceTranslation('store:refresh-key', {
        title: state.title,
        targetLanguage,
        cueText: cue?.text || null,
        translationKey: nextTranslationKey
      });
      emit();
    }

    function setTitle(title, targetLanguage = 'EN-US') {
      state = {
        ...state,
        title: languageUtils.normalizeCueText(title)
      };
      traceTranslation('store:set-title', {
        title: state.title,
        targetLanguage
      });
      refreshTranslationKey(targetLanguage);
    }

    function setSourceLanguage(sourceLanguage) {
      state = {
        ...state,
        sourceLanguage: languageUtils.normalizeLanguageCode(sourceLanguage || 'en')
      };
      emit();
    }

    function setTimeline(cues) {
      const timeline = Array.isArray(cues)
        ? cues.map(normalizeCue).filter(Boolean).sort((left, right) => left.startTime - right.startTime)
        : [];

      state = {
        ...state,
        timeline
      };
      emit();
    }

    function setActiveCue(cue, targetLanguage = 'EN-US') {
      const normalizedCue = normalizeCue(cue);
      const nextTranslationKey = normalizedCue ? languageUtils.toTranslationKey(state.title, targetLanguage, normalizedCue.text) : null;
      state = {
        ...state,
        activeSubtitle: {
          cue: normalizedCue,
          renderedText: normalizedCue ? normalizedCue.text : null,
          translationKey: nextTranslationKey
        }
      };
      traceTranslation('store:set-active-cue', {
        title: state.title,
        targetLanguage,
        cueText: normalizedCue?.text || null,
        translationKey: nextTranslationKey
      });
      emit();
    }

    function setFeatureAvailability(featureAvailability) {
      state = {
        ...state,
        featureAvailability: {
          ...DEFAULT_FEATURE_AVAILABILITY,
          ...(featureAvailability || {})
        }
      };
      emit();
    }

    function setPlatformError(errorMessage) {
      state = {
        ...state,
        platformError: errorMessage ? String(errorMessage) : null
      };
      emit();
    }

    function setPlayerReady(isReady) {
      state = {
        ...state,
        playerReady: Boolean(isReady)
      };
      emit();
    }

    function subscribe(listener, emitImmediately = true) {
      listeners.add(listener);
      if (emitImmediately) {
        listener(snapshot());
      }
      return () => {
        listeners.delete(listener);
      };
    }

    return {
      getState: snapshot,
      subscribe,
      refreshTranslationKey,
      refreshActiveTranslationKey: refreshTranslationKey,
      setTitle,
      setSourceLanguage,
      setTimeline,
      setActiveCue,
      setFeatureAvailability,
      setPlatformError,
      setPlayerReady
    };
  }

  core.createSubtitleStore = createSubtitleStore;
})();
