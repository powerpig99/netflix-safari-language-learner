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
      // Rendered-DOM cues often arrive before a stable timeline history exists.
      // Always translate at least the active cue when present.
      if (!activeCue || !activeCue.text) {
        return [];
      }

      if (!Array.isArray(timeline) || timeline.length === 0) {
        return [activeCue];
      }

      const index = timeline.findIndex((cue) => {
        return cue.text === activeCue.text
          && Math.abs(Number(cue.startTime) - Number(activeCue.startTime)) < 0.2;
      });
      if (index < 0) {
        return [activeCue];
      }
      return timeline.slice(index, index + 5);
    }

    function requestCueTranslation(cue) {
      if (!cue || !cue.text) {
        return;
      }

      const settings = settingsStore.get();
      if (!settings.dualSubEnabled || !settings.extensionEnabled) {
        return;
      }

      const preferred = typeof adapter.getPreferredTranslation === 'function'
        ? adapter.getPreferredTranslation()
        : null;
      // Skip machine translation only when Netflix already provided target-line text.
      const hasNetflixTargetText = Boolean(
        settings.useNetflixTargetSubtitlesIfAvailable
        && preferred
        && preferred.available
        && preferred.cue
        && preferred.cue.text
      );
      if (hasNetflixTargetText) {
        return;
      }

      const state = subtitleStore.getState();
      translationQueue.prefetch({
        title: state.title || adapter.getTitle() || document.title || 'Netflix',
        cues: getCuePrefetchWindow(cue, state.timeline),
        sourceLanguage: state.sourceLanguage || 'auto'
      });
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
          } else {
            subtitleStore.setPlatformError(null);
          }
          break;
      case 'activeSubtitleChanged':
        subtitleStore.setActiveCue(event.cue, settings.targetLanguage);
        // Dual-subs are live: never keep a hydration warning between subtitle lines.
        if (event.cue) {
          subtitleStore.setPlatformError(null);
          requestCueTranslation(event.cue);
        }
        break;
      case 'preferredTranslationChanged':
        subtitleStore.setPreferredTranslation(event.translation);
        // If Netflix just delivered target-language text, drop machine-translation pending UI.
        if (event.translation && event.translation.available && event.translation.cue) {
          subtitleStore.setPlatformError(null);
        }
        break;
      case 'timelineReady':
        // fallthrough handled above in combined case — keep error clear when timeline exists
        break;
      case 'titleChanged':
        subtitleStore.setTitle(event.title, settings.targetLanguage);
        databaseClient.upsertTitleMetadata(event.title, {
          lastOpenedAt: Date.now()
        }).catch(() => {});
        break;
      case 'platformError':
        // Ignore empty/null errors (explicit clear). Ignore hydration banners when
        // dual-subs already have a live original cue.
        if (event.error == null || event.error === '') {
          subtitleStore.setPlatformError(null);
        } else if (subtitleStore.getState().activeSubtitle.cue) {
          subtitleStore.setPlatformError(null);
        } else {
          subtitleStore.setPlatformError(typeof event.error === 'string' ? event.error : null);
        }
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
