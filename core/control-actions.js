(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const extensionApi = app.extensionApi;

  function logControls(stage, detail) {
    if (extensionApi && extensionApi.debugLog) {
      extensionApi.debugLog.record('controls', stage, detail);
    }
  }

  function createControlActions({ adapter, subtitleStore, settingsStore, translationQueue }) {
    function clampPlaybackSpeed(speed) {
      return Math.max(0.5, Math.min(2, Math.round(Number(speed) * 100) / 100));
    }

    function getVideo() {
      return adapter.getVideo();
    }

    function getCurrentTime() {
      if (typeof adapter.getCurrentTime === 'function') {
        const adapterTime = Number(adapter.getCurrentTime());
        if (Number.isFinite(adapterTime)) {
          return adapterTime;
        }
      }

      const video = getVideo();
      return video ? video.currentTime : NaN;
    }

    function getNavigationTargets() {
      const timeline = subtitleStore.getState().timeline;
      if (!Array.isArray(timeline)) {
        return [];
      }
      return timeline.slice().sort((left, right) => left.startTime - right.startTime);
    }

    function getCurrentCueIndex(video, targets) {
      const currentTime = getCurrentTime();
      let currentIndex = -1;

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        if (currentTime >= target.startTime && currentTime <= target.endTime) {
          return index;
        }
        if (currentTime >= target.startTime) {
          currentIndex = index;
        }
      }

      return currentIndex;
    }

    function seekToTarget(target) {
      const video = getVideo();
      if (!video || !target) {
        return false;
      }

      logControls('navigation:seek-target', {
        targetStartTime: target.startTime,
        targetEndTime: target.endTime,
        currentTime: getCurrentTime()
      });

      if (typeof adapter.seekAndPlay === 'function' && adapter.seekAndPlay(target.startTime)) {
        logControls('navigation:seek-issued', {
          targetStartTime: target.startTime,
          playResult: true,
          mode: 'seek-and-play'
        });
        return true;
      }

      return false;
    }

    async function setPlaybackSpeed(speed) {
      const safeSpeed = clampPlaybackSpeed(speed);
      if (!Number.isFinite(safeSpeed)) {
        return;
      }

      const video = getVideo();
      if (video) {
        video.playbackRate = safeSpeed;
      }

      await settingsStore.update({ playbackSpeed: safeSpeed });
    }

    async function changePlaybackSpeed(delta) {
      const currentSpeed = Number(settingsStore.get().playbackSpeed || 1);
      return setPlaybackSpeed(currentSpeed + Number(delta || 0));
    }

    return {
      getNavigationTargets,
      async toggleExtension() {
        const settings = settingsStore.get();
        await settingsStore.update({ extensionEnabled: !settings.extensionEnabled });
      },
      async toggleDualSub() {
        const settings = settingsStore.get();
        await settingsStore.update({ dualSubEnabled: !settings.dualSubEnabled });
      },
      async toggleAutoPause() {
        const settings = settingsStore.get();
        await settingsStore.update({ autoPauseEnabled: !settings.autoPauseEnabled });
      },
      async setPlaybackSpeed(speed) {
        return setPlaybackSpeed(speed);
      },
      async changePlaybackSpeed(delta) {
        return changePlaybackSpeed(delta);
      },
      togglePlayPause() {
        const video = getVideo();
        if (!video) {
          return false;
        }
        const result = Boolean(typeof adapter.togglePlayback === 'function' && adapter.togglePlayback());
        logControls('playback:toggle', {
          currentTime: getCurrentTime(),
          result
        });
        return result;
      },
      previousSubtitle() {
        const video = getVideo();
        const targets = getNavigationTargets();
        if (!video || targets.length === 0) {
          return false;
        }
        const currentIndex = getCurrentCueIndex(video, targets);
        if (currentIndex <= 0) {
          return false;
        }
        return seekToTarget(targets[currentIndex - 1]);
      },
      nextSubtitle() {
        const video = getVideo();
        const targets = getNavigationTargets();
        if (!video || targets.length === 0) {
          return false;
        }
        const currentIndex = getCurrentCueIndex(video, targets);
        if (currentIndex < 0) {
          return seekToTarget(targets[0]);
        }
        if (currentIndex >= targets.length - 1) {
          return false;
        }
        return seekToTarget(targets[currentIndex + 1]);
      },
      repeatSubtitle() {
        const video = getVideo();
        const targets = getNavigationTargets();
        if (!video || targets.length === 0) {
          return false;
        }
        const currentIndex = getCurrentCueIndex(video, targets);
        if (currentIndex < 0) {
          return false;
        }
        return seekToTarget(targets[currentIndex]);
      },
      retrySubtitleTranslation() {
        const activeCue = subtitleStore.getState().activeSubtitle.cue;
        const sourceLanguage = subtitleStore.getState().sourceLanguage;
        const title = subtitleStore.getState().title;
        if (!translationQueue || !activeCue) {
          return false;
        }

        translationQueue.retry({
          title,
          cue: activeCue,
          sourceLanguage
        }).catch(() => {});
        return true;
      },
      applyCurrentPlaybackSpeed() {
        const settings = settingsStore.get();
        const video = getVideo();
        if (video) {
          video.playbackRate = settings.playbackSpeed;
        }
      },
      async openSettings() {
        try {
          const response = await extensionApi.runtime.sendMessage({ action: 'openOptionsPage' });
          if (response && response.success) {
            return true;
          }
        } catch (_error) {}

        try {
          await extensionApi.runtime.openOptionsPage();
          return true;
        } catch (_error) {}

        const optionsUrl = extensionApi.runtime.getURL('options/index.html');
        if (optionsUrl && typeof globalThis.open === 'function') {
          globalThis.open(optionsUrl, '_blank', 'noopener');
          return true;
        }

        return false;
      }
    };
  }

  core.createControlActions = createControlActions;
})();
