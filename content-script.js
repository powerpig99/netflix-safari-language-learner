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

    logRuntime('bootstrap:start', {
      href: globalThis.location.href
    });

    const runtimeDebug = app.debug && typeof app.debug.attachRuntimeDebug === 'function'
      ? app.debug.attachRuntimeDebug({
        adapter,
        settingsStore,
        subtitleStore,
        translationQueue,
        databaseClient,
        languageUtils,
        extensionApi: app.extensionApi,
        logRuntime
      })
      : null;

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

      try {
        await adapter.init();
        logRuntime('adapter:init-complete', {
          hasVideo: Boolean(adapter.getVideo())
        });
      } catch (error) {
        logRuntime('adapter:init-error', {
          error: error?.message || String(error)
        });
        subtitleStore.setPlatformError(error?.message || String(error));
        return;
      }

      try {
        syncSubtitlePreferences();
        syncFromAdapter(settingsStore.get().targetLanguage);
      } catch (error) {
        logRuntime('sync:error', {
          error: error?.message || String(error)
        });
        subtitleStore.setPlatformError(error?.message || String(error));
      }

      try {
        await databaseClient.open();
        logRuntime('database:open-success', {});
      } catch (error) {
        logRuntime('database:open-error', {
          error: error?.message || String(error)
        });
      }
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
