(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const platform = app.platform = app.platform || {};
  const languageUtils = app.languageUtils;

  const PAGE_MESSAGE_SOURCE = 'nll:netflix-page';
  const MOUNT_TARGET_SELECTORS = [
    '[data-uia="watch-video"]',
    '[data-uia="player"]',
    '.watch-video',
    '.NFPlayer'
  ];
  const WATCH_PATH_PATTERN = /^\/watch(\/|$)/;
  function createEmitter() {
    const listeners = new Set();

    return {
      emit(event) {
        listeners.forEach((listener) => listener(event));
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }
    };
  }

  function cuesEqual(left, right) {
    if (!left && !right) {
      return true;
    }

    if (!left || !right) {
      return false;
    }

    return left.startTime === right.startTime
      && left.endTime === right.endTime
      && left.text === right.text;
  }

  function timelinesEqual(left, right) {
    if (left === right) {
      return true;
    }

    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!cuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  function isGenericTitle(value) {
    const normalized = languageUtils.normalizeCueText(value);
    return !normalized || /^netflix$/i.test(normalized);
  }

  function findCueAtTime(timeline, currentTime) {
    if (!Array.isArray(timeline) || !timeline.length || !Number.isFinite(currentTime)) {
      return null;
    }

    let low = 0;
    let high = timeline.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const cue = timeline[middle];
      if (currentTime < cue.startTime) {
        high = middle - 1;
      } else if (currentTime > cue.endTime) {
        low = middle + 1;
      } else {
        return cue;
      }
    }

    return null;
  }

  function createNetflixAdapter() {
    const emitter = createEmitter();

    let video = null;
    let title = '';
    let mutationObserver = null;
    let titleObserver = null;
    let lastStatusMessage = undefined;
    let timeline = [];
    let activeCue = null;
    let sourceLanguage = 'en';
    let captionsEnabled = false;
    let currentTime = null;
    let playbackPaused = null;
    let pageState = null;
    let domScanHandle = null;
    let watchRouteActive = WATCH_PATH_PATTERN.test(globalThis.location.pathname);
    let preferredTranslation = {
      available: false,
      cue: null,
      trackLanguage: null,
      targetLanguage: null,
      provider: null
    };

    function emit(type, detail = {}) {
      emitter.emit({ type, ...detail });
    }

    function getVideo() {
      return video;
    }

    function getCurrentTime() {
      return Number.isFinite(currentTime) ? currentTime : (video ? video.currentTime : NaN);
    }

    function seekAndPlay(time) {
      const nextTime = Number(time);
      if (!Number.isFinite(nextTime)) {
        return false;
      }

      globalThis.postMessage({
        type: 'nll:player-command',
        nonce: app.pageScriptNonce || null,
        command: 'seek-and-play',
        payload: {
          time: nextTime
        }
      }, '*');
      return true;
    }

    function togglePlayback() {
      globalThis.postMessage({
        type: 'nll:player-command',
        nonce: app.pageScriptNonce || null,
        command: 'toggle-playback',
        payload: {}
      }, '*');
      return true;
    }

    function setSubtitlePreferences(preferences = {}) {
      globalThis.postMessage({
        type: 'nll:page-config',
        nonce: app.pageScriptNonce || null,
        payload: {
          extensionEnabled: Boolean(preferences.extensionEnabled),
          autoPauseEnabled: Boolean(preferences.autoPauseEnabled),
          targetLanguage: String(preferences.targetLanguage || ''),
          useNetflixTargetSubtitlesIfAvailable: Boolean(preferences.useNetflixTargetSubtitlesIfAvailable)
        }
      }, '*');
      return true;
    }

    function setNativeSubtitleVisibility(visible) {
      globalThis.postMessage({
        type: 'nll:player-command',
        nonce: app.pageScriptNonce || null,
        command: 'set-native-subtitle-visibility',
        payload: {
          visible: Boolean(visible)
        }
      }, '*');
      return true;
    }

    function getTitle() {
      const candidates = [
        document.querySelector('meta[property="og:title"]')?.content,
        document.querySelector('[data-uia="video-title"]')?.textContent,
        document.title
      ].map((value) => {
        return languageUtils.normalizeCueText(String(value || '').replace(/\s*-\s*Netflix\s*$/i, ''));
      }).filter(Boolean);

      const meaningfulTitle = candidates.find((value) => !isGenericTitle(value));
      if (meaningfulTitle) {
        return meaningfulTitle;
      }

      return title || candidates[0] || '';
    }

    function getWatchPlayerShell(videoNode) {
      if (!videoNode) {
        return null;
      }

      for (const selector of MOUNT_TARGET_SELECTORS) {
        const candidate = videoNode.closest(selector);
        if (candidate) {
          return candidate;
        }
      }

      return null;
    }

    function getVideoMountTarget(videoNode) {
      const watchPlayerShell = getWatchPlayerShell(videoNode);
      if (watchPlayerShell) {
        return watchPlayerShell;
      }

      return videoNode.parentElement || null;
    }

    function isWatchSessionActive() {
      return Boolean(pageState?.probe?.activeSessionId);
    }

    function isWatchPlaybackActive() {
      return Boolean(watchRouteActive && isWatchSessionActive() && video && getWatchPlayerShell(video));
    }

    function setWatchRouteActive(isActive) {
      const nextRouteState = Boolean(isActive);
      if (watchRouteActive === nextRouteState) {
        return;
      }

      watchRouteActive = nextRouteState;
      syncVideo();
      reportStatus();
    }

    function getMountTarget() {
      const mountTarget = getVideoMountTarget(video);
      if (mountTarget) {
        return mountTarget;
      }

      return document.body;
    }

    function getSubtitleContainer() {
      return null;
    }

    function getTimeline() {
      return timeline.slice();
    }

    function getSourceLanguage() {
      return languageUtils.normalizeLanguageCode(sourceLanguage || 'en');
    }

    function getFeatureAvailability() {
      const timelineReady = timeline.length > 0;

      return {
        dualSubs: timelineReady,
        wordLookup: timelineReady,
        subtitleNavigation: timelineReady,
        autoPause: timelineReady,
        repeat: timelineReady,
        playbackSpeed: Boolean(video),
        settings: true
      };
    }

    function isExpectedPageMessage(event) {
      if (!event.data || event.data.source !== PAGE_MESSAGE_SOURCE) {
        return false;
      }

      if (app.pageScriptNonce && event.data.nonce !== app.pageScriptNonce) {
        return false;
      }

      return true;
    }

    function requestPageState(reason) {
      globalThis.postMessage({
        type: 'nll:page-state-request',
        nonce: app.pageScriptNonce || null,
        reason
      }, '*');
    }

    function buildStatusMessage() {
      if (!video) {
        return 'Waiting for the Netflix video player.';
      }

      if (timeline.length > 0) {
        return null;
      }

      if (typeof pageState?.status?.message === 'string') {
        return pageState.status.message;
      }

      if (app.pageScriptNonce) {
        return 'Waiting for the LR-style Netflix page script to report subtitle state.';
      }

      return 'Waiting for the LR-style Netflix page script to start.';
    }

    function reportStatus() {
      const nextMessage = buildStatusMessage();
      if (nextMessage === lastStatusMessage) {
        return;
      }

      lastStatusMessage = nextMessage;
      emit('platformError', { error: nextMessage });
    }

    function syncTitle() {
      const nextTitle = getTitle();
      if (!nextTitle || nextTitle === title || (isGenericTitle(nextTitle) && !isGenericTitle(title))) {
        return;
      }

      title = nextTitle;
      emit('titleChanged', { title });
    }

    function resetSubtitleState() {
      timeline = [];
      activeCue = null;
      sourceLanguage = 'en';
      captionsEnabled = false;
      currentTime = null;
      playbackPaused = null;
      preferredTranslation = {
        available: false,
        cue: null,
        trackLanguage: null,
        targetLanguage: null,
        provider: null
      };
      emit('captionsChanged', { enabled: false });
      emit('timelineReady', { timeline: [] });
      emit('activeSubtitleChanged', { cue: null });
      emit('preferredTranslationChanged', { translation: preferredTranslation });
      reportStatus();
    }

    function syncVideo() {
      const nextVideo = (watchRouteActive && isWatchSessionActive())
        ? Array.from(document.querySelectorAll('video')).find((candidate) => Boolean(getWatchPlayerShell(candidate))) || null
        : null;
      if (nextVideo === video) {
        reportStatus();
        return;
      }

      video = nextVideo;
      emit('playerReady', { video });
      resetSubtitleState();
      if (video) {
        requestPageState('video-change');
      }
    }

    function handlePageState(payload) {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      pageState = payload;
      playbackPaused = typeof payload.probe?.paused === 'boolean'
        ? payload.probe.paused
        : playbackPaused;
      syncVideo();
      reportStatus();
    }

    function handleSubtitleState(payload) {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const nextTimeline = Array.isArray(payload.timeline)
        ? payload.timeline.map((cue) => ({
          startTime: Number(cue.startTime),
          endTime: Number(cue.endTime),
          text: languageUtils.normalizeCueText(cue.text)
        })).filter((cue) => Number.isFinite(cue.startTime) && Number.isFinite(cue.endTime) && cue.text)
        : timeline;
      const nextSourceLanguage = languageUtils.normalizeLanguageCode(payload.sourceLanguage || sourceLanguage || 'en');
      const nextCaptionsEnabled = Boolean(payload.captionsEnabled && nextTimeline.length > 0);
      const nextCurrentTime = typeof payload.ready?.currentTime === 'number'
        ? payload.ready.currentTime
        : currentTime;
      const nextPreferredTranslation = payload.preferredTranslation && typeof payload.preferredTranslation === 'object'
        ? {
            available: Boolean(payload.preferredTranslation.available),
            cue: payload.preferredTranslation.activeCue && typeof payload.preferredTranslation.activeCue === 'object'
              ? {
                  startTime: Number(payload.preferredTranslation.activeCue.startTime),
                  endTime: Number(payload.preferredTranslation.activeCue.endTime),
                  text: languageUtils.normalizeCueText(payload.preferredTranslation.activeCue.text)
                }
              : null,
            trackLanguage: payload.preferredTranslation.trackLanguage
              ? languageUtils.normalizeLanguageCode(payload.preferredTranslation.trackLanguage)
              : null,
            targetLanguage: payload.preferredTranslation.targetLanguage
              ? String(payload.preferredTranslation.targetLanguage).toUpperCase()
              : null,
            provider: payload.preferredTranslation.provider
              ? String(payload.preferredTranslation.provider)
              : null
          }
        : {
            available: false,
            cue: null,
            trackLanguage: null,
            targetLanguage: null,
            provider: null
          };
      const nextActiveCue = findCueAtTime(nextTimeline, nextCurrentTime) || (
        payload.activeCue && typeof payload.activeCue === 'object'
          ? {
            startTime: Number(payload.activeCue.startTime),
            endTime: Number(payload.activeCue.endTime),
            text: languageUtils.normalizeCueText(payload.activeCue.text)
          }
          : null
      );

      const timelineChanged = Array.isArray(payload.timeline) && !timelinesEqual(timeline, nextTimeline);
      const cueChanged = !cuesEqual(activeCue, nextActiveCue);
      const captionsChanged = captionsEnabled !== nextCaptionsEnabled;
      const sourceLanguageChanged = sourceLanguage !== nextSourceLanguage;
      const preferredTranslationChanged = preferredTranslation.available !== nextPreferredTranslation.available
        || preferredTranslation.trackLanguage !== nextPreferredTranslation.trackLanguage
        || preferredTranslation.targetLanguage !== nextPreferredTranslation.targetLanguage
        || preferredTranslation.provider !== nextPreferredTranslation.provider
        || !cuesEqual(preferredTranslation.cue, nextPreferredTranslation.cue);

      timeline = nextTimeline;
      activeCue = nextActiveCue;
      sourceLanguage = nextSourceLanguage;
      captionsEnabled = nextCaptionsEnabled;
      currentTime = Number.isFinite(nextCurrentTime) ? nextCurrentTime : currentTime;
      preferredTranslation = nextPreferredTranslation;
      playbackPaused = typeof pageState?.probe?.paused === 'boolean'
        ? pageState.probe.paused
        : playbackPaused;

      if (sourceLanguageChanged || timelineChanged) {
        emit('timelineReady', { timeline: timeline.slice() });
      }

      if (captionsChanged || timelineChanged) {
        emit('captionsChanged', { enabled: captionsEnabled });
      }

      if (cueChanged || timelineChanged) {
        emit('activeSubtitleChanged', { cue: activeCue });
      }

      if (preferredTranslationChanged) {
        emit('preferredTranslationChanged', {
          translation: preferredTranslation
        });
      }

      reportStatus();
    }

    function handlePageMessage(event) {
      if (!isExpectedPageMessage(event)) {
        return;
      }

      if (event.data.type === 'nll:player-debug') {
        emit('playerDebug', {
          stage: event.data.payload?.stage || 'page-debug',
          detail: event.data.payload?.detail || null
        });
        return;
      }

      if (event.data.type === 'nll:page-state') {
        handlePageState(event.data.payload);
        return;
      }

      if (event.data.type === 'nll:subtitle-state') {
        handleSubtitleState(event.data.payload);
        return;
      }

      if (event.data.type === 'nll:timedtext-status') {
        handlePageState({
          ...(pageState || {}),
          status: event.data.payload
        });
      }
    }

    function scanDom() {
      syncVideo();
      syncTitle();
    }

    function scheduleDomScan() {
      if (domScanHandle !== null) {
        return;
      }

      const schedule = typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (callback) => globalThis.setTimeout(callback, 16);

      domScanHandle = schedule(() => {
        domScanHandle = null;
        scanDom();
      });
    }

    async function init() {
      globalThis.addEventListener('message', handlePageMessage);
      scanDom();
      requestPageState('adapter-init');

      mutationObserver = new MutationObserver(() => {
        scheduleDomScan();
      });
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      const titleElement = document.querySelector('title');
      if (titleElement) {
        titleObserver = new MutationObserver(syncTitle);
        titleObserver.observe(titleElement, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    }

    function getDebugState() {
      return {
        hasVideo: Boolean(video),
        title,
        timelineLength: timeline.length,
        activeCue,
        sourceLanguage,
        captionsEnabled,
        currentTime,
        playbackPaused,
        preferredTranslation,
        featureAvailability: getFeatureAvailability(),
        status: lastStatusMessage,
        pageScriptNonce: app.pageScriptNonce || null,
        pageState
      };
    }

    return {
      id: 'netflix',
      init,
      getVideo,
      getCurrentTime,
      seekAndPlay,
      togglePlayback,
      setSubtitlePreferences,
      setNativeSubtitleVisibility,
      getTitle: () => title || getTitle(),
      getSourceLanguage,
      getMountTarget,
      isWatchPlaybackActive,
      setWatchRouteActive,
      getSubtitleContainer,
      getTimeline,
      getFeatureAvailability,
      getPreferredTranslation: () => ({
        ...preferredTranslation,
        cue: preferredTranslation.cue ? { ...preferredTranslation.cue } : null
      }),
      getDebugState,
      subscribe: emitter.subscribe
    };
  }

  platform.createNetflixAdapter = createNetflixAdapter;
})();
