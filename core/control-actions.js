(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const extensionApi = app.extensionApi;

  function createControlActions({ adapter, subtitleStore, settingsStore, autoPauseController }) {
    function getVideo() {
      return adapter.getVideo() || document.querySelector('video');
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

      const wasPaused = video.paused;

      if (typeof adapter.seekToTime === 'function' && adapter.seekToTime(target.startTime, { preservePaused: wasPaused })) {
        if (wasPaused) {
          autoPauseController.clear();
        } else {
          autoPauseController.schedule();
        }
        return true;
      }

      video.currentTime = target.startTime;
      if (!wasPaused && video.paused) {
        video.play().catch(() => {});
      }
      if (wasPaused) {
        autoPauseController.clear();
      } else {
        autoPauseController.schedule();
      }
      return true;
    }

    async function setPlaybackSpeed(speed) {
      const safeSpeed = Number(speed);
      if (!Number.isFinite(safeSpeed)) {
        return;
      }

      const video = getVideo();
      if (video) {
        video.playbackRate = safeSpeed;
      }

      await settingsStore.update({ playbackSpeed: safeSpeed });
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
      togglePlayPause() {
        const video = getVideo();
        if (!video) {
          return false;
        }
        if (video.paused) {
          video.play().catch(() => {});
          return true;
        }
        video.pause();
        return false;
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
      applyCurrentPlaybackSpeed() {
        const settings = settingsStore.get();
        const video = getVideo();
        if (video) {
          video.playbackRate = settings.playbackSpeed;
        }
      },
      openSettings() {
        extensionApi.runtime.openOptionsPage().catch(() => {});
      }
    };
  }

  core.createControlActions = createControlActions;
})();
