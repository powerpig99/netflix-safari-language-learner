(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const extensionApi = app.extensionApi;
  const languageUtils = app.languageUtils;

  const elements = {
    extensionEnabled: document.getElementById('extension-enabled'),
    dualSubEnabled: document.getElementById('dual-sub-enabled'),
    autoPauseEnabled: document.getElementById('auto-pause-enabled'),
    targetLanguage: document.getElementById('target-language'),
    translationProvider: document.getElementById('translation-provider'),
    playbackSpeed: document.getElementById('playback-speed'),
    openOptions: document.getElementById('open-options'),
    closePopup: document.getElementById('close-popup')
  };

  const state = { ...languageUtils.DEFAULT_SETTINGS };

  function render() {
    elements.extensionEnabled.checked = Boolean(state.extensionEnabled);
    elements.dualSubEnabled.checked = Boolean(state.dualSubEnabled);
    elements.autoPauseEnabled.checked = Boolean(state.autoPauseEnabled);
    elements.targetLanguage.textContent = state.targetLanguage;
    elements.translationProvider.textContent = languageUtils.getProvider(state.translationProvider).name;
    elements.playbackSpeed.textContent = `${state.playbackSpeed}x`;
  }

  async function persist(patch) {
    Object.assign(state, patch);
    render();
    await extensionApi.storage.set(patch);
  }

  async function bootstrap() {
    const keys = Object.keys(languageUtils.DEFAULT_SETTINGS);
    Object.assign(state, await extensionApi.storage.get(keys));
    render();
  }

  elements.extensionEnabled.addEventListener('change', () => {
    persist({ extensionEnabled: elements.extensionEnabled.checked });
  });

  elements.dualSubEnabled.addEventListener('change', () => {
    persist({ dualSubEnabled: elements.dualSubEnabled.checked });
  });

  elements.autoPauseEnabled.addEventListener('change', () => {
    persist({ autoPauseEnabled: elements.autoPauseEnabled.checked });
  });

  elements.openOptions.addEventListener('click', () => {
    extensionApi.runtime.openOptionsPage().catch(() => {});
  });

  elements.closePopup.addEventListener('click', () => {
    globalThis.close();
  });

  bootstrap();
})();
