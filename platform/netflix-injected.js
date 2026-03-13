(() => {
  if (globalThis.__NLL_NETFLIX_INJECTED__) {
    return;
  }

  globalThis.__NLL_NETFLIX_INJECTED__ = true;

  const MESSAGE_SOURCE = 'nll:netflix-page';
  const WATCH_PATH_PATTERN = /^\/watch(\/|$)/;
  const PROBE_POLL_INTERVAL_MS = 1500;
  const SUBTITLE_POLL_INTERVAL_MS = 180;
  const SUBTITLE_FETCH_RETRY_MS = 15000;
  const AUTO_PAUSE_LEAD_MS = 200;
  const NETFLIX_PLAYER_TIME_SCALE = 1000;
  const SUBTITLE_PROFILE = 'webvtt-lssdh-ios8';
  const SUBTITLE_PROFILE_PREFERENCES = [
    'webvtt-lssdh-ios8'
  ];
  const PLAYER_METHOD_NAMES = [
    'getTimedTextTrackList',
    'getTimedTextTrack',
    'setTimedTextTrack',
    'getAudioTrackList',
    'getAudioTrack',
    'setAudioTrack',
    'getCurrentTime',
    'seek',
    'play',
    'pause',
    'getPlaying',
    'getPaused',
    'getPlaybackRate',
    'setPlaybackRate',
    'getMovieId',
    'getElement'
  ];

  const originalJsonParse = JSON.parse;
  const originalJsonStringify = JSON.stringify;
  const manifestCache = new Map();
  const subtitleCache = new Map();
  const pendingSubtitleLoads = new Map();
  const requestHydrationDebug = {
    patchCount: 0,
    lastPatchedRequest: null
  };
  const debugState = {
    probe: null,
    manifest: null,
    selection: null,
    ready: null,
    status: null,
    requestHydration: requestHydrationDebug
  };

  function readLoaderNonce() {
    const loaderScript = document.currentScript || document.getElementById('nll-netflix-injected-script');
    const datasetNonce = loaderScript?.dataset?.nllNonce || null;
    if (datasetNonce) {
      return datasetNonce;
    }

    return document.documentElement.getAttribute('data-nll-page-script-nonce') || null;
  }

  const loaderNonce = readLoaderNonce();
  const htmlDecoder = document.createElement('textarea');

  let lastPageStateSignature = '';
  let lastSubtitleStateSignature = '';
  let lastTimelineKeySent = null;
  let refreshInFlight = false;
  let queuedRefreshReason = null;
  let boundMediaElement = null;
  let activeTimelineResolution = createTimelineResolutionState();
  let preferredTimelineResolution = createTimelineResolutionState();
  const subtitlePreferences = {
    extensionEnabled: false,
    autoPauseEnabled: false,
    targetLanguage: '',
    useNetflixTargetSubtitlesIfAvailable: false
  };
  const autoPauseState = {
    rafId: null,
    active: false,
    awaitingSeeked: false,
    seekGeneration: 0,
    pendingSeekTargetTime: null,
    pendingPlayAfterSeek: false,
    currentCueKey: null,
    currentCueStartTime: null,
    currentCueEndTime: null,
    currentCueTriggerTime: null,
    previousTime: null,
    lastFrameCheckLogAt: 0
  };

  function post(type, payload = {}) {
    globalThis.postMessage({
      source: MESSAGE_SOURCE,
      nonce: loaderNonce,
      type,
      payload
    }, '*');
  }

  function postDebug(stage, detail = {}) {
    post('nll:player-debug', {
      stage,
      detail
    });
  }

  function safeCall(fn) {
    try {
      return fn();
    } catch (error) {
      return {
        __nllError: error?.message || String(error)
      };
    }
  }

  function unwrapResult(value) {
    return value && typeof value === 'object' && '__nllError' in value
      ? { error: value.__nllError, value: null }
      : { error: null, value };
  }

  function cloneJson(value) {
    try {
      return originalJsonParse(originalJsonStringify(value));
    } catch (error) {
      return null;
    }
  }

  function normalizePlayerTime(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric / NETFLIX_PLAYER_TIME_SCALE;
  }

  function toPlayerTime(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric * NETFLIX_PLAYER_TIME_SCALE;
  }

  function normalizeCueText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getCueKey(cue) {
    if (!cue) {
      return null;
    }

    return [
      Number(cue.startTime),
      Number(cue.endTime),
      String(cue.text || '')
    ].join('|');
  }

  function clearAutoPauseTimer(reason = null, { deactivate = true } = {}) {
    if (autoPauseState.rafId !== null) {
      globalThis.cancelAnimationFrame(autoPauseState.rafId);
      autoPauseState.rafId = null;
    }

    if (deactivate) {
      autoPauseState.active = false;
      autoPauseState.awaitingSeeked = false;
    }

    if (reason) {
      postDebug('page-autopause:clear', {
        reason,
        deactivate
      });
    }
  }

  function scheduleAutoPauseFrame(reason = null) {
    if (!autoPauseState.active || autoPauseState.rafId !== null) {
      return;
    }

    if (reason) {
      postDebug('page-autopause:schedule-frame', { reason });
    }

    autoPauseState.rafId = globalThis.requestAnimationFrame(runAutoPauseFrame);
  }

  function resetAutoPauseTraversal(reason = null) {
    autoPauseState.currentCueKey = null;
    autoPauseState.currentCueStartTime = null;
    autoPauseState.currentCueEndTime = null;
    autoPauseState.currentCueTriggerTime = null;
    autoPauseState.previousTime = null;

    if (reason) {
      postDebug('page-autopause:reset', { reason });
    }
  }

  function setAutoPauseTraversal(cue, currentTime, reason = null) {
    autoPauseState.currentCueKey = cue ? getCueKey(cue) : null;
    autoPauseState.currentCueStartTime = cue ? Number(cue.startTime) : null;
    autoPauseState.currentCueEndTime = cue ? Number(cue.endTime) : null;
    autoPauseState.currentCueTriggerTime = cue ? (Number(cue.endTime) - (AUTO_PAUSE_LEAD_MS / 1000)) : null;
    autoPauseState.previousTime = Number.isFinite(Number(currentTime))
      ? Number(currentTime)
      : null;

    postDebug('page-autopause:set-traversal', {
      reason,
      currentTime: autoPauseState.previousTime,
      cueStartTime: autoPauseState.currentCueStartTime,
      cueEndTime: autoPauseState.currentCueEndTime,
      triggerTime: autoPauseState.currentCueTriggerTime,
      cueKey: autoPauseState.currentCueKey
    });
  }

  function normalizeLanguageCode(languageCode) {
    const normalized = String(languageCode || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    const withoutRegion = normalized.split(/[-_]/)[0];
    return withoutRegion === 'nb' ? 'no' : withoutRegion;
  }

  function createTimelineResolutionState() {
    return {
      selection: null,
      result: null
    };
  }

  function clearTimelineResolutionState(resolutionState) {
    resolutionState.selection = null;
    resolutionState.result = null;
  }

  function decodeHtmlEntities(text) {
    htmlDecoder.innerHTML = String(text || '');
    return htmlDecoder.value;
  }

  function stripMarkup(text) {
    return decodeHtmlEntities(String(text || '').replace(/<[^>]*>/g, ' '));
  }

  function parseTimestamp(value) {
    const match = String(value || '').trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/);
    if (!match) {
      return null;
    }

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const milliseconds = Number(match[4] || 0);
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
  }

  function parseTimeExpression(value, timingContext = {}) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const clockMatch = normalized.match(/^(?:(\d+):)?(\d{2}):(\d{2})(?:[.,](\d+))?$/);
    if (clockMatch) {
      const hours = Number(clockMatch[1] || 0);
      const minutes = Number(clockMatch[2] || 0);
      const seconds = Number(clockMatch[3] || 0);
      const fraction = clockMatch[4] ? Number(`0.${clockMatch[4]}`) : 0;
      return (hours * 3600) + (minutes * 60) + seconds + fraction;
    }

    const frameMatch = normalized.match(/^(?:(\d+):)?(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (frameMatch) {
      const hours = Number(frameMatch[1] || 0);
      const minutes = Number(frameMatch[2] || 0);
      const seconds = Number(frameMatch[3] || 0);
      const frames = Number(frameMatch[4] || 0);
      const subFrames = frameMatch[5] ? Number(`0.${frameMatch[5]}`) : 0;
      const frameRate = Number.isFinite(Number(timingContext.frameRate)) && Number(timingContext.frameRate) > 0
        ? Number(timingContext.frameRate)
        : 30;
      const subFrameRate = Number.isFinite(Number(timingContext.subFrameRate)) && Number(timingContext.subFrameRate) > 0
        ? Number(timingContext.subFrameRate)
        : 1;
      return (hours * 3600) + (minutes * 60) + seconds + ((frames + (subFrames / subFrameRate)) / frameRate);
    }

    const offsetMatch = normalized.match(/^(-?\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/);
    if (!offsetMatch) {
      return null;
    }

    const magnitude = Number(offsetMatch[1]);
    if (!Number.isFinite(magnitude)) {
      return null;
    }

    if (offsetMatch[2] === 'h') {
      return magnitude * 3600;
    }

    if (offsetMatch[2] === 'm') {
      return magnitude * 60;
    }

    if (offsetMatch[2] === 's') {
      return magnitude;
    }

    if (offsetMatch[2] === 'ms') {
      return magnitude / 1000;
    }

    if (offsetMatch[2] === 'f') {
      const frameRate = Number.isFinite(Number(timingContext.frameRate)) && Number(timingContext.frameRate) > 0
        ? Number(timingContext.frameRate)
        : 30;
      return magnitude / frameRate;
    }

    if (offsetMatch[2] === 't') {
      const tickRate = Number.isFinite(Number(timingContext.tickRate)) && Number(timingContext.tickRate) > 0
        ? Number(timingContext.tickRate)
        : 1;
      return magnitude / tickRate;
    }

    return null;
  }

  function parseVtt(text) {
    const lines = String(text || '').replace(/\uFEFF/g, '').split(/\r?\n/);
    const cues = [];
    let index = 0;

    while (index < lines.length) {
      let line = lines[index].trim();
      if (!line || line === 'WEBVTT') {
        index += 1;
        continue;
      }

      if (line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
        index += 1;
        while (index < lines.length && lines[index].trim()) {
          index += 1;
        }
        continue;
      }

      if (!line.includes('-->')) {
        index += 1;
        if (index >= lines.length) {
          break;
        }
        line = lines[index].trim();
      }

      if (!line.includes('-->')) {
        index += 1;
        continue;
      }

      const timingMatch = line.match(/^(\S+)\s+-->\s+(\S+)/);
      if (!timingMatch) {
        index += 1;
        continue;
      }

      const startTime = parseTimestamp(timingMatch[1]);
      const endTime = parseTimestamp(timingMatch[2]);
      index += 1;

      const textLines = [];
      while (index < lines.length && lines[index].trim()) {
        textLines.push(lines[index]);
        index += 1;
      }

      const normalizedText = normalizeCueText(stripMarkup(textLines.join(' ')));
      if (Number.isFinite(startTime) && Number.isFinite(endTime) && normalizedText) {
        cues.push({
          startTime,
          endTime,
          text: normalizedText
        });
      }

      index += 1;
    }

    cues.sort((left, right) => left.startTime - right.startTime);
    return cues;
  }

  function normalizeSubtitleText(text) {
    return normalizeCueText(stripMarkup(String(text || '').replace(/<br\s*\/?>/gi, '\n')));
  }

  function getTtmlParagraphElements(documentNode) {
    const candidates = [];
    const directMatches = Array.from(documentNode.getElementsByTagName('p'));
    const namespaceMatches = typeof documentNode.getElementsByTagNameNS === 'function'
      ? Array.from(documentNode.getElementsByTagNameNS('*', 'p'))
      : [];

    directMatches.concat(namespaceMatches).forEach((element) => {
      if (element && !candidates.includes(element)) {
        candidates.push(element);
      }
    });

    if (candidates.length > 0) {
      return candidates;
    }

    return Array.from(documentNode.getElementsByTagName('*')).filter((element) => {
      const tagName = String(element?.tagName || '').toLowerCase();
      const localName = String(element?.localName || '').toLowerCase();
      return tagName === 'p' || tagName.endsWith(':p') || localName === 'p';
    });
  }

  function parseTtmlAttributes(serializedOpenTag) {
    const attributes = {};
    String(serializedOpenTag || '').replace(/([A-Za-z_][\w:.-]*)\s*=\s*(['"])(.*?)\2/g, (_, name, __, value) => {
      attributes[name] = value;
      const localName = name.includes(':') ? name.split(':').pop() : name;
      if (!(localName in attributes)) {
        attributes[localName] = value;
      }
      return '';
    });
    return attributes;
  }

  function readTimingContextValue(attributes, names) {
    for (const name of names) {
      if (attributes[name] != null && attributes[name] !== '') {
        const numeric = Number(attributes[name]);
        if (Number.isFinite(numeric) && numeric > 0) {
          return numeric;
        }
      }
    }

    return null;
  }

  function parseTtmlTimingContextFromXml(xml) {
    const ttMatch = String(xml || '').match(/<tt\b([^>]*)>/i);
    const attributes = ttMatch ? parseTtmlAttributes(ttMatch[1]) : {};
    return {
      frameRate: readTimingContextValue(attributes, ['ttp:frameRate', 'frameRate']) || 30,
      subFrameRate: readTimingContextValue(attributes, ['ttp:subFrameRate', 'subFrameRate']) || 1,
      tickRate: readTimingContextValue(attributes, ['ttp:tickRate', 'tickRate']) || 1
    };
  }

  function parseTtmlTimingContextFromDocument(documentNode, xml) {
    const root = documentNode?.documentElement;
    if (!root || typeof root.getAttribute !== 'function') {
      return parseTtmlTimingContextFromXml(xml);
    }

    const attributeMap = {
      'ttp:frameRate': root.getAttribute('ttp:frameRate'),
      frameRate: root.getAttribute('frameRate'),
      'ttp:subFrameRate': root.getAttribute('ttp:subFrameRate'),
      subFrameRate: root.getAttribute('subFrameRate'),
      'ttp:tickRate': root.getAttribute('ttp:tickRate'),
      tickRate: root.getAttribute('tickRate')
    };

    return {
      frameRate: readTimingContextValue(attributeMap, ['ttp:frameRate', 'frameRate']) || 30,
      subFrameRate: readTimingContextValue(attributeMap, ['ttp:subFrameRate', 'subFrameRate']) || 1,
      tickRate: readTimingContextValue(attributeMap, ['ttp:tickRate', 'tickRate']) || 1
    };
  }

  function buildCueFromTimes(startTime, endTime, duration, text) {
    const resolvedEndTime = Number.isFinite(endTime)
      ? endTime
      : (Number.isFinite(startTime) && Number.isFinite(duration) ? startTime + duration : null);
    const normalizedText = normalizeSubtitleText(text);

    if (!Number.isFinite(startTime) || !Number.isFinite(resolvedEndTime) || !normalizedText) {
      return null;
    }

    return {
      startTime,
      endTime: resolvedEndTime,
      text: normalizedText
    };
  }

  function parseTtmlWithRegex(xml, timingContext) {
    const cues = [];
    const patterns = [
      /<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
      /<span\b([^>]*)>([\s\S]*?)<\/span>/gi
    ];

    patterns.forEach((pattern) => {
      let match = pattern.exec(xml);

      while (match) {
        const attributes = parseTtmlAttributes(match[1]);
        const cue = buildCueFromTimes(
          parseTimeExpression(attributes.begin, timingContext),
          parseTimeExpression(attributes.end, timingContext),
          parseTimeExpression(attributes.dur, timingContext),
          match[2]
        );
        if (cue) {
          cues.push(cue);
        }
        match = pattern.exec(xml);
      }
    });

    cues.sort((left, right) => left.startTime - right.startTime);
    return cues;
  }

  function parseTtml(text) {
    const xml = String(text || '').trim();
    if (!xml) {
      return [];
    }

    let documentNode;
    try {
      documentNode = new DOMParser().parseFromString(xml, 'application/xml');
    } catch (error) {
      return [];
    }

    if (!documentNode || documentNode.getElementsByTagName('parsererror').length > 0) {
      return parseTtmlWithRegex(xml, parseTtmlTimingContextFromXml(xml));
    }

    const timingContext = parseTtmlTimingContextFromDocument(documentNode, xml);
    const paragraphs = getTtmlParagraphElements(documentNode);
    const cues = [];

    paragraphs.forEach((element) => {
      const cue = buildCueFromTimes(
        parseTimeExpression(element.getAttribute('begin'), timingContext),
        parseTimeExpression(element.getAttribute('end'), timingContext),
        parseTimeExpression(element.getAttribute('dur'), timingContext),
        element.innerHTML || element.textContent || ''
      );

      if (cue) {
        cues.push(cue);
      }
    });

    if (cues.length === 0) {
      const timedSpans = Array.from(documentNode.getElementsByTagName('*')).filter((element) => {
        const localName = String(element?.localName || '').toLowerCase();
        return localName === 'span'
          && (element.hasAttribute('begin') || element.hasAttribute('end') || element.hasAttribute('dur'));
      });

      timedSpans.forEach((element) => {
        const cue = buildCueFromTimes(
          parseTimeExpression(element.getAttribute('begin'), timingContext),
          parseTimeExpression(element.getAttribute('end'), timingContext),
          parseTimeExpression(element.getAttribute('dur'), timingContext),
          element.innerHTML || element.textContent || ''
        );

        if (cue) {
          cues.push(cue);
        }
      });
    }

    if (cues.length === 0) {
      return parseTtmlWithRegex(xml, timingContext);
    }

    cues.sort((left, right) => left.startTime - right.startTime);
    return cues;
  }

  function sniffSubtitleFormat(text, contentType) {
    const normalizedContentType = String(contentType || '').toLowerCase();
    const normalizedText = String(text || '').trim();

    if (!normalizedText) {
      return 'empty';
    }

    if (normalizedContentType.includes('vtt') || normalizedText.startsWith('WEBVTT')) {
      return 'webvtt';
    }

    if (
      normalizedContentType.includes('ttml')
      || normalizedContentType.includes('xml')
      || /^<\?xml/i.test(normalizedText)
      || /<tt[\s>]/i.test(normalizedText)
    ) {
      return 'ttml';
    }

    if (/^[\[{]/.test(normalizedText)) {
      return 'json';
    }

    return 'unknown';
  }

  function parseSubtitlePayload(text, contentType) {
    const format = sniffSubtitleFormat(text, contentType);
    let timeline = [];

    if (format === 'webvtt') {
      timeline = parseVtt(text);
    } else if (format === 'ttml') {
      timeline = parseTtml(text);
    }

    return {
      format,
      timeline,
      preview: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    };
  }

  function listMethodNames(target, maxDepth = 3) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
      return [];
    }

    const names = new Set();
    let current = target;
    let depth = 0;

    while (current && current !== Object.prototype && depth < maxDepth) {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      Object.keys(descriptors).forEach((name) => {
        if (name === 'constructor') {
          return;
        }

        if (typeof descriptors[name].value === 'function') {
          names.add(name);
        }
      });
      current = Object.getPrototypeOf(current);
      depth += 1;
    }

    return Array.from(names).sort();
  }

  function listOwnKeys(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
      return [];
    }

    try {
      return Object.getOwnPropertyNames(value).sort().slice(0, 50);
    } catch (error) {
      return [];
    }
  }

  function normalizeSessionIds(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => String(item))
      .slice(0, 10);
  }

  function buildMethodAvailability(target) {
    const availability = {};
    PLAYER_METHOD_NAMES.forEach((name) => {
      availability[name] = typeof target?.[name] === 'function';
    });
    return availability;
  }

  function getDownloadableKeys(value) {
    if (!value || typeof value !== 'object') {
      return [];
    }

    try {
      return Object.keys(value).sort().slice(0, 20);
    } catch (error) {
      return [];
    }
  }

  function hasManifestLikeTrackData(track) {
    if (!track || typeof track !== 'object') {
      return false;
    }

    return Boolean(
      track.downloadableId
      || track.downloadable_id
      || track.new_track_id
      || (track.downloadableIds && typeof track.downloadableIds === 'object' && Object.keys(track.downloadableIds).length > 0)
      || (track.ttDownloadables && typeof track.ttDownloadables === 'object' && Object.keys(track.ttDownloadables).length > 0)
    );
  }

  function normalizeTrack(track) {
    if (!track || typeof track !== 'object') {
      return null;
    }

    return {
      id: track.id ?? null,
      trackId: track.trackId ?? null,
      newTrackId: track.new_track_id ?? track.newTrackId ?? null,
      trackType: track.trackType ?? null,
      bcp47: track.bcp47 ?? null,
      rawTrackType: track.rawTrackType ?? null,
      language: track.language ?? null,
      languageDescription: track.languageDescription ?? null,
      isForcedNarrative: track.isForcedNarrative ?? null,
      isNoneTrack: track.isNoneTrack ?? null,
      downloadableId: track.downloadableId ?? track.downloadable_id ?? null,
      downloadableIdsKeys: getDownloadableKeys(track.downloadableIds),
      ttDownloadablesKeys: getDownloadableKeys(track.ttDownloadables),
      hasManifestLikeData: hasManifestLikeTrackData(track),
      keys: listOwnKeys(track)
    };
  }

  function normalizeTrackList(value) {
    if (!Array.isArray(value)) {
      return {
        count: 0,
        sample: [],
        hasManifestLikeData: false,
        manifestLikeTrackCount: 0,
        sampleKeys: []
      };
    }

    const sample = value.slice(0, 5).map(normalizeTrack);
    const sampleKeys = new Set();
    sample.forEach((track) => {
      (track?.keys || []).forEach((key) => {
        sampleKeys.add(key);
      });
    });

    return {
      count: value.length,
      sample,
      hasManifestLikeData: value.some(hasManifestLikeTrackData),
      manifestLikeTrackCount: value.filter(hasManifestLikeTrackData).length,
      sampleKeys: Array.from(sampleKeys).sort()
    };
  }

  function normalizeElement(value) {
    if (!value || typeof value !== 'object' || !('tagName' in value)) {
      return null;
    }

    return {
      tagName: String(value.tagName || '').toLowerCase(),
      id: value.id || null,
      className: typeof value.className === 'string' ? value.className : null
    };
  }

  function getSessionContext() {
    const netflix = globalThis.netflix || null;
    const appContext = netflix?.appContext || null;
    const playerApp = appContext?.state?.playerApp || null;
    const apiResult = typeof playerApp?.getAPI === 'function' ? safeCall(() => playerApp.getAPI()) : null;
    const apiError = apiResult && apiResult.__nllError ? apiResult.__nllError : null;
    const api = apiError ? null : apiResult;
    const videoPlayer = api?.videoPlayer || null;
    const sessionIdsResult = videoPlayer && typeof videoPlayer.getAllPlayerSessionIds === 'function'
      ? safeCall(() => videoPlayer.getAllPlayerSessionIds())
      : [];
    const sessionIdsError = sessionIdsResult && sessionIdsResult.__nllError ? sessionIdsResult.__nllError : null;
    const sessionIds = sessionIdsError ? [] : normalizeSessionIds(sessionIdsResult);
    const activeSessionId = sessionIds.find((sessionId) => sessionId.startsWith('watch')) || sessionIds[0] || null;
    const sessionPlayerResult = activeSessionId && typeof videoPlayer?.getVideoPlayerBySessionId === 'function'
      ? safeCall(() => videoPlayer.getVideoPlayerBySessionId(activeSessionId))
      : null;
    const sessionPlayerError = sessionPlayerResult && sessionPlayerResult.__nllError ? sessionPlayerResult.__nllError : null;
    const sessionPlayer = sessionPlayerError ? null : sessionPlayerResult;

    return {
      netflix,
      appContext,
      playerApp,
      apiError,
      api,
      videoPlayer,
      sessionIdsError,
      sessionIds,
      activeSessionId,
      sessionPlayerError,
      sessionPlayer
    };
  }

  function buildProbe(context) {
    const timedTextTrackListResult = typeof context.sessionPlayer?.getTimedTextTrackList === 'function'
      ? safeCall(() => context.sessionPlayer.getTimedTextTrackList())
      : null;
    const timedTextTrackList = unwrapResult(timedTextTrackListResult);
    const activeTimedTextTrackResult = typeof context.sessionPlayer?.getTimedTextTrack === 'function'
      ? safeCall(() => context.sessionPlayer.getTimedTextTrack())
      : null;
    const activeTimedTextTrack = unwrapResult(activeTimedTextTrackResult);
    const audioTrackListResult = typeof context.sessionPlayer?.getAudioTrackList === 'function'
      ? safeCall(() => context.sessionPlayer.getAudioTrackList())
      : null;
    const audioTrackList = unwrapResult(audioTrackListResult);
    const activeAudioTrackResult = typeof context.sessionPlayer?.getAudioTrack === 'function'
      ? safeCall(() => context.sessionPlayer.getAudioTrack())
      : null;
    const activeAudioTrack = unwrapResult(activeAudioTrackResult);
    const movieIdResult = typeof context.sessionPlayer?.getMovieId === 'function'
      ? safeCall(() => context.sessionPlayer.getMovieId())
      : null;
    const movieId = unwrapResult(movieIdResult);
    const currentTimeResult = typeof context.sessionPlayer?.getCurrentTime === 'function'
      ? safeCall(() => context.sessionPlayer.getCurrentTime())
      : null;
    const currentTime = unwrapResult(currentTimeResult);
    const playbackRateResult = typeof context.sessionPlayer?.getPlaybackRate === 'function'
      ? safeCall(() => context.sessionPlayer.getPlaybackRate())
      : null;
    const playbackRate = unwrapResult(playbackRateResult);
    const pausedResult = typeof context.sessionPlayer?.getPaused === 'function'
      ? safeCall(() => context.sessionPlayer.getPaused())
      : null;
    const paused = unwrapResult(pausedResult);
    const playingResult = typeof context.sessionPlayer?.getPlaying === 'function'
      ? safeCall(() => context.sessionPlayer.getPlaying())
      : null;
    const playing = unwrapResult(playingResult);
    const elementResult = typeof context.sessionPlayer?.getElement === 'function'
      ? safeCall(() => context.sessionPlayer.getElement())
      : null;
    const element = unwrapResult(elementResult);
    const mediaElementPaused = element.value && typeof element.value.paused === 'boolean'
      ? element.value.paused
      : null;
    const normalizedPaused = typeof paused.value === 'boolean'
      ? paused.value
      : mediaElementPaused;
    const normalizedPlaying = typeof playing.value === 'boolean'
      ? playing.value
      : (typeof mediaElementPaused === 'boolean' ? !mediaElementPaused : null);

    const normalizedTimedTextTrackList = normalizeTrackList(timedTextTrackList.value);
    const normalizedActiveTimedTextTrack = normalizeTrack(activeTimedTextTrack.value);
    const normalizedAudioTrackList = normalizeTrackList(audioTrackList.value);
    const normalizedActiveAudioTrack = normalizeTrack(activeAudioTrack.value);

    return {
      title: document.title,
      videoCount: document.querySelectorAll('video').length,
      noncePresent: Boolean(loaderNonce),
      hasNetflix: Boolean(context.netflix),
      hasAppContext: Boolean(context.appContext),
      hasPlayerApp: Boolean(context.playerApp),
      hasApi: Boolean(context.api),
      hasVideoPlayer: Boolean(context.videoPlayer),
      apiError: context.apiError,
      sessionIdsError: context.sessionIdsError,
      sessionPlayerError: context.sessionPlayerError,
      sessionIds: context.sessionIds,
      activeSessionId: context.activeSessionId,
      videoPlayerMethods: listMethodNames(context.videoPlayer),
      sessionPlayerMethods: listMethodNames(context.sessionPlayer),
      lrPlayerMethodAvailability: buildMethodAvailability(context.sessionPlayer),
      timedTextTrackListError: timedTextTrackList.error,
      timedTextTrackList: normalizedTimedTextTrackList,
      activeTimedTextTrackError: activeTimedTextTrack.error,
      activeTimedTextTrack: normalizedActiveTimedTextTrack,
      audioTrackListError: audioTrackList.error,
      audioTrackList: normalizedAudioTrackList,
      activeAudioTrackError: activeAudioTrack.error,
      activeAudioTrack: normalizedActiveAudioTrack,
      movieIdError: movieId.error,
      movieId: movieId.value ?? null,
      currentTimeError: currentTime.error,
      currentTime: normalizePlayerTime(currentTime.value),
      playbackRateError: playbackRate.error,
      playbackRate: typeof playbackRate.value === 'number' ? playbackRate.value : null,
      pausedError: paused.error,
      paused: typeof normalizedPaused === 'boolean' ? normalizedPaused : null,
      playingError: playing.error,
      playing: typeof normalizedPlaying === 'boolean' ? normalizedPlaying : null,
      elementError: element.error,
      element: normalizeElement(element.value),
      hasManifestLikeTimedTextData: normalizedTimedTextTrackList.hasManifestLikeData || Boolean(normalizedActiveTimedTextTrack?.hasManifestLikeData)
    };
  }

  function getTrackKey(track) {
    if (!track || typeof track !== 'object') {
      return null;
    }

    return String(
      track.new_track_id
      || track.trackId
      || track.id
      || track.downloadableIds?.[SUBTITLE_PROFILE]
      || [
        track.language || '',
        track.rawTrackType || '',
        track.isForcedNarrative ? 'forced' : 'regular',
        track.isNoneTrack ? 'none' : 'real'
      ].join('|')
    );
  }

  function mergeTrackData(existing, incoming) {
    if (!existing) {
      return incoming;
    }

    if (!incoming) {
      return existing;
    }

    return {
      ...existing,
      ...incoming,
      downloadableIds: {
        ...(existing.downloadableIds || {}),
        ...(incoming.downloadableIds || {})
      },
      ttDownloadables: {
        ...(existing.ttDownloadables || {}),
        ...(incoming.ttDownloadables || {})
      },
      streams: Array.isArray(incoming.streams) && incoming.streams.length
        ? incoming.streams
        : (existing.streams || []),
      bitrates: Array.isArray(incoming.bitrates) && incoming.bitrates.length
        ? incoming.bitrates
        : (existing.bitrates || [])
    };
  }

  function mergeTrackArrays(existingTracks, incomingTracks) {
    const mergedByKey = new Map();

    (Array.isArray(existingTracks) ? existingTracks : []).forEach((track) => {
      const key = getTrackKey(track);
      if (key) {
        mergedByKey.set(key, track);
      }
    });

    (Array.isArray(incomingTracks) ? incomingTracks : []).forEach((track) => {
      const key = getTrackKey(track);
      if (!key) {
        return;
      }

      const previous = mergedByKey.get(key);
      mergedByKey.set(key, mergeTrackData(previous, track));
    });

    return Array.from(mergedByKey.values());
  }

  function mergeManifest(existing, incoming) {
    return {
      ...(existing || {}),
      ...(incoming || {}),
      movieId: String(incoming?.movieId ?? existing?.movieId ?? ''),
      timedtexttracks: mergeTrackArrays(existing?.timedtexttracks, incoming?.timedtexttracks),
      audio_tracks: mergeTrackArrays(existing?.audio_tracks, incoming?.audio_tracks)
    };
  }

  function captureManifestCandidate(value) {
    const candidate = value && value.result && Array.isArray(value.result.timedtexttracks)
      ? value.result
      : null;

    if (!candidate) {
      return;
    }

    const manifest = cloneJson(candidate);
    if (!manifest || !Array.isArray(manifest.timedtexttracks)) {
      return;
    }

    const movieId = manifest.movieId != null ? String(manifest.movieId) : null;
    if (!movieId) {
      return;
    }

    const merged = mergeManifest(manifestCache.get(movieId) || null, manifest);
    manifestCache.set(movieId, merged);
  }

  JSON.parse = function patchedJsonParse() {
    const value = originalJsonParse.apply(this, arguments);
    try {
      captureManifestCandidate(value);
    } catch (error) {
      // Ignore capture failures and preserve page behavior.
    }
    return value;
  };

  function isWatchPath() {
    return WATCH_PATH_PATTERN.test(globalThis.location.pathname);
  }

  function maybeHydrateSubtitleRequest(jsonValue) {
    if (!isWatchPath()) {
      return null;
    }

    if (typeof jsonValue !== 'string' || !jsonValue) {
      return null;
    }

    let cloned;
    try {
      cloned = originalJsonParse(jsonValue);
    } catch (error) {
      return null;
    }

    if (!cloned || typeof cloned !== 'object' || !cloned.params || typeof cloned.params !== 'object') {
      return null;
    }

    const hasHydrationFlag = Object.prototype.hasOwnProperty.call(cloned.params, 'supportsPartialHydration');
    const hasSubtitleVisibilityFlag = Object.prototype.hasOwnProperty.call(cloned.params, 'showAllSubDubTracks');
    const hasProfiles = Array.isArray(cloned.params.profiles) && cloned.params.profiles.length > 0;
    const hasLanguages = Array.isArray(cloned.languages) && cloned.languages.length > 0;

    if (!hasProfiles || (!hasHydrationFlag && !hasSubtitleVisibilityFlag && !hasLanguages)) {
      return null;
    }

    let modified = false;

    if (cloned.params.supportsPartialHydration !== true) {
      cloned.params.supportsPartialHydration = true;
      modified = true;
    }

    if (cloned.params.showAllSubDubTracks !== true) {
      cloned.params.showAllSubDubTracks = true;
      modified = true;
    }

    if (hasProfiles && !cloned.params.profiles.includes(SUBTITLE_PROFILE)) {
      cloned.params.profiles = cloned.params.profiles.concat(SUBTITLE_PROFILE);
      modified = true;
    }

    if (!modified) {
      return null;
    }

    requestHydrationDebug.patchCount += 1;
    requestHydrationDebug.lastPatchedRequest = {
      patchCount: requestHydrationDebug.patchCount,
      hadSupportsPartialHydration: hasHydrationFlag,
      hadShowAllSubDubTracks: hasSubtitleVisibilityFlag,
      hadProfiles: hasProfiles,
      profileCount: Array.isArray(cloned.params.profiles) ? cloned.params.profiles.length : 0
    };

    return cloned;
  }

  JSON.stringify = function patchedJsonStringify() {
    const args = Array.from(arguments);
    if (typeof args[0] === 'undefined') {
      return originalJsonStringify.apply(this, args);
    }

    const originalJsonValue = originalJsonStringify.apply(this, args);
    const hydrated = maybeHydrateSubtitleRequest(originalJsonValue);
    if (hydrated) {
      args[0] = hydrated;
      return originalJsonStringify.apply(this, args);
    }

    return originalJsonValue;
  };

  function countHydratedTimedTextTracks(manifest) {
    return (Array.isArray(manifest?.timedtexttracks) ? manifest.timedtexttracks : [])
      .filter((track) => {
        return Boolean(resolveSubtitleDownload(track).url);
      })
      .length;
  }

  function getAvailableSubtitleProfiles(track) {
    if (!track || typeof track !== 'object') {
      return [];
    }

    const profiles = new Set();
    if (track.ttDownloadables && typeof track.ttDownloadables === 'object') {
      Object.keys(track.ttDownloadables).forEach((key) => {
        profiles.add(key);
      });
    }
    if (track.downloadableIds && typeof track.downloadableIds === 'object') {
      Object.keys(track.downloadableIds).forEach((key) => {
        profiles.add(key);
      });
    }

    return Array.from(profiles).sort();
  }

  function getUrlsForDownloadable(downloadable) {
    if (!downloadable || typeof downloadable !== 'object') {
      return [];
    }

    if (downloadable.downloadUrls && typeof downloadable.downloadUrls === 'object') {
      return Object.values(downloadable.downloadUrls).filter((value) => typeof value === 'string' && value);
    }

    if (Array.isArray(downloadable.urls)) {
      return downloadable.urls
        .map((entry) => entry?.url)
        .filter((value) => typeof value === 'string' && value);
    }

    return [];
  }

  function getPreferredSubtitleProfiles(track) {
    const availableProfiles = getAvailableSubtitleProfiles(track);
    const preferred = [];

    SUBTITLE_PROFILE_PREFERENCES.forEach((profile) => {
      if (availableProfiles.includes(profile)) {
        preferred.push(profile);
      }
    });

    availableProfiles.forEach((profile) => {
      if (!preferred.includes(profile) && profile.startsWith('webvtt')) {
        preferred.push(profile);
      }
    });

    availableProfiles.forEach((profile) => {
      if (!preferred.includes(profile)) {
        preferred.push(profile);
      }
    });

    return preferred;
  }

  function summarizeManifest(manifest) {
    if (!manifest) {
      return null;
    }

    const timedTextTracks = Array.isArray(manifest.timedtexttracks) ? manifest.timedtexttracks : [];
    const audioTracks = Array.isArray(manifest.audio_tracks) ? manifest.audio_tracks : [];

    return {
      movieId: manifest.movieId != null ? String(manifest.movieId) : null,
      timedTextTrackCount: timedTextTracks.length,
      hydratedTimedTextTrackCount: countHydratedTimedTextTracks(manifest),
      audioTrackCount: audioTracks.length,
      subtitleProfile: SUBTITLE_PROFILE
    };
  }

  function resolveMovieId(sessionPlayer) {
    if (!sessionPlayer) {
      return null;
    }

    const movieIdResult = typeof sessionPlayer.getMovieId === 'function'
      ? unwrapResult(safeCall(() => sessionPlayer.getMovieId()))
      : { error: null, value: null };

    if (movieIdResult.value != null && String(movieIdResult.value)) {
      return String(movieIdResult.value);
    }

    const elementResult = typeof sessionPlayer.getElement === 'function'
      ? unwrapResult(safeCall(() => sessionPlayer.getElement()))
      : { error: null, value: null };

    const element = elementResult.value;
    if (!element || typeof element !== 'object') {
      return null;
    }

    const candidateId = element.id || element.children?.[0]?.id || null;
    return candidateId && /^\d+$/.test(String(candidateId)) ? String(candidateId) : null;
  }

  function findManifestTrack(manifest, activeTrack) {
    if (!manifest || !activeTrack) {
      return null;
    }

    const tracks = Array.isArray(manifest.timedtexttracks) ? manifest.timedtexttracks : [];
    if (!tracks.length) {
      return null;
    }

    const activeTrackId = activeTrack.trackId != null ? String(activeTrack.trackId) : null;
    if (activeTrackId) {
      const exactMatch = tracks.find((track) => {
        return String(track.new_track_id || track.trackId || track.id || '') === activeTrackId;
      });
      if (exactMatch) {
        return exactMatch;
      }
    }

    return tracks.find((track) => {
      return !track.isForcedNarrative
        && !track.isNoneTrack
        && track.language === activeTrack.language
        && track.rawTrackType === activeTrack.rawTrackType;
    }) || tracks.find((track) => {
      return !track.isForcedNarrative
        && !track.isNoneTrack
        && track.language === activeTrack.language;
    }) || null;
  }

  function findManifestTrackByLanguage(manifest, targetLanguage, excludedTrackKey = null) {
    if (!manifest) {
      return null;
    }

    const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage);
    if (!normalizedTargetLanguage) {
      return null;
    }

    const tracks = Array.isArray(manifest.timedtexttracks) ? manifest.timedtexttracks : [];
    return tracks.find((track) => {
      if (!track || track.isForcedNarrative || track.isNoneTrack) {
        return false;
      }

      if (excludedTrackKey && getTrackKey(track) === excludedTrackKey) {
        return false;
      }

      return normalizeLanguageCode(track.language) === normalizedTargetLanguage
        || normalizeLanguageCode(track.bcp47) === normalizedTargetLanguage;
    }) || null;
  }

  function resolveSubtitleDownload(track) {
    if (!track || typeof track !== 'object') {
      return {
        profile: null,
        downloadableId: null,
        url: null,
        urlCount: 0,
        hydrated: false,
        availableProfiles: []
      };
    }

    const availableProfiles = getAvailableSubtitleProfiles(track);
    const profileOrder = getPreferredSubtitleProfiles(track);

    for (const profile of profileOrder) {
      const downloadable = track.ttDownloadables?.[profile] || null;
      const downloadableId = track.downloadableIds?.[profile] || null;
      const urls = getUrlsForDownloadable(downloadable);

      if (!downloadable && !downloadableId && urls.length === 0) {
        continue;
      }

      return {
        profile,
        downloadableId: downloadableId ? String(downloadableId) : null,
        url: urls[0] || null,
        urlCount: urls.length,
        hydrated: Boolean(downloadableId && downloadable),
        availableProfiles
      };
    }

    return {
      profile: null,
      downloadableId: null,
      url: null,
      urlCount: 0,
      hydrated: false,
      availableProfiles
    };
  }

  async function fetchSubtitleTimeline(movieId, track, downloadable) {
    const cacheKey = [movieId || 'unknown', downloadable.downloadableId || downloadable.url || getTrackKey(track)].join('|');
    if (subtitleCache.has(cacheKey)) {
      const cached = subtitleCache.get(cacheKey);
      if (!cached?.error || !cached.retryAfter || Date.now() < cached.retryAfter) {
        return cached;
      }
    }

    if (pendingSubtitleLoads.has(cacheKey)) {
      return pendingSubtitleLoads.get(cacheKey);
    }

    if (!downloadable.url) {
      return {
        cacheKey,
        error: 'Subtitle manifest is present, but no WebVTT download URL is available yet.',
        timeline: []
      };
    }

    const pending = globalThis.fetch(downloadable.url, {
      credentials: 'omit'
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Subtitle fetch failed with HTTP ${response.status}.`);
      }

      const contentType = response.headers.get('content-type') || null;
      const text = await response.text();
      const parsed = parseSubtitlePayload(text, contentType);
      const result = {
        cacheKey,
        error: null,
        timeline: parsed.timeline,
        retryAfter: null,
        format: parsed.format,
        contentType,
        preview: parsed.preview
      };
      subtitleCache.set(cacheKey, result);
      pendingSubtitleLoads.delete(cacheKey);
      return result;
    }).catch((error) => {
      pendingSubtitleLoads.delete(cacheKey);
      const result = {
        cacheKey,
        error: error?.message || String(error),
        timeline: [],
        retryAfter: Date.now() + SUBTITLE_FETCH_RETRY_MS,
        format: null,
        contentType: null,
        preview: null
      };
      subtitleCache.set(cacheKey, result);
      return result;
    });

    pendingSubtitleLoads.set(cacheKey, pending);
    return pending;
  }

  // Timeline resolution is selection-based: once a movie/track/downloadable choice is fixed,
  // refreshes should reuse that resolved timeline and only do active-cue lookup.
  function buildTimelineSelection(movieId, track, downloadable) {
    if (!movieId || !track) {
      return null;
    }

    const trackKey = getTrackKey(track) || 'unknown-track';
    const downloadableKey = downloadable
      ? downloadable.downloadableId || downloadable.url || downloadable.profile || 'unresolved-downloadable'
      : 'unresolved-downloadable';

    return {
      key: [
        String(movieId),
        trackKey,
        downloadableKey
      ].join('|'),
      movieId: String(movieId),
      trackKey,
      downloadableKey,
      profile: downloadable?.profile || null
    };
  }

  function shouldRefreshResolvedTimeline(resolutionState, selection) {
    if (!selection) {
      return false;
    }

    return !resolutionState.selection
      || resolutionState.selection.key !== selection.key
      || !resolutionState.result
      || Boolean(
        resolutionState.result.error
        && resolutionState.result.retryAfter
        && Date.now() >= resolutionState.result.retryAfter
      );
  }

  async function resolveTrackTimeline(resolutionState, selection, movieId, track, downloadable) {
    if (!selection) {
      clearTimelineResolutionState(resolutionState);
      return null;
    }

    if (!downloadable?.url) {
      resolutionState.selection = selection;
      resolutionState.result = null;
      return null;
    }

    if (shouldRefreshResolvedTimeline(resolutionState, selection)) {
      resolutionState.selection = selection;
      resolutionState.result = await fetchSubtitleTimeline(movieId, track, downloadable);
    }

    return resolutionState.result;
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

  function classifyState(probe, manifestSummary, selection, ready, requestHydration) {
    if (!probe.hasNetflix) {
      return {
        stage: 'waiting-for-netflix-global',
        message: 'Waiting for the Netflix page runtime to initialize.'
      };
    }

    if (!probe.hasAppContext) {
      return {
        stage: 'waiting-for-app-context',
        message: 'Netflix global is present, but appContext is not ready yet.'
      };
    }

    if (!probe.hasPlayerApp) {
      return {
        stage: 'waiting-for-player-app',
        message: 'Netflix appContext is present, but playerApp is not ready yet.'
      };
    }

    if (probe.apiError) {
      return {
        stage: 'player-api-error',
        message: `Netflix player API probe failed: ${probe.apiError}`
      };
    }

    if (!probe.hasApi || !probe.hasVideoPlayer) {
      return {
        stage: 'waiting-for-video-player-api',
        message: 'Netflix player API is present, but videoPlayer is not ready yet.'
      };
    }

    if (probe.sessionIdsError) {
      return {
        stage: 'session-probe-error',
        message: `Netflix player sessions probe failed: ${probe.sessionIdsError}`
      };
    }

    if (!probe.activeSessionId) {
      return {
        stage: 'waiting-for-watch-session',
        message: 'Netflix video player is present, but no watch session is active yet.'
      };
    }

    const criticalMethods = [
      'getTimedTextTrackList',
      'getTimedTextTrack',
      'setTimedTextTrack',
      'getAudioTrackList',
      'getAudioTrack',
      'setAudioTrack',
      'getCurrentTime',
      'seek'
    ];
    const missingMethods = criticalMethods.filter((name) => !probe.lrPlayerMethodAvailability[name]);
    if (missingMethods.length > 0) {
      return {
        stage: 'missing-lr-player-methods',
        message: `Netflix player session is present, but LR-style methods are missing: ${missingMethods.join(', ')}.`,
        missingMethods
      };
    }

    if (!selection.movieId) {
      return {
        stage: 'waiting-for-movie-id',
        message: 'Netflix player methods are present, but the current movie ID is not available yet.'
      };
    }

    if (!manifestSummary) {
      return {
        stage: 'waiting-for-manifest-capture',
        message: 'LR-style Netflix player methods are present, but no timed-text manifest has been captured yet.'
      };
    }

    if (!selection.activeTimedTextTrack) {
      return {
        stage: 'waiting-for-active-text-track',
        message: 'Timed-text manifest is available, but the active Netflix subtitle track is not ready yet.'
      };
    }

    if (selection.activeTimedTextTrack.isNoneTrack) {
      return {
        stage: 'subtitles-disabled',
        message: 'Netflix subtitles are currently disabled.'
      };
    }

    if (!selection.matchedTimedTextTrack) {
      return {
        stage: 'active-track-missing-from-manifest',
        message: 'An active Netflix subtitle track exists, but it was not found in the captured manifest.'
      };
    }

    if (ready.state === 'waiting-for-downloadable') {
      const lastPatch = requestHydration?.lastPatchedRequest || null;
      const patchCount = Number(requestHydration?.patchCount || 0);
      const patchSummary = patchCount > 0
        ? ` Request patches: ${patchCount}, profiles seen: ${lastPatch?.hadProfiles ? 'yes' : 'no'}.`
        : ' Request patches: 0.';
      const profileSummary = selection.downloadable?.availableProfiles?.length
        ? ` Available profiles: ${selection.downloadable.availableProfiles.slice(0, 4).join(', ')}.`
        : '';
      return {
        stage: 'manifest-captured-no-download-url',
        message: `Safari captured the subtitle manifest, but the active track is not hydrated with a downloadable subtitle URL yet. Manifest tracks: ${manifestSummary.timedTextTrackCount}, usable tracks: ${manifestSummary.hydratedTimedTextTrackCount}, active language: ${selection.activeTimedTextTrack.language || selection.matchedTimedTextTrack?.language || 'unknown'}, chosen profile: ${selection.downloadable?.profile || 'none'}.${patchSummary}${profileSummary}`
      };
    }

    if (ready.state === 'fetch-error') {
      return {
        stage: 'subtitle-fetch-error',
        message: ready.message
      };
    }

    if (ready.state === 'empty-timeline') {
      const profileSummary = ready.profile ? ` Profile: ${ready.profile}.` : '';
      const formatSummary = ready.format ? ` Format: ${ready.format}.` : '';
      const contentTypeSummary = ready.contentType ? ` Content-Type: ${ready.contentType}.` : '';
      return {
        stage: 'subtitle-parse-empty',
        message: `A subtitle file was fetched, but it did not produce a usable cue timeline.${profileSummary}${formatSummary}${contentTypeSummary}`
      };
    }

    if (ready.state === 'deterministic-subtitles-ready') {
      return {
        stage: 'deterministic-subtitles-ready',
        message: null
      };
    }

    return {
      stage: 'waiting-for-subtitle-source',
      message: 'Waiting for the deterministic Netflix subtitle source to become ready.'
    };
  }

  function buildSerializableState() {
    return {
      manifest: debugState.manifest ? { ...debugState.manifest } : null,
      selection: debugState.selection ? cloneJson(debugState.selection) : null,
      ready: debugState.ready ? { ...debugState.ready } : null,
      probe: debugState.probe ? cloneJson(debugState.probe) : null,
      status: debugState.status ? { ...debugState.status } : null,
      requestHydration: debugState.requestHydration ? { ...debugState.requestHydration } : null,
      preferences: cloneJson(subtitlePreferences)
    };
  }

  function emitSnapshots(reason, pageState, subtitleState) {
    const forceEmit = reason === 'request';
    const nextPageSignature = originalJsonStringify(pageState);
    if (forceEmit || nextPageSignature !== lastPageStateSignature) {
      lastPageStateSignature = nextPageSignature;
      post('nll:page-state', pageState);
      post('nll:timedtext-status', pageState.status);
    }

    const nextSubtitleSignature = originalJsonStringify([
      subtitleState.timelineKey,
      subtitleState.captionsEnabled,
      subtitleState.sourceLanguage,
      subtitleState.activeCue,
      subtitleState.preferredTranslation?.available || false,
      subtitleState.preferredTranslation?.activeCue || null,
      subtitleState.preferredTranslation?.readyState || null,
      subtitleState.ready?.state
    ]);

    if (forceEmit || nextSubtitleSignature !== lastSubtitleStateSignature) {
      lastSubtitleStateSignature = nextSubtitleSignature;
      const shouldSendTimeline = forceEmit || Boolean(
        (subtitleState.timelineKey && subtitleState.timelineKey !== lastTimelineKeySent)
        || (!subtitleState.timelineKey && lastTimelineKeySent !== null)
      );
      if (subtitleState.timelineKey) {
        lastTimelineKeySent = subtitleState.timelineKey;
      } else {
        lastTimelineKeySent = null;
      }

      post('nll:subtitle-state', {
        ...subtitleState,
        timeline: shouldSendTimeline ? subtitleState.timeline : null
      });
    }
  }

  async function performRefresh(reason) {
    const context = getSessionContext();
    syncMediaElementBindings(context);
    const probe = buildProbe(context);
    const movieId = resolveMovieId(context.sessionPlayer) || (probe.movieId != null ? String(probe.movieId) : null);
    const manifest = movieId ? (manifestCache.get(movieId) || null) : null;
    const activeTimedTextTrack = probe.activeTimedTextTrack;

    const selection = {
      movieId,
      activeTimedTextTrack
    };

    let sourceLanguage = activeTimedTextTrack?.language || 'en';
    let timeline = [];
    let activeCue = null;
    let timelineKey = null;
    let captionsEnabled = false;
    let preferredTranslation = {
      available: false,
      activeCue: null,
      trackLanguage: null,
      targetLanguage: subtitlePreferences.targetLanguage || null,
      provider: subtitlePreferences.useNetflixTargetSubtitlesIfAvailable ? 'netflix' : null,
      readyState: subtitlePreferences.useNetflixTargetSubtitlesIfAvailable ? 'waiting-for-track' : 'disabled'
    };
    let ready = {
      state: 'idle'
    };
    let activeTimelineSelection = null;
    let preferredTimelineSelection = null;

    if (manifest && activeTimedTextTrack && !activeTimedTextTrack.isNoneTrack) {
      const matchedTimedTextTrack = findManifestTrack(manifest, activeTimedTextTrack);
      selection.matchedTimedTextTrack = normalizeTrack(matchedTimedTextTrack);

      if (matchedTimedTextTrack) {
        sourceLanguage = matchedTimedTextTrack.language || sourceLanguage;
        const downloadable = resolveSubtitleDownload(matchedTimedTextTrack);
        activeTimelineSelection = buildTimelineSelection(movieId, matchedTimedTextTrack, downloadable);
        selection.downloadable = {
          profile: downloadable.profile,
          downloadableId: downloadable.downloadableId,
          hydrated: downloadable.hydrated,
          urlCount: downloadable.urlCount,
          availableProfiles: downloadable.availableProfiles
        };
        selection.activeTimelineSelection = activeTimelineSelection ? { ...activeTimelineSelection } : null;

        if (!downloadable.url) {
          ready = {
            state: 'waiting-for-downloadable'
          };
        } else {
          const timelineResult = await resolveTrackTimeline(
            activeTimelineResolution,
            activeTimelineSelection,
            movieId,
            matchedTimedTextTrack,
            downloadable
          );
          if (timelineResult.error) {
            ready = {
              state: 'fetch-error',
              message: timelineResult.error
            };
          } else if (!timelineResult.timeline.length) {
            ready = {
              state: 'empty-timeline',
              format: timelineResult.format || 'unknown',
              contentType: timelineResult.contentType || null,
              preview: timelineResult.preview || null,
              profile: downloadable.profile || null
            };
          } else {
            timeline = timelineResult.timeline;
            timelineKey = timelineResult.cacheKey;
            captionsEnabled = true;
            const currentTime = Number(probe.currentTime);
            activeCue = findCueAtTime(timeline, currentTime);
            ready = {
              state: 'deterministic-subtitles-ready',
              cueCount: timeline.length,
              timelineKey,
              currentTime: Number.isFinite(currentTime) ? currentTime : null
            };
          }
        }
      }
    }

    if (!activeTimelineSelection) {
      clearTimelineResolutionState(activeTimelineResolution);
      selection.activeTimelineSelection = null;
    }

    if (subtitlePreferences.useNetflixTargetSubtitlesIfAvailable && manifest) {
      const excludedTrackKey = selection.matchedTimedTextTrack
        ? getTrackKey(selection.matchedTimedTextTrack)
        : null;
      const preferredTimedTextTrack = findManifestTrackByLanguage(
        manifest,
        subtitlePreferences.targetLanguage,
        excludedTrackKey
      );
      selection.preferredTimedTextTrack = normalizeTrack(preferredTimedTextTrack);

      if (preferredTimedTextTrack) {
        preferredTranslation.trackLanguage = preferredTimedTextTrack.language || preferredTimedTextTrack.bcp47 || null;
        preferredTranslation.readyState = 'waiting-for-downloadable';
        const downloadable = resolveSubtitleDownload(preferredTimedTextTrack);
        preferredTimelineSelection = buildTimelineSelection(movieId, preferredTimedTextTrack, downloadable);
        selection.preferredDownloadable = {
          profile: downloadable.profile,
          downloadableId: downloadable.downloadableId,
          hydrated: downloadable.hydrated,
          urlCount: downloadable.urlCount,
          availableProfiles: downloadable.availableProfiles
        };
        selection.preferredTimelineSelection = preferredTimelineSelection ? { ...preferredTimelineSelection } : null;

        if (downloadable.url) {
          const preferredTimelineResult = await resolveTrackTimeline(
            preferredTimelineResolution,
            preferredTimelineSelection,
            movieId,
            preferredTimedTextTrack,
            downloadable
          );
          if (!preferredTimelineResult.error && preferredTimelineResult.timeline.length) {
            const currentTime = Number(probe.currentTime);
            preferredTranslation.available = true;
            preferredTranslation.activeCue = findCueAtTime(preferredTimelineResult.timeline, currentTime);
            preferredTranslation.readyState = 'ready';
          } else if (preferredTimelineResult.error) {
            preferredTranslation.readyState = 'fetch-error';
          } else {
            preferredTranslation.readyState = 'empty-timeline';
          }
        }
      } else {
        preferredTranslation.readyState = 'track-unavailable';
      }
    }

    if (!preferredTimelineSelection) {
      clearTimelineResolutionState(preferredTimelineResolution);
      selection.preferredTimelineSelection = null;
    }

    debugState.probe = probe;
    debugState.manifest = summarizeManifest(manifest);
    debugState.selection = selection;
    debugState.ready = ready;
    debugState.status = classifyState(probe, debugState.manifest, selection, ready, debugState.requestHydration);

    const pageState = buildSerializableState();
    const subtitleState = {
      captionsEnabled,
      sourceLanguage,
      timelineKey,
      timeline: ready.state === 'deterministic-subtitles-ready' ? timeline : [],
      activeCue,
      preferredTranslation,
      status: debugState.status,
      ready,
      reason
    };
    syncAutoPause(probe, subtitleState, reason);

    postDebug('refresh:summary', {
      reason,
      watchPathActive: WATCH_PATH_PATTERN.test(globalThis.location.pathname),
      activeSessionId: probe.activeSessionId || null,
      movieId: probe.movieId || null,
      paused: typeof probe.paused === 'boolean' ? probe.paused : null,
      playing: typeof probe.playing === 'boolean' ? probe.playing : null,
      currentTime: Number.isFinite(Number(probe.currentTime)) ? Number(probe.currentTime) : null,
      activeCueStartTime: activeCue ? Number(activeCue.startTime) : null,
      activeCueEndTime: activeCue ? Number(activeCue.endTime) : null,
      readyState: ready.state,
      captionsEnabled,
      timelineKey
    });
    emitSnapshots(reason, pageState, subtitleState);
  }

  function scheduleRefresh(reason) {
    if (refreshInFlight) {
      queuedRefreshReason = reason;
      return;
    }

    refreshInFlight = true;
    Promise.resolve().then(async () => {
      let nextReason = reason;
      while (nextReason) {
        const currentReason = nextReason;
        queuedRefreshReason = null;
        await performRefresh(currentReason);
        nextReason = queuedRefreshReason;
      }
    }).finally(() => {
      refreshInFlight = false;
    });
  }

  function buildRawPlayerState() {
    const context = getSessionContext();
    return {
      videoPlayer: context.videoPlayer,
      sessionIds: context.sessionIds,
      activeSessionId: context.activeSessionId,
      sessionPlayer: context.sessionPlayer,
      timedTextTrackList: typeof context.sessionPlayer?.getTimedTextTrackList === 'function'
        ? safeCall(() => context.sessionPlayer.getTimedTextTrackList())
        : null,
      activeTimedTextTrack: typeof context.sessionPlayer?.getTimedTextTrack === 'function'
        ? safeCall(() => context.sessionPlayer.getTimedTextTrack())
        : null,
      audioTrackList: typeof context.sessionPlayer?.getAudioTrackList === 'function'
        ? safeCall(() => context.sessionPlayer.getAudioTrackList())
        : null,
      activeAudioTrack: typeof context.sessionPlayer?.getAudioTrack === 'function'
        ? safeCall(() => context.sessionPlayer.getAudioTrack())
        : null
    };
  }

  function getSessionMediaElement(context) {
    const elementResult = typeof context.sessionPlayer?.getElement === 'function'
      ? unwrapResult(safeCall(() => context.sessionPlayer.getElement()))
      : { value: null };
    const element = elementResult.value;

    return element && typeof element.addEventListener === 'function'
      ? element
      : null;
  }

  function getDomVideoElement(context) {
    const sessionElement = getSessionMediaElement(context);

    if (sessionElement && String(sessionElement.tagName || '').toLowerCase() === 'video') {
      return sessionElement;
    }

    if (sessionElement && typeof sessionElement.querySelector === 'function') {
      const nestedVideo = sessionElement.querySelector('video');
      if (nestedVideo && typeof nestedVideo.currentTime === 'number') {
        return nestedVideo;
      }
    }

    const shell = findWatchPlayerShell();
    if (shell && typeof shell.querySelector === 'function') {
      const shellVideo = shell.querySelector('video');
      if (shellVideo && typeof shellVideo.currentTime === 'number') {
        return shellVideo;
      }
    }

    const documentVideo = globalThis.document?.querySelector?.('video');
    if (documentVideo && typeof documentVideo.currentTime === 'number') {
      return documentVideo;
    }

    return null;
  }

  function handleMediaPlay() {
    scheduleAutoPauseFrame('media-play');
    scheduleRefresh('media-play');
  }

  function handleMediaPause() {
    const snapshot = getLivePlaybackSnapshot();
    if (Number.isFinite(Number(snapshot.currentTime))) {
      autoPauseState.previousTime = Number(snapshot.currentTime);
    }
    // Any pause clears the active page-side timer. Only cue initiation may
    // arm the next traversal again.
    clearAutoPauseTimer('media-pause', { deactivate: false });
    scheduleRefresh('media-pause');
  }

  function handleMediaSeeked() {
    autoPauseState.awaitingSeeked = false;
    resetAutoPauseTraversal('media-seeked');
    const targetTime = Number(autoPauseState.pendingSeekTargetTime);
    const timeline = Array.isArray(activeTimelineResolution.result?.timeline)
      ? activeTimelineResolution.result.timeline
      : [];
    const targetCue = Number.isFinite(targetTime)
      ? findCueAtTime(timeline, targetTime)
      : null;
    if (targetCue) {
      // A completed seek initiates the target cue traversal. This is the only
      // cue-init path for navigation.
      setAutoPauseTraversal(targetCue, targetCue.startTime, 'seeked-target-cue');
    }
    autoPauseState.pendingSeekTargetTime = null;
    if (autoPauseState.pendingPlayAfterSeek) {
      autoPauseState.pendingPlayAfterSeek = false;
      const context = getSessionContext();
      if (typeof context.sessionPlayer?.play === 'function') {
        safeCall(() => context.sessionPlayer.play());
      } else {
        const snapshot = getLivePlaybackSnapshot();
        if (snapshot.mediaElement && typeof snapshot.mediaElement.play === 'function') {
          safeCall(() => snapshot.mediaElement.play());
        }
      }
    }
    scheduleAutoPauseFrame('media-seeked');
    scheduleRefresh('media-seeked');
  }

  function handleMediaRateChange() {
    scheduleAutoPauseFrame('media-ratechange');
    scheduleRefresh('media-ratechange');
  }

  function syncMediaElementBindings(context) {
    const nextMediaElement = getSessionMediaElement(context);

    if (boundMediaElement === nextMediaElement) {
      return;
    }

    if (boundMediaElement) {
      boundMediaElement.removeEventListener('play', handleMediaPlay, true);
      boundMediaElement.removeEventListener('pause', handleMediaPause, true);
      boundMediaElement.removeEventListener('seeked', handleMediaSeeked, true);
      boundMediaElement.removeEventListener('ratechange', handleMediaRateChange, true);
    }

    boundMediaElement = nextMediaElement;

    if (!boundMediaElement) {
      resetAutoPauseTraversal('media-detach');
      clearAutoPauseTimer('media-detach');
      return;
    }

    boundMediaElement.addEventListener('play', handleMediaPlay, true);
    boundMediaElement.addEventListener('pause', handleMediaPause, true);
    boundMediaElement.addEventListener('seeked', handleMediaSeeked, true);
    boundMediaElement.addEventListener('ratechange', handleMediaRateChange, true);
  }

  function shouldAutoPauseForState(probe, subtitleState) {
    return Boolean(
      subtitlePreferences.extensionEnabled
      && subtitlePreferences.autoPauseEnabled
      && subtitleState.ready?.state === 'deterministic-subtitles-ready'
      && subtitleState.captionsEnabled
    );
  }

  function getLivePlaybackSnapshot() {
    const context = getSessionContext();
    const mediaElement = getSessionMediaElement(context);
    const videoElement = getDomVideoElement(context);
    let paused = null;

    if (typeof context.sessionPlayer?.getPaused === 'function') {
      const pausedResult = unwrapResult(safeCall(() => context.sessionPlayer.getPaused()));
      if (typeof pausedResult.value === 'boolean') {
        paused = pausedResult.value;
      }
    }

    if (paused === null && typeof context.sessionPlayer?.getPlaying === 'function') {
      const playingResult = unwrapResult(safeCall(() => context.sessionPlayer.getPlaying()));
      if (typeof playingResult.value === 'boolean') {
        paused = !playingResult.value;
      }
    }

    if (paused === null && mediaElement && typeof mediaElement.paused === 'boolean') {
      paused = mediaElement.paused;
    }

    const mediaTime = mediaElement && typeof mediaElement.currentTime === 'number'
      ? Number(mediaElement.currentTime)
      : null;
    const videoTime = videoElement && typeof videoElement.currentTime === 'number'
      ? Number(videoElement.currentTime)
      : null;
    const playerTime = typeof context.sessionPlayer?.getCurrentTime === 'function'
      ? normalizePlayerTime(unwrapResult(safeCall(() => context.sessionPlayer.getCurrentTime())).value)
      : null;
    const currentTime = Number.isFinite(videoTime)
      ? videoTime
      : playerTime;

    return {
      context,
      mediaElement,
      videoElement,
      paused,
      currentTime,
      mediaTime,
      videoTime,
      playerTime
    };
  }

  function maybeLogAutoPauseFrameCheck(detail) {
    const now = Date.now();
    const currentTime = Number(detail.currentTime);
    const triggerTime = Number(detail.triggerTime);
    const delta = Number(detail.delta);
    const nearTrigger = (
      Number.isFinite(currentTime)
      && Number.isFinite(triggerTime)
      && Math.abs(currentTime - triggerTime) <= 0.6
    );
    const hasMeaningfulDelta = Number.isFinite(delta) && Math.abs(delta) >= 0.008;

    if (!nearTrigger && !hasMeaningfulDelta) {
      return;
    }

    if ((now - autoPauseState.lastFrameCheckLogAt) < 120) {
      return;
    }

    autoPauseState.lastFrameCheckLogAt = now;
    postDebug('page-autopause:frame-check', detail);
  }

  function runAutoPauseFrame() {
    const frameSeekGeneration = autoPauseState.seekGeneration;
    autoPauseState.rafId = null;

    if (!autoPauseState.active) {
      return;
    }

    if (autoPauseState.awaitingSeeked) {
      return;
    }

    if (!subtitlePreferences.extensionEnabled || !subtitlePreferences.autoPauseEnabled) {
      clearAutoPauseTimer('disabled');
      return;
    }

    const timeline = Array.isArray(activeTimelineResolution.result?.timeline)
      ? activeTimelineResolution.result.timeline
      : [];
    if (!timeline.length) {
      resetAutoPauseTraversal('no-timeline');
      clearAutoPauseTimer('no-timeline');
      return;
    }

    const snapshot = getLivePlaybackSnapshot();
    if (frameSeekGeneration !== autoPauseState.seekGeneration) {
      return;
    }
    const currentTime = Number(snapshot.currentTime);
    if (!Number.isFinite(currentTime)) {
      scheduleAutoPauseFrame(null);
      return;
    }

    const traversalCueKey = autoPauseState.currentCueKey;
    const traversalCueStartTime = Number(autoPauseState.currentCueStartTime);
    const traversalCueEndTime = Number(autoPauseState.currentCueEndTime);
    const traversalTriggerTime = Number(autoPauseState.currentCueTriggerTime);
    const previousTime = Number.isFinite(autoPauseState.previousTime)
      ? Number(autoPauseState.previousTime)
      : currentTime;
    const mediaTime = Number(snapshot.mediaTime);
    const videoTime = Number(snapshot.videoTime);
    const playerTime = Number(snapshot.playerTime);
    const delta = Number.isFinite(mediaTime) && Number.isFinite(playerTime)
      ? (playerTime - mediaTime)
      : null;
    const videoDelta = Number.isFinite(videoTime) && Number.isFinite(playerTime)
      ? (playerTime - videoTime)
      : null;

    // Cue initiation arms auto-pause once for that cue traversal. The anchored
    // traversal owns the pause decision until the cue changes or a seek
    // initiates a different cue.
    if (
      traversalCueKey
      && Number.isFinite(traversalCueEndTime)
      && Number.isFinite(traversalTriggerTime)
    ) {
      maybeLogAutoPauseFrameCheck({
        currentTime,
        mediaTime: Number.isFinite(mediaTime) ? mediaTime : null,
        videoTime: Number.isFinite(videoTime) ? videoTime : null,
        playerTime: Number.isFinite(playerTime) ? playerTime : null,
        delta,
        videoDelta,
        previousTime,
        triggerTime: traversalTriggerTime,
        cueStartTime: traversalCueStartTime,
        cueEnd: traversalCueEndTime,
        paused: snapshot.paused
      });

      if (snapshot.paused === true) {
        autoPauseState.previousTime = currentTime;
        return;
      }

      if (previousTime < traversalTriggerTime && currentTime >= traversalTriggerTime) {
        if (frameSeekGeneration !== autoPauseState.seekGeneration) {
          return;
        }
        let path = 'none';
        if (typeof snapshot.context.sessionPlayer?.pause === 'function') {
          safeCall(() => snapshot.context.sessionPlayer.pause());
          path = 'sessionPlayer.pause';
        } else if (snapshot.mediaElement && typeof snapshot.mediaElement.pause === 'function') {
          safeCall(() => snapshot.mediaElement.pause());
          path = 'mediaElement.pause';
        }

        autoPauseState.previousTime = currentTime;

      postDebug('page-autopause:pause', {
        path,
        previousTime,
        currentTime,
        triggerTime: traversalTriggerTime,
        cueStartTime: traversalCueStartTime,
        cueEndTime: traversalCueEndTime
      });
      clearAutoPauseTimer(null, { deactivate: false });
      scheduleRefresh('page-autopause');
      return;
    }

      if (currentTime <= traversalCueEndTime) {
        autoPauseState.previousTime = currentTime;
        scheduleAutoPauseFrame(null);
        return;
      }
    }

    const liveCue = findCueAtTime(timeline, currentTime);
    const liveCueKey = liveCue ? getCueKey(liveCue) : null;

    if (!liveCue) {
      resetAutoPauseTraversal(null);
      autoPauseState.previousTime = currentTime;
      if (snapshot.paused !== true) {
        scheduleAutoPauseFrame(null);
      }
      return;
    }

    if (
      !traversalCueKey
      || traversalCueKey !== liveCueKey
      || !Number.isFinite(traversalCueStartTime)
      || !Number.isFinite(traversalCueEndTime)
      || !Number.isFinite(traversalTriggerTime)
    ) {
      // Normal playback entering a new cue is the only non-seek cue-init path.
      setAutoPauseTraversal(liveCue, liveCue.startTime, traversalCueKey ? 'live-cue-change' : 'initial-live-cue');
      if (snapshot.paused !== true) {
        scheduleAutoPauseFrame(null);
      }
      return;
    }

    autoPauseState.previousTime = currentTime;
    scheduleAutoPauseFrame(null);
  }

  function syncAutoPause(probe, subtitleState, reason) {
    if (!shouldAutoPauseForState(probe, subtitleState)) {
      clearAutoPauseTimer(`inactive:${reason}`);
      return;
    }

    if (autoPauseState.active) {
      if (autoPauseState.awaitingSeeked) {
        return;
      }
      if (autoPauseState.rafId === null && probe.paused === false) {
        postDebug('page-autopause:stalled-loop', {
          reason,
          currentTime: probe.currentTime,
          cueStartTime: autoPauseState.currentCueStartTime,
          cueEndTime: autoPauseState.currentCueEndTime,
          triggerTime: autoPauseState.currentCueTriggerTime,
          previousTime: autoPauseState.previousTime
        });
        scheduleAutoPauseFrame(`stalled:${reason}`);
      }
      return;
    }

    autoPauseState.active = true;
    postDebug('page-autopause:arm', {
      cueStartTime: autoPauseState.currentCueStartTime,
      cueEndTime: autoPauseState.currentCueEndTime,
      currentTime: autoPauseState.previousTime,
      reason
    });
    scheduleAutoPauseFrame(reason);
  }

  function handlePlayerCommand(command, payload) {
    const context = getSessionContext();
    const elementResult = typeof context.sessionPlayer?.getElement === 'function'
      ? unwrapResult(safeCall(() => context.sessionPlayer.getElement()))
      : { value: null };
    const mediaElement = elementResult.value && typeof elementResult.value === 'object'
      ? elementResult.value
      : null;

    function getPausedState() {
      if (typeof context.sessionPlayer?.getPaused === 'function') {
        const pausedResult = unwrapResult(safeCall(() => context.sessionPlayer.getPaused()));
        if (typeof pausedResult.value === 'boolean') {
          return pausedResult.value;
        }
      }

      if (typeof context.sessionPlayer?.getPlaying === 'function') {
        const playingResult = unwrapResult(safeCall(() => context.sessionPlayer.getPlaying()));
        if (typeof playingResult.value === 'boolean') {
          return !playingResult.value;
        }
      }

      if (mediaElement && typeof mediaElement.paused === 'boolean') {
        return mediaElement.paused;
      }

      return null;
    }

    postDebug('player-command:received', {
      command,
      payload: cloneJson(payload),
      pausedState: getPausedState(),
      hasSessionPlayer: Boolean(context.sessionPlayer),
      hasMediaElement: Boolean(mediaElement),
      currentTime: typeof context.sessionPlayer?.getCurrentTime === 'function'
        ? normalizePlayerTime(unwrapResult(safeCall(() => context.sessionPlayer.getCurrentTime())).value)
        : null
    });

    if (command === 'seek') {
      const time = Number(payload?.time);
      const playerTime = toPlayerTime(time);
      if (Number.isFinite(playerTime) && typeof context.sessionPlayer?.seek === 'function') {
        autoPauseState.seekGeneration += 1;
        autoPauseState.awaitingSeeked = true;
        autoPauseState.pendingSeekTargetTime = time;
        autoPauseState.pendingPlayAfterSeek = false;
        resetAutoPauseTraversal('player-command-seek');
        clearAutoPauseTimer('player-command-seek-await-seeked', { deactivate: false });
        safeCall(() => context.sessionPlayer.seek(playerTime));
        postDebug('player-command:seek', {
          time,
          playerTime
        });
        scheduleRefresh('player-seek');
      }
      return;
    }

    if (command === 'seek-and-play') {
      const time = Number(payload?.time);
      const playerTime = toPlayerTime(time);
      if (Number.isFinite(playerTime) && typeof context.sessionPlayer?.seek === 'function') {
        autoPauseState.seekGeneration += 1;
        autoPauseState.awaitingSeeked = true;
        autoPauseState.pendingSeekTargetTime = time;
        autoPauseState.pendingPlayAfterSeek = true;
        resetAutoPauseTraversal('player-command-seek-and-play');
        clearAutoPauseTimer('player-command-seek-and-play-await-seeked', { deactivate: false });
        safeCall(() => context.sessionPlayer.seek(playerTime));
        postDebug('player-command:seek-and-play', {
          time,
          playerTime
        });
        scheduleRefresh('player-seek-and-play');
      }
      return;
    }

    if (command === 'play') {
      let path = 'none';
      if (typeof context.sessionPlayer?.play === 'function') {
        safeCall(() => context.sessionPlayer.play());
        path = 'sessionPlayer.play';
      } else if (mediaElement && typeof mediaElement.play === 'function') {
        safeCall(() => mediaElement.play());
        path = 'mediaElement.play';
      }
      postDebug('player-command:play', {
        path
      });
      scheduleRefresh('player-play');
      return;
    }

    if (command === 'pause') {
      let path = 'none';
      if (typeof context.sessionPlayer?.pause === 'function') {
        safeCall(() => context.sessionPlayer.pause());
        path = 'sessionPlayer.pause';
      } else if (mediaElement && typeof mediaElement.pause === 'function') {
        safeCall(() => mediaElement.pause());
        path = 'mediaElement.pause';
      }
      postDebug('player-command:pause', {
        path
      });
      scheduleRefresh('player-pause');
      return;
    }

    if (command === 'toggle-playback') {
      const paused = getPausedState();
      let path = 'none';
      if (paused === true) {
        if (typeof context.sessionPlayer?.play === 'function') {
          safeCall(() => context.sessionPlayer.play());
          path = 'sessionPlayer.play';
        } else if (mediaElement && typeof mediaElement.play === 'function') {
          safeCall(() => mediaElement.play());
          path = 'mediaElement.play';
        }
      } else if (paused === false) {
        if (typeof context.sessionPlayer?.pause === 'function') {
          safeCall(() => context.sessionPlayer.pause());
          path = 'sessionPlayer.pause';
        } else if (mediaElement && typeof mediaElement.pause === 'function') {
          safeCall(() => mediaElement.pause());
          path = 'mediaElement.pause';
        }
      }
      postDebug('player-command:toggle-playback', {
        paused,
        path
      });
      scheduleRefresh('player-toggle-playback');
      return;
    }

    if (command === 'set-native-subtitle-visibility') {
      const visible = Boolean(payload?.visible);

      if (typeof context.sessionPlayer?.setTimedTextVisibility === 'function') {
        safeCall(() => context.sessionPlayer.setTimedTextVisibility(visible));
      }

      if (typeof context.sessionPlayer?.setTimedTextVisible === 'function') {
        safeCall(() => context.sessionPlayer.setTimedTextVisible(visible));
      }

      if (context.activeSessionId && typeof context.videoPlayer?.showTimedTextBySessionId === 'function') {
        safeCall(() => context.videoPlayer.showTimedTextBySessionId(context.activeSessionId, visible));
      }

      scheduleRefresh('player-timedtext-visibility');
    }
  }

  globalThis.addEventListener('message', (event) => {
    if (!event.data) {
      return;
    }

    if (event.data.type === 'nll:page-state-request') {
      if (loaderNonce && event.data.nonce !== loaderNonce) {
        return;
      }

      scheduleRefresh('request');
      return;
    }

    if (event.data.type === 'nll:player-command') {
      if (loaderNonce && event.data.nonce !== loaderNonce) {
        return;
      }

      handlePlayerCommand(event.data.command, event.data.payload || {});
      return;
    }

    if (event.data.type === 'nll:page-config') {
      if (loaderNonce && event.data.nonce !== loaderNonce) {
        return;
      }

      subtitlePreferences.extensionEnabled = Boolean(event.data.payload?.extensionEnabled);
      subtitlePreferences.autoPauseEnabled = Boolean(event.data.payload?.autoPauseEnabled);
      subtitlePreferences.targetLanguage = String(event.data.payload?.targetLanguage || '');
      subtitlePreferences.useNetflixTargetSubtitlesIfAvailable = Boolean(
        event.data.payload?.useNetflixTargetSubtitlesIfAvailable
      );
      scheduleRefresh('preferences-change');
    }
  });

  globalThis.addEventListener('pageshow', () => {
    scheduleRefresh('pageshow');
  });

  globalThis.setInterval(() => {
    scheduleRefresh('probe-poll');
  }, PROBE_POLL_INTERVAL_MS);

  globalThis.setInterval(() => {
    scheduleRefresh('subtitle-poll');
  }, SUBTITLE_POLL_INTERVAL_MS);

  globalThis.__NLL_NETFLIX_PAGE_DEBUG__ = {
    getState() {
      scheduleRefresh('debug');
      return buildSerializableState();
    },
    getRawPlayerState() {
      return buildRawPlayerState();
    },
    getManifest(movieId) {
      const key = movieId != null ? String(movieId) : debugState.selection?.movieId || null;
      return key ? cloneJson(manifestCache.get(key) || null) : null;
    }
  };

  scheduleRefresh('init');
})();
