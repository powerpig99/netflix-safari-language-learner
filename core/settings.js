(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const extensionApi = app.extensionApi;
  const languageUtils = app.languageUtils;

  function createSettingsStore() {
    const listeners = new Set();
    const state = { ...languageUtils.DEFAULT_SETTINGS };
    let removeStorageListener = () => {};
    let loaded = false;

    function snapshot() {
      return { ...state };
    }

    function emit() {
      const nextState = snapshot();
      listeners.forEach((listener) => listener(nextState));
    }

    function applyPatch(patch) {
      let changed = false;
      Object.entries(patch || {}).forEach(([key, value]) => {
        if (!(key in state)) {
          return;
        }
        if (state[key] === value) {
          return;
        }
        state[key] = value;
        changed = true;
      });
      if (changed) {
        emit();
      }
      return changed;
    }

    async function load() {
      const keys = Object.keys(languageUtils.DEFAULT_SETTINGS);
      const storedValues = await extensionApi.storage.get(keys);
      applyPatch(storedValues);

      if (!loaded) {
        removeStorageListener = extensionApi.storage.addChangeListener((changes, areaName) => {
          if (areaName !== 'sync') {
            return;
          }

          const patch = {};
          Object.keys(languageUtils.DEFAULT_SETTINGS).forEach((key) => {
            if (changes[key]) {
              patch[key] = changes[key].newValue;
            }
          });
          applyPatch(patch);
        });
        loaded = true;
      }

      emit();
      return snapshot();
    }

    async function update(patch) {
      applyPatch(patch);
      await extensionApi.storage.set(patch);
      return snapshot();
    }

    function subscribe(listener, emitImmediately = true) {
      listeners.add(listener);
      if (emitImmediately) {
        listener(snapshot());
      }
      return () => {
        listeners.delete(listener);
      };
    }

    function getProviderApiKeyField(providerId = state.translationProvider) {
      return languageUtils.getProvider(providerId).apiKeyField;
    }

    function hasProviderCredentials(providerId = state.translationProvider) {
      const apiKeyField = getProviderApiKeyField(providerId);
      if (!apiKeyField) {
        return true;
      }
      return typeof state[apiKeyField] === 'string' && state[apiKeyField].trim().length > 0;
    }

    function shouldTranslate(sourceLanguage) {
      if (!state.extensionEnabled || !state.dualSubEnabled) {
        return false;
      }
      if (!sourceLanguage) {
        return true;
      }
      return languageUtils.normalizeLanguageCode(sourceLanguage) !== languageUtils.normalizeLanguageCode(state.targetLanguage);
    }

    function destroy() {
      removeStorageListener();
      listeners.clear();
    }

    return {
      load,
      update,
      get: snapshot,
      subscribe,
      hasProviderCredentials,
      shouldTranslate,
      destroy
    };
  }

  core.createSettingsStore = createSettingsStore;
})();
