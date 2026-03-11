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
    let pageState = null;

    function emit(type, detail = {}) {
      emitter.emit({ type, ...detail });
    }

    function getVideo() {
      return video;
    }

    function getCurrentTime() {
      return Number.isFinite(currentTime) ? currentTime : (video ? video.currentTime : NaN);
    }

    function seekToTime(time, options = {}) {
      const nextTime = Number(time);
      if (!Number.isFinite(nextTime)) {
        return false;
      }

      globalThis.postMessage({
        type: 'nll:player-command',
        nonce: app.pageScriptNonce || null,
        command: 'seek',
        payload: {
          time: nextTime,
          preservePaused: Boolean(options.preservePaused)
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

    function getMountTarget() {
      if (video) {
        for (const selector of MOUNT_TARGET_SELECTORS) {
          const candidate = video.closest(selector);
          if (candidate) {
            return candidate;
          }
        }

        if (video.parentElement) {
          return video.parentElement;
        }
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
      pageState = null;
      emit('captionsChanged', { enabled: false });
      emit('timelineReady', { timeline: [] });
      emit('activeSubtitleChanged', { cue: null });
      reportStatus();
    }

    function syncVideo() {
      const nextVideo = document.querySelector('video');
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

      timeline = nextTimeline;
      activeCue = nextActiveCue;
      sourceLanguage = nextSourceLanguage;
      captionsEnabled = nextCaptionsEnabled;
      currentTime = Number.isFinite(nextCurrentTime) ? nextCurrentTime : currentTime;

      if (sourceLanguageChanged || timelineChanged) {
        emit('timelineReady', { timeline: timeline.slice() });
      }

      if (captionsChanged || timelineChanged) {
        emit('captionsChanged', { enabled: captionsEnabled });
      }

      if (cueChanged || timelineChanged) {
        emit('activeSubtitleChanged', { cue: activeCue });
      }

      reportStatus();
    }

    function handlePageMessage(event) {
      if (!isExpectedPageMessage(event)) {
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

    async function init() {
      globalThis.addEventListener('message', handlePageMessage);
      scanDom();
      requestPageState('adapter-init');

      mutationObserver = new MutationObserver(() => {
        scanDom();
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
      seekToTime,
      setNativeSubtitleVisibility,
      getTitle: () => title || getTitle(),
      getSourceLanguage,
      getMountTarget,
      getSubtitleContainer,
      getTimeline,
      getFeatureAvailability,
      getDebugState,
      subscribe: emitter.subscribe
    };
  }

  platform.createNetflixAdapter = createNetflixAdapter;
})();
