(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};

  function createAutoPauseController({ adapter, settingsStore, subtitleStore }) {
    let attachedVideo = null;
    let pauseTimer = null;

    function clear() {
      if (pauseTimer) {
        globalThis.clearTimeout(pauseTimer);
        pauseTimer = null;
      }
    }

    function schedule() {
      clear();

      const settings = settingsStore.get();
      const state = subtitleStore.getState();
      if (!settings.extensionEnabled || !settings.autoPauseEnabled || !state.featureAvailability.autoPause) {
        return;
      }

      const video = adapter.getVideo();
      const cue = state.activeSubtitle.cue;
      if (!video || !cue || typeof cue.endTime !== 'number') {
        return;
      }

      const currentTime = typeof adapter.getCurrentTime === 'function'
        ? Number(adapter.getCurrentTime())
        : video.currentTime;
      const remainingSeconds = cue.endTime - currentTime;
      if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
        return;
      }

      pauseTimer = globalThis.setTimeout(() => {
        const currentVideo = adapter.getVideo();
        if (currentVideo === video && !video.paused) {
          video.pause();
        }
      }, Math.max(0, (remainingSeconds * 1000) - 40));
    }

    function attachVideo(video) {
      if (attachedVideo === video) {
        return;
      }

      if (attachedVideo) {
        attachedVideo.removeEventListener('play', schedule);
        attachedVideo.removeEventListener('pause', clear);
        attachedVideo.removeEventListener('seeked', schedule);
        attachedVideo.removeEventListener('ratechange', schedule);
      }

      attachedVideo = video;

      if (!attachedVideo) {
        clear();
        return;
      }

      attachedVideo.addEventListener('play', schedule);
      attachedVideo.addEventListener('pause', clear);
      attachedVideo.addEventListener('seeked', schedule);
      attachedVideo.addEventListener('ratechange', schedule);
      schedule();
    }

    const unsubscribeSettings = settingsStore.subscribe(schedule);
    const unsubscribeStore = subtitleStore.subscribe(schedule);

    return {
      attachVideo,
      schedule,
      clear,
      destroy() {
        unsubscribeSettings();
        unsubscribeStore();
        attachVideo(null);
      }
    };
  }

  core.createAutoPauseController = createAutoPauseController;
})();
