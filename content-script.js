(() => {
  if (globalThis.__NLL_CONTENT_SCRIPT__) {
    return;
  }
  globalThis.__NLL_CONTENT_SCRIPT__ = true;

  const WATCH_PATH_PATTERN = /^\/watch(\/|$)/;
  const ROUTE_POLL_MS = 500;

  let bootstrapped = false;
  let lastPathname = globalThis.location.pathname;

  function isWatchPage() {
    return WATCH_PATH_PATTERN.test(globalThis.location.pathname);
  }

  function bootstrapWatchRuntime() {
    if (bootstrapped || !isWatchPage()) {
      return;
    }

    bootstrapped = true;

    const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
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
    const autoPauseController = app.core.createAutoPauseController({
      adapter,
      settingsStore,
      subtitleStore
    });
    const controlActions = app.core.createControlActions({
      adapter,
      subtitleStore,
      settingsStore,
      autoPauseController
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

    if (app.extensionApi && app.extensionApi.debugLog) {
      app.extensionApi.debugLog.clear();
    }

    logRuntime('bootstrap:start', {
      href: globalThis.location.href
    });

    globalThis.__NLL_DEBUG__ = {
      adapter,
      settingsStore,
      subtitleStore,
      translationQueue,
      databaseClient,
      getTranslationLog() {
        return getTranslationLogPayload();
      },
      saveTranslationLog
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
      subtitleStore.setTitle(adapter.getTitle(), targetLanguage);
      subtitleStore.setSourceLanguage(adapter.getSourceLanguage());
      subtitleStore.setTimeline(adapter.getTimeline());
      subtitleStore.setFeatureAvailability(adapter.getFeatureAvailability());
      autoPauseController.attachVideo(adapter.getVideo());
      overlayController.syncMount();
      controlIntegration.syncMount();
      applyPlaybackSpeed();
    }

    adapter.subscribe((event) => {
      const settings = settingsStore.get();
      logRuntime(`adapter:${event.type}`, event);

      switch (event.type) {
        case 'playerReady':
          subtitleStore.setPlayerReady(true);
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
        if (event.cue) {
          translationQueue.prefetch({
            title: subtitleStore.getState().title,
            cues: getCuePrefetchWindow(event.cue, subtitleStore.getState().timeline),
            sourceLanguage: subtitleStore.getState().sourceLanguage
          });
        }
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
  }

  function checkRoute() {
    const currentPathname = globalThis.location.pathname;
    if (currentPathname === lastPathname && !isWatchPage()) {
      return;
    }

    lastPathname = currentPathname;
    bootstrapWatchRuntime();
  }

  checkRoute();
  globalThis.setInterval(checkRoute, ROUTE_POLL_MS);
})();
