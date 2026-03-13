(() => {
  if (globalThis.__NLL_CONTENT_SCRIPT__) {
    return;
  }
  globalThis.__NLL_CONTENT_SCRIPT__ = true;

  const WATCH_PATH_PATTERN = /^\/watch(\/|$)/;
  const ROUTE_POLL_MS = 500;

  let bootstrapped = false;
  let lastPathname = null;
  let lastWatchPageState = null;
  let runtimeController = null;

  function isWatchPage() {
    return WATCH_PATH_PATTERN.test(globalThis.location.pathname);
  }

  function bootstrapWatchRuntime() {
    if (bootstrapped || !isWatchPage()) {
      return;
    }

    bootstrapped = true;

    const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
    const languageUtils = app.languageUtils;
    const settingsStore = app.core.createSettingsStore();
    const subtitleStore = app.core.createSubtitleStore();
    const translationApi = app.core.createTranslationApi();
    const databaseClient = app.database.createClient();
    const adapter = app.platform.createNetflixAdapter();
    const translationQueue = app.core.createTranslationQueue({
      settingsStore,
      databaseClient,
      translationApi
    });
    const wordController = app.core.createWordTranslationController({
      settingsStore,
      databaseClient,
      translationApi
    });
    const overlayController = app.core.createOverlayController({
      adapter,
      settingsStore,
      subtitleStore,
      translationQueue,
      wordController
    });
    const controlActions = app.core.createControlActions({
      adapter,
      subtitleStore,
      settingsStore,
      translationQueue
    });
    const controlIntegration = app.ui.createControlIntegration({
      adapter,
      settingsStore,
      subtitleStore,
      controlActions
    });

    function logRuntime(stage, detail) {
      if (app.extensionApi && app.extensionApi.debugLog) {
        app.extensionApi.debugLog.record('runtime', stage, detail);
      }
    }

    function normalizeDebugText(value) {
      if (languageUtils && typeof languageUtils.normalizeCueText === 'function') {
        return languageUtils.normalizeCueText(value || '');
      }

      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getTranslationLogPayload() {
      return {
        exportedAt: new Date().toISOString(),
        href: globalThis.location.href,
        title: subtitleStore.getState().title,
        sourceLanguage: subtitleStore.getState().sourceLanguage,
        targetLanguage: settingsStore.get().targetLanguage,
        adapter: typeof adapter.getDebugState === 'function' ? adapter.getDebugState() : null,
        subtitleStore: subtitleStore.getState(),
        entries: app.extensionApi && app.extensionApi.debugLog
          ? app.extensionApi.debugLog.list()
          : []
      };
    }

    function getRenderedVideoRect() {
      const video = adapter.getVideo();
      if (!video || typeof video.getBoundingClientRect !== 'function') {
        const mountTarget = adapter.getMountTarget();
        return mountTarget && typeof mountTarget.getBoundingClientRect === 'function'
          ? mountTarget.getBoundingClientRect()
          : null;
      }

      const rect = video.getBoundingClientRect();
      if (!rect.width || !rect.height || !(video.videoWidth > 0 && video.videoHeight > 0)) {
        return rect;
      }

      const intrinsicAspect = video.videoWidth / video.videoHeight;
      const boxAspect = rect.width / rect.height;
      let renderedWidth = rect.width;
      let renderedHeight = rect.height;

      if (boxAspect > intrinsicAspect) {
        renderedHeight = rect.height;
        renderedWidth = renderedHeight * intrinsicAspect;
      } else {
        renderedWidth = rect.width;
        renderedHeight = renderedWidth / intrinsicAspect;
      }

      const insetX = (rect.width - renderedWidth) / 2;
      const insetY = (rect.height - renderedHeight) / 2;

      return {
        left: rect.left + insetX,
        right: rect.left + insetX + renderedWidth,
        top: rect.top + insetY,
        bottom: rect.top + insetY + renderedHeight,
        width: renderedWidth,
        height: renderedHeight
      };
    }

    function getPlayerRect() {
      const mountTarget = adapter.getMountTarget();
      if (mountTarget && typeof mountTarget.getBoundingClientRect === 'function') {
        const rect = mountTarget.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return rect;
        }
      }

      return getRenderedVideoRect();
    }

    function isVisibleElement(node) {
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

    function toDomPath(node) {
      if (!(node instanceof Element)) {
        return '';
      }

      const parts = [];
      let current = node;
      while (current && current instanceof Element && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += `#${current.id}`;
        } else if (current.classList.length) {
          part += `.${Array.from(current.classList).slice(0, 3).join('.')}`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    }

    function getVisibleControlsSnapshot() {
      const mountTarget = adapter.getMountTarget();
      const rect = getPlayerRect();
      if (!mountTarget || !rect || typeof mountTarget.querySelectorAll !== 'function') {
        return {
          exportedAt: new Date().toISOString(),
          href: globalThis.location.href,
          mountTarget: null,
          playerRect: rect,
          renderedVideoRect: getRenderedVideoRect(),
          controls: [],
          bandElements: [],
          sampleStacks: []
        };
      }

      const topBandBottom = rect.top + (rect.height * 0.22);
      const bottomBandTop = rect.bottom - (rect.height * 0.28);
      const nodes = Array.from(mountTarget.querySelectorAll('button, [role="button"], input, a, [aria-label], [data-uia]'));
      const controls = nodes.filter((node) => {
        if (!(node instanceof Element) || !isVisibleElement(node)) {
          return false;
        }
        if (node.closest('.nll-control-panel, .nll-overlay, .nll-word-tooltip')) {
          return false;
        }
        const nodeRect = node.getBoundingClientRect();
        const centerX = nodeRect.left + (nodeRect.width / 2);
        const centerY = nodeRect.top + (nodeRect.height / 2);
        if (centerX < rect.left || centerX > rect.right || centerY < rect.top || centerY > rect.bottom) {
          return false;
        }
        return centerY <= topBandBottom || centerY >= bottomBandTop;
      }).map((node) => {
        const nodeRect = node.getBoundingClientRect();
        return {
          tagName: node.tagName.toLowerCase(),
          id: node.id || null,
          className: node.className || '',
          role: node.getAttribute('role'),
          ariaLabel: node.getAttribute('aria-label'),
          dataUia: node.getAttribute('data-uia'),
          text: normalizeDebugText(node.textContent || '').slice(0, 120),
          rect: {
            left: Math.round(nodeRect.left),
            top: Math.round(nodeRect.top),
            width: Math.round(nodeRect.width),
            height: Math.round(nodeRect.height)
          },
          path: toDomPath(node)
        };
      });

      const bandElements = Array.from(mountTarget.querySelectorAll('*')).filter((node) => {
        if (!(node instanceof Element) || !isVisibleElement(node)) {
          return false;
        }
        if (node.closest('.nll-control-panel, .nll-overlay, .nll-word-tooltip')) {
          return false;
        }

        const nodeRect = node.getBoundingClientRect();
        const intersectsHorizontally = nodeRect.right >= rect.left && nodeRect.left <= rect.right;
        const intersectsTopBand = nodeRect.bottom >= rect.top && nodeRect.top <= topBandBottom;
        const intersectsBottomBand = nodeRect.bottom >= bottomBandTop && nodeRect.top <= rect.bottom;
        if (!intersectsHorizontally || (!intersectsTopBand && !intersectsBottomBand)) {
          return false;
        }

        const hasSignal = Boolean(
          node.id
          || node.getAttribute('data-uia')
          || node.getAttribute('aria-label')
          || String(node.className || '').trim()
          || normalizeDebugText(node.textContent || '')
        );

        return hasSignal;
      }).slice(0, 120).map((node) => {
        const nodeRect = node.getBoundingClientRect();
        return {
          tagName: node.tagName.toLowerCase(),
          id: node.id || null,
          className: node.className || '',
          role: node.getAttribute('role'),
          ariaLabel: node.getAttribute('aria-label'),
          dataUia: node.getAttribute('data-uia'),
          text: normalizeDebugText(node.textContent || '').slice(0, 120),
          rect: {
            left: Math.round(nodeRect.left),
            top: Math.round(nodeRect.top),
            width: Math.round(nodeRect.width),
            height: Math.round(nodeRect.height)
          },
          path: toDomPath(node)
        };
      });

      function sampleStack(label, x, y) {
        return {
          label,
          point: {
            x: Math.round(x),
            y: Math.round(y)
          },
          elements: document.elementsFromPoint(x, y).filter((node) => {
            return node instanceof Element && !node.closest('.nll-control-panel, .nll-overlay, .nll-word-tooltip');
          }).slice(0, 12).map((node) => {
            return {
              tagName: node.tagName.toLowerCase(),
              id: node.id || null,
              className: node.className || '',
              role: node.getAttribute('role'),
              ariaLabel: node.getAttribute('aria-label'),
              dataUia: node.getAttribute('data-uia'),
              text: normalizeDebugText(node.textContent || '').slice(0, 80),
              path: toDomPath(node)
            };
          })
        };
      }

      const sampleStacks = [
        sampleStack('top-center', rect.left + (rect.width * 0.5), rect.top + (rect.height * 0.08)),
        sampleStack('middle-center', rect.left + (rect.width * 0.5), rect.top + (rect.height * 0.5)),
        sampleStack('top-right', rect.left + (rect.width * 0.9), rect.top + (rect.height * 0.08)),
        sampleStack('bottom-left', rect.left + (rect.width * 0.1), rect.bottom - (rect.height * 0.08)),
        sampleStack('bottom-center', rect.left + (rect.width * 0.5), rect.bottom - (rect.height * 0.08)),
        sampleStack('bottom-right', rect.left + (rect.width * 0.9), rect.bottom - (rect.height * 0.08))
      ];

      return {
        exportedAt: new Date().toISOString(),
        href: globalThis.location.href,
        mountTarget: {
          tagName: mountTarget.tagName.toLowerCase(),
          className: mountTarget.className || '',
          dataUia: mountTarget.getAttribute('data-uia')
        },
        playerRect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        renderedVideoRect: (() => {
          const renderedRect = getRenderedVideoRect();
          return renderedRect ? {
            left: Math.round(renderedRect.left),
            top: Math.round(renderedRect.top),
            width: Math.round(renderedRect.width),
            height: Math.round(renderedRect.height)
          } : null;
        })(),
        controls,
        bandElements,
        sampleStacks
      };
    }

    function saveTranslationLog() {
      const payload = JSON.stringify(getTranslationLogPayload(), null, 2);
      const filename = 'netflix-language-learner-translation-log.json';
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      document.documentElement.appendChild(link);
      link.click();
      link.remove();

      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      return {
        filename,
        entryCount: getTranslationLogPayload().entries.length
      };
    }

    function saveControlLog() {
      const payload = JSON.stringify(getTranslationLogPayload(), null, 2);
      const filename = 'netflix-language-learner-control-log.json';
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      document.documentElement.appendChild(link);
      link.click();
      link.remove();

      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      return {
        filename,
        entryCount: getTranslationLogPayload().entries.length
      };
    }

    function saveVisibleControlsLog() {
      const payload = JSON.stringify(getVisibleControlsSnapshot(), null, 2);
      const filename = 'netflix-language-learner-visible-controls.json';
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      document.documentElement.appendChild(link);
      link.click();
      link.remove();

      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      return {
        filename,
        controlCount: getVisibleControlsSnapshot().controls.length
      };
    }

    function summarizeNode(node) {
      if (!(node instanceof Element)) {
        return null;
      }

      const rect = node.getBoundingClientRect();
      const nllDataset = Object.entries(node.dataset || {}).reduce((result, [key, value]) => {
        if (!key.startsWith('nll')) {
          return result;
        }
        result[key] = value;
        return result;
      }, {});
      return {
        tagName: node.tagName.toLowerCase(),
        id: node.id || null,
        className: node.className || '',
        role: node.getAttribute('role'),
        ariaLabel: node.getAttribute('aria-label'),
        dataUia: node.getAttribute('data-uia'),
        nllDataset,
        text: normalizeDebugText(node.textContent || '').slice(0, 80),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        path: toDomPath(node)
      };
    }

    function getVisibilityTraceTargets() {
      const mountTargetNode = adapter.getMountTarget();
      if (!mountTargetNode || typeof mountTargetNode.querySelector !== 'function') {
        return {
          mountTargetNode: null,
          playerNode: null,
          playerViewNode: null,
          videoNode: null,
          evidenceOverlayNode: null
        };
      }

      return {
        mountTargetNode,
        playerNode: mountTargetNode.querySelector('[data-uia="player"]'),
        playerViewNode: mountTargetNode.querySelector('[data-uia^="watch-video-player-view"]'),
        videoNode: mountTargetNode.querySelector('video'),
        evidenceOverlayNode: mountTargetNode.querySelector('[data-uia="evidence-overlay"], .watch-video--evidence-overlay-container')
      };
    }

    function summarizeComputedState(node) {
      if (!(node instanceof Element)) {
        return null;
      }

      const style = globalThis.getComputedStyle(node);
      return {
        node: summarizeNode(node),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        cursor: style.cursor
      };
    }

    function summarizePlayerLayers(playerNode) {
      if (!(playerNode instanceof Element)) {
        return [];
      }

      return Array.from(playerNode.children).slice(0, 24).map((node) => {
        const summary = summarizeComputedState(node);
        if (!summary) {
          return null;
        }

        return {
          ...summary,
          childCount: node.childElementCount
        };
      }).filter(Boolean);
    }

    function buildVisibilityTraceRecord(stage, detail = {}, traceTargets = getVisibilityTraceTargets()) {
      const {
        mountTargetNode,
        playerNode,
        playerViewNode,
        videoNode,
        evidenceOverlayNode
      } = traceTargets;

      return {
        at: new Date().toISOString(),
        stage,
        playerNode: summarizeNode(playerNode),
        playerViewNode: summarizeNode(playerViewNode),
        mountTargetNode: summarizeNode(mountTargetNode),
        videoNode: summarizeNode(videoNode),
        evidenceOverlayNode: summarizeNode(evidenceOverlayNode),
        videoState: getVideoState(),
        computedState: {
          documentElement: summarizeComputedState(document.documentElement),
          body: summarizeComputedState(document.body),
          mountTarget: summarizeComputedState(mountTargetNode),
          player: summarizeComputedState(playerNode),
          playerView: summarizeComputedState(playerViewNode),
          video: summarizeComputedState(videoNode),
          evidenceOverlay: summarizeComputedState(evidenceOverlayNode),
          activeElement: summarizeNode(document.activeElement instanceof Element ? document.activeElement : null)
        },
        playerLayers: summarizePlayerLayers(playerNode),
        detail,
        sampleStacks: getVisibleControlsSnapshot().sampleStacks
      };
    }

    function getVideoState() {
      const video = adapter.getVideo();
      if (!(video instanceof HTMLVideoElement)) {
        return null;
      }

      return {
        paused: video.paused,
        ended: video.ended,
        seeking: video.seeking,
        currentTime: Number(video.currentTime || 0),
        readyState: Number(video.readyState || 0),
        playbackRate: Number(video.playbackRate || 1)
      };
    }

    async function saveVisibilityTrace(durationMs = 5000) {
      const {
        mountTargetNode,
        playerNode,
        playerViewNode,
        videoNode,
        evidenceOverlayNode
      } = getVisibilityTraceTargets();
      const records = [];
      const sampleLabels = ['top-center', 'middle-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

      function getCurrentSampleStacks() {
        const snapshot = getVisibleControlsSnapshot();
        return sampleLabels.map((label) => {
          return snapshot.sampleStacks.find((item) => item.label === label) || null;
        }).filter(Boolean);
      }

      function record(stage, detail = {}) {
        const traceRecord = buildVisibilityTraceRecord(stage, detail, {
          mountTargetNode,
          playerNode,
          playerViewNode,
          videoNode,
          evidenceOverlayNode
        });
        traceRecord.sampleStacks = getCurrentSampleStacks();
        records.push(traceRecord);
      }

      const observer = new MutationObserver((mutations) => {
        record('mutation', {
          mutations: mutations.slice(0, 40).map((mutation) => ({
            type: mutation.type,
            target: summarizeNode(mutation.target),
            attributeName: mutation.attributeName || null,
            oldValue: mutation.oldValue || null
          }))
        });
      });

      if (mountTargetNode instanceof Element) {
        observer.observe(mountTargetNode, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'aria-hidden', 'hidden', 'data-uia'],
          attributeOldValue: true
        });
      }

      function handleKeydown(event) {
        record('keydown', {
          key: event.key,
          code: event.code
        });
      }

      function handleKeyup(event) {
        record('keyup', {
          key: event.key,
          code: event.code
        });
      }

      function handlePause() {
        record('video-pause', {
          videoState: getVideoState()
        });
      }

      function handlePlay() {
        record('video-play', {
          videoState: getVideoState()
        });
      }

      function handleMousemove(event) {
        record('mousemove', {
          clientX: Math.round(event.clientX),
          clientY: Math.round(event.clientY)
        });
      }

      const sampleTimer = globalThis.setInterval(() => {
        record('sample', {});
      }, 50);

      globalThis.addEventListener('keydown', handleKeydown, true);
      globalThis.addEventListener('keyup', handleKeyup, true);
      globalThis.addEventListener('mousemove', handleMousemove, true);
      if (videoNode instanceof HTMLVideoElement) {
        videoNode.addEventListener('pause', handlePause, true);
        videoNode.addEventListener('play', handlePlay, true);
      }
      record('start', {
        durationMs
      });

      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, Math.max(500, Number(durationMs) || 5000));
      });

      observer.disconnect();
      globalThis.clearInterval(sampleTimer);
      globalThis.removeEventListener('keydown', handleKeydown, true);
      globalThis.removeEventListener('keyup', handleKeyup, true);
      globalThis.removeEventListener('mousemove', handleMousemove, true);
      if (videoNode instanceof HTMLVideoElement) {
        videoNode.removeEventListener('pause', handlePause, true);
        videoNode.removeEventListener('play', handlePlay, true);
      }
      record('end', {});

      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(),
        href: globalThis.location.href,
        durationMs: Math.max(500, Number(durationMs) || 5000),
        records
      }, null, 2);
      const filename = 'netflix-language-learner-visibility-trace.json';
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      document.documentElement.appendChild(link);
      link.click();
      link.remove();

      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      return {
        filename,
        recordCount: records.length
      };
    }

    async function savePlaybackTransitionTrace(durationMs = 1500) {
      const {
        mountTargetNode,
        playerNode,
        playerViewNode,
        videoNode,
        evidenceOverlayNode
      } = getVisibilityTraceTargets();
      const records = [];
      let rafId = null;
      let timeoutId = null;
      let resolveTrace = null;
      let started = false;
      let finished = false;

      function record(stage, detail = {}) {
        records.push(buildVisibilityTraceRecord(stage, detail, {
          mountTargetNode,
          playerNode,
          playerViewNode,
          videoNode,
          evidenceOverlayNode
        }));
      }

      function stopSampling() {
        if (rafId !== null) {
          globalThis.cancelAnimationFrame(rafId);
          rafId = null;
        }
      }

      function finish(stage, detail = {}) {
        if (finished) {
          return;
        }
        finished = true;
        stopSampling();
        if (timeoutId !== null) {
          globalThis.clearTimeout(timeoutId);
          timeoutId = null;
        }
        document.removeEventListener('keydown', handleKeydown, true);
        document.removeEventListener('keyup', handleKeyup, true);
        document.removeEventListener('pointerdown', handlePointerDown, true);
        document.removeEventListener('click', handleClick, true);
        if (videoNode instanceof HTMLVideoElement) {
          videoNode.removeEventListener('pause', handlePause, true);
          videoNode.removeEventListener('play', handlePlay, true);
        }
        record(stage, detail);
        if (resolveTrace) {
          resolveTrace();
          resolveTrace = null;
        }
      }

      function sampleFrame() {
        if (finished) {
          return;
        }
        record(started ? 'frame' : 'armed-frame', {});
        rafId = globalThis.requestAnimationFrame(sampleFrame);
      }

      function startWindow(triggerStage, detail) {
        if (started || finished) {
          return;
        }
        started = true;
        record(triggerStage, detail);
        timeoutId = globalThis.setTimeout(() => {
          finish('trace-complete', {
            durationMs: Math.max(300, Number(durationMs) || 1500)
          });
        }, Math.max(300, Number(durationMs) || 1500));
      }

      function handleKeydown(event) {
        record('keydown', {
          key: event.key,
          code: event.code
        });
      }

      function handleKeyup(event) {
        record('keyup', {
          key: event.key,
          code: event.code
        });
      }

      function handlePointerDown(event) {
        record('pointerdown', {
          clientX: Math.round(event.clientX),
          clientY: Math.round(event.clientY),
          button: Number(event.button || 0)
        });
      }

      function handleClick(event) {
        record('click', {
          clientX: Math.round(event.clientX),
          clientY: Math.round(event.clientY),
          button: Number(event.button || 0)
        });
      }

      function handlePause() {
        startWindow('video-pause', {
          videoState: getVideoState()
        });
      }

      function handlePlay() {
        startWindow('video-play', {
          videoState: getVideoState()
        });
      }

      document.addEventListener('keydown', handleKeydown, true);
      document.addEventListener('keyup', handleKeyup, true);
      document.addEventListener('pointerdown', handlePointerDown, true);
      document.addEventListener('click', handleClick, true);
      if (videoNode instanceof HTMLVideoElement) {
        videoNode.addEventListener('pause', handlePause, true);
        videoNode.addEventListener('play', handlePlay, true);
      }

      record('armed', {
        durationMs: Math.max(300, Number(durationMs) || 1500),
        waitingFor: 'video-play-or-video-pause'
      });
      sampleFrame();

      await new Promise((resolve) => {
        resolveTrace = resolve;
      });

      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(),
        href: globalThis.location.href,
        durationMs: Math.max(300, Number(durationMs) || 1500),
        records
      }, null, 2);
      const filename = 'netflix-language-learner-playback-transition-trace.json';
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = filename;
      document.documentElement.appendChild(link);
      link.click();
      link.remove();

      globalThis.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);

      return {
        filename,
        recordCount: records.length,
        started
      };
    }

    function createRollingVisibilityRecorder() {
      const MAX_RECORDS = 600;
      const SAMPLE_INTERVAL_MS = 100;
      const records = [];
      let sampleTimer = null;
      let running = false;

      function push(stage, detail = {}) {
        records.push(buildVisibilityTraceRecord(stage, detail));
        if (records.length > MAX_RECORDS) {
          records.splice(0, records.length - MAX_RECORDS);
        }
      }

      function start() {
        if (running) {
          return;
        }
        running = true;

        function handleKeydown(event) {
          push('keydown', {
            key: event.key,
            code: event.code
          });
        }

        function handleKeyup(event) {
          push('keyup', {
            key: event.key,
            code: event.code
          });
        }

        function handlePointerDown(event) {
          push('pointerdown', {
            clientX: Math.round(event.clientX),
            clientY: Math.round(event.clientY),
            button: Number(event.button || 0)
          });
        }

        function handleClick(event) {
          push('click', {
            clientX: Math.round(event.clientX),
            clientY: Math.round(event.clientY),
            button: Number(event.button || 0)
          });
        }

        function handleMousemove(event) {
          push('mousemove', {
            clientX: Math.round(event.clientX),
            clientY: Math.round(event.clientY)
          });
        }

        function handlePause() {
          push('video-pause', {
            videoState: getVideoState()
          });
        }

        function handlePlay() {
          push('video-play', {
            videoState: getVideoState()
          });
        }

        document.addEventListener('keydown', handleKeydown, true);
        document.addEventListener('keyup', handleKeyup, true);
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('mousemove', handleMousemove, true);

        function attachVideoListeners() {
          const targets = getVisibilityTraceTargets();
          if (!(targets.videoNode instanceof HTMLVideoElement)) {
            return null;
          }
          targets.videoNode.addEventListener('pause', handlePause, true);
          targets.videoNode.addEventListener('play', handlePlay, true);
          return targets.videoNode;
        }

        let attachedVideoNode = attachVideoListeners();
        sampleTimer = globalThis.setInterval(() => {
          const currentTargets = getVisibilityTraceTargets();
          if (currentTargets.videoNode instanceof HTMLVideoElement && currentTargets.videoNode !== attachedVideoNode) {
            if (attachedVideoNode instanceof HTMLVideoElement) {
              attachedVideoNode.removeEventListener('pause', handlePause, true);
              attachedVideoNode.removeEventListener('play', handlePlay, true);
            }
            attachedVideoNode = attachVideoListeners();
          }
          push('sample', {});
        }, SAMPLE_INTERVAL_MS);

        push('rolling-start', {
          maxRecords: MAX_RECORDS,
          sampleIntervalMs: SAMPLE_INTERVAL_MS
        });

        return () => {
          document.removeEventListener('keydown', handleKeydown, true);
          document.removeEventListener('keyup', handleKeyup, true);
          document.removeEventListener('pointerdown', handlePointerDown, true);
          document.removeEventListener('click', handleClick, true);
          document.removeEventListener('mousemove', handleMousemove, true);
          if (attachedVideoNode instanceof HTMLVideoElement) {
            attachedVideoNode.removeEventListener('pause', handlePause, true);
            attachedVideoNode.removeEventListener('play', handlePlay, true);
          }
        };
      }

      const teardown = start();

      function exportRecords(windowMs = 5000) {
        const since = Date.now() - Math.max(500, Number(windowMs) || 5000);
        return records.filter((record) => {
          const at = Date.parse(record.at);
          return Number.isFinite(at) && at >= since;
        });
      }

      function saveRecent(windowMs = 5000) {
        const payload = JSON.stringify({
          exportedAt: new Date().toISOString(),
          href: globalThis.location.href,
          windowMs: Math.max(500, Number(windowMs) || 5000),
          records: exportRecords(windowMs)
        }, null, 2);
        const filename = 'netflix-language-learner-recent-visibility-trace.json';
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;
        document.documentElement.appendChild(link);
        link.click();
        link.remove();

        globalThis.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);

        return {
          filename,
          recordCount: exportRecords(windowMs).length
        };
      }

      function stop() {
        if (!running) {
          return;
        }
        running = false;
        if (sampleTimer !== null) {
          globalThis.clearInterval(sampleTimer);
          sampleTimer = null;
        }
        if (typeof teardown === 'function') {
          teardown();
        }
      }

      return {
        saveRecent,
        exportRecords,
        stop
      };
    }

    if (app.extensionApi && app.extensionApi.debugLog) {
      app.extensionApi.debugLog.clear();
    }

    logRuntime('bootstrap:start', {
      href: globalThis.location.href
    });

    let rollingVisibilityRecorder = null;

    function getRollingVisibilityRecorder() {
      if (!rollingVisibilityRecorder) {
        rollingVisibilityRecorder = createRollingVisibilityRecorder();
      }

      return rollingVisibilityRecorder;
    }

    globalThis.__NLL_DEBUG__ = {
      adapter,
      settingsStore,
      subtitleStore,
      translationQueue,
      databaseClient,
      getTranslationLog() {
        return getTranslationLogPayload();
      },
      saveTranslationLog,
      saveControlLog,
      getVisibleControlsLog() {
        return getVisibleControlsSnapshot();
      },
      saveVisibleControlsLog,
      saveVisibilityTrace,
      savePlaybackTransitionTrace,
      saveRecentVisibilityTrace(windowMs = 5000) {
        return getRollingVisibilityRecorder().saveRecent(windowMs);
      }
    };

    function applyPlaybackSpeed() {
      controlActions.applyCurrentPlaybackSpeed();
    }

    function getCuePrefetchWindow(activeCue, timeline) {
      if (!activeCue || !Array.isArray(timeline) || timeline.length === 0) {
        return [];
      }

      const index = timeline.findIndex((cue) => {
        return cue.startTime === activeCue.startTime && cue.endTime === activeCue.endTime && cue.text === activeCue.text;
      });
      if (index < 0) {
        return [activeCue];
      }
      return timeline.slice(index, index + 5);
    }

    function syncFromAdapter(targetLanguage) {
      subtitleStore.setPlayerReady(adapter.isWatchPlaybackActive());
      subtitleStore.setTitle(adapter.getTitle(), targetLanguage);
      subtitleStore.setSourceLanguage(adapter.getSourceLanguage());
      subtitleStore.setTimeline(adapter.getTimeline());
      subtitleStore.setPreferredTranslation(
        typeof adapter.getPreferredTranslation === 'function'
          ? adapter.getPreferredTranslation()
          : null
      );
      subtitleStore.setFeatureAvailability(adapter.getFeatureAvailability());
      overlayController.syncMount();
      controlIntegration.syncMount();
      applyPlaybackSpeed();
      syncNativeSubtitleVisibility();
    }

    function syncNativeSubtitleVisibility() {
      const settings = settingsStore.get();
      const availability = subtitleStore.getState().featureAvailability || {};
      const shouldShowNativeSubtitles = !adapter.getVideo()
        || !(settings.extensionEnabled && availability.dualSubs);

      if (typeof adapter.setNativeSubtitleVisibility === 'function') {
        adapter.setNativeSubtitleVisibility(shouldShowNativeSubtitles);
      }
    }

    function syncSubtitlePreferences() {
      if (typeof adapter.setSubtitlePreferences !== 'function') {
        return;
      }

      const settings = settingsStore.get();
      adapter.setSubtitlePreferences({
        extensionEnabled: settings.extensionEnabled,
        autoPauseEnabled: settings.autoPauseEnabled,
        targetLanguage: settings.targetLanguage,
        useNetflixTargetSubtitlesIfAvailable: settings.useNetflixTargetSubtitlesIfAvailable
      });
    }

    adapter.subscribe((event) => {
      const settings = settingsStore.get();
      logRuntime(`adapter:${event.type}`, event);

      switch (event.type) {
        case 'playerReady':
          syncFromAdapter(settings.targetLanguage);
          break;
        case 'captionsChanged':
        case 'timelineReady':
          syncFromAdapter(settings.targetLanguage);
          if (!adapter.getTimeline().length) {
          subtitleStore.setActiveCue(null, settings.targetLanguage);
        }
        break;
      case 'activeSubtitleChanged':
        subtitleStore.setActiveCue(event.cue, settings.targetLanguage);
        if (event.cue && !(
          settings.useNetflixTargetSubtitlesIfAvailable
          && typeof adapter.getPreferredTranslation === 'function'
          && adapter.getPreferredTranslation().available
        )) {
          translationQueue.prefetch({
            title: subtitleStore.getState().title,
            cues: getCuePrefetchWindow(event.cue, subtitleStore.getState().timeline),
            sourceLanguage: subtitleStore.getState().sourceLanguage
          });
        }
        break;
      case 'preferredTranslationChanged':
        subtitleStore.setPreferredTranslation(event.translation);
        break;
      case 'titleChanged':
        subtitleStore.setTitle(event.title, settings.targetLanguage);
        databaseClient.upsertTitleMetadata(event.title, {
          lastOpenedAt: Date.now()
        }).catch(() => {});
        break;
      case 'platformError':
        subtitleStore.setPlatformError(typeof event.error === 'string' ? event.error : null);
          break;
        default:
          break;
      }
    });

    settingsStore.subscribe((settings) => {
      logRuntime('settings:update', {
        targetLanguage: settings.targetLanguage,
        extensionEnabled: settings.extensionEnabled
      });
      subtitleStore.refreshActiveTranslationKey(settings.targetLanguage);
      applyPlaybackSpeed();
      syncNativeSubtitleVisibility();
      syncSubtitlePreferences();
      if (!settings.extensionEnabled) {
        wordController.hideTooltip();
      }
    });

    settingsStore.load().then(async () => {
      logRuntime('settings:loaded', {
        targetLanguage: settingsStore.get().targetLanguage
      });
      await adapter.init();
      logRuntime('adapter:init-complete', {
        hasVideo: Boolean(adapter.getVideo())
      });
      syncSubtitlePreferences();
      syncFromAdapter(settingsStore.get().targetLanguage);
      databaseClient.open().then(() => {
        logRuntime('database:open-success', {});
      }).catch((error) => {
        logRuntime('database:open-error', {
          error: error?.message || String(error)
        });
      });
    }).catch((error) => {
      logRuntime('bootstrap:error', {
        error: error?.message || String(error)
      });
      subtitleStore.setPlatformError(error.message || String(error));
    });

    runtimeController = {
      setWatchRouteActive(isActive) {
        logRuntime('route:watch-state', {
          active: Boolean(isActive),
          pathname: globalThis.location.pathname
        });
        if (typeof adapter.setWatchRouteActive === 'function') {
          adapter.setWatchRouteActive(isActive);
        }
        syncFromAdapter(settingsStore.get().targetLanguage);
        if (!isActive) {
          wordController.hideTooltip();
        }
      }
    };
  }

  function checkRoute() {
    const currentPathname = globalThis.location.pathname;
    const currentWatchPageState = isWatchPage();
    if (currentPathname === lastPathname && currentWatchPageState === lastWatchPageState) {
      return;
    }

    lastPathname = currentPathname;
    lastWatchPageState = currentWatchPageState;
    bootstrapWatchRuntime();
    if (runtimeController) {
      runtimeController.setWatchRouteActive(currentWatchPageState);
    }
  }

  checkRoute();
  globalThis.setInterval(checkRoute, ROUTE_POLL_MS);
})();
