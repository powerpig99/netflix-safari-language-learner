(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const extensionApi = app.extensionApi;
  const languageUtils = app.languageUtils;

  const state = { ...languageUtils.DEFAULT_SETTINGS };

  const elements = {
    extensionEnabled: document.getElementById('extension-enabled'),
    dualSubEnabled: document.getElementById('dual-sub-enabled'),
    autoPauseEnabled: document.getElementById('auto-pause-enabled'),
    targetLanguage: document.getElementById('target-language'),
    translationProvider: document.getElementById('translation-provider'),
    providerLinkWrap: document.getElementById('provider-link-wrap'),
    providerLink: document.getElementById('provider-link'),
    apiKeyField: document.getElementById('api-key-field'),
    providerApiKey: document.getElementById('provider-api-key'),
    geminiModelField: document.getElementById('gemini-model-field'),
    geminiModel: document.getElementById('gemini-model'),
    grokModelField: document.getElementById('grok-model-field'),
    grokModel: document.getElementById('grok-model'),
    playbackSpeed: document.getElementById('playback-speed'),
    subtitleFontSize: document.getElementById('subtitle-font-size')
  };

  function buildSelect(select, options, valueKey = 'code', labelKey = 'name') {
    const fragment = document.createDocumentFragment();
    options.forEach((option) => {
      const element = document.createElement('option');
      element.value = String(option[valueKey]);
      element.textContent = String(option[labelKey]);
      fragment.appendChild(element);
    });
    select.textContent = '';
    select.appendChild(fragment);
  }

  function getProviderApiKeyField() {
    return languageUtils.getProvider(state.translationProvider).apiKeyField;
  }

  function render() {
    elements.extensionEnabled.checked = Boolean(state.extensionEnabled);
    elements.dualSubEnabled.checked = Boolean(state.dualSubEnabled);
    elements.autoPauseEnabled.checked = Boolean(state.autoPauseEnabled);
    elements.targetLanguage.value = state.targetLanguage;
    elements.translationProvider.value = state.translationProvider;
    elements.playbackSpeed.value = String(state.playbackSpeed);
    elements.subtitleFontSize.value = state.subtitleFontSize;
    elements.geminiModel.value = state.geminiModel;
    elements.grokModel.value = state.grokModel;

    const provider = languageUtils.getProvider(state.translationProvider);
    const apiKeyField = getProviderApiKeyField();

    elements.providerLinkWrap.classList.toggle('hidden', !provider.link);
    elements.providerLink.href = provider.link || '#';

    elements.apiKeyField.classList.toggle('hidden', !apiKeyField);
    elements.providerApiKey.value = apiKeyField ? state[apiKeyField] || '' : '';

    elements.geminiModelField.classList.toggle('hidden', state.translationProvider !== 'gemini');
    elements.grokModelField.classList.toggle('hidden', state.translationProvider !== 'grok');
  }

  async function persist(patch) {
    Object.assign(state, patch);
    render();
    await extensionApi.storage.set(patch);
  }

  function bindInputs() {
    elements.extensionEnabled.addEventListener('change', () => persist({ extensionEnabled: elements.extensionEnabled.checked }));
    elements.dualSubEnabled.addEventListener('change', () => persist({ dualSubEnabled: elements.dualSubEnabled.checked }));
    elements.autoPauseEnabled.addEventListener('change', () => persist({ autoPauseEnabled: elements.autoPauseEnabled.checked }));
    elements.targetLanguage.addEventListener('change', () => persist({ targetLanguage: elements.targetLanguage.value }));
    elements.translationProvider.addEventListener('change', () => persist({ translationProvider: elements.translationProvider.value }));
    elements.playbackSpeed.addEventListener('change', () => persist({ playbackSpeed: Number(elements.playbackSpeed.value) }));
    elements.subtitleFontSize.addEventListener('change', () => persist({ subtitleFontSize: elements.subtitleFontSize.value }));
    elements.geminiModel.addEventListener('change', () => persist({ geminiModel: elements.geminiModel.value }));
    elements.grokModel.addEventListener('change', () => persist({ grokModel: elements.grokModel.value }));
    elements.providerApiKey.addEventListener('change', () => {
      const apiKeyField = getProviderApiKeyField();
      if (!apiKeyField) {
        return;
      }
      persist({ [apiKeyField]: elements.providerApiKey.value.trim() });
    });
  }

  async function bootstrap() {
    buildSelect(elements.targetLanguage, languageUtils.TARGET_LANGUAGES);
    buildSelect(elements.translationProvider, languageUtils.PROVIDERS, 'id', 'name');
    buildSelect(elements.geminiModel, languageUtils.GEMINI_MODELS, 'id', 'name');
    buildSelect(elements.subtitleFontSize, languageUtils.FONT_SIZE_OPTIONS, 'value', 'label');

    Object.assign(state, await extensionApi.storage.get(Object.keys(languageUtils.DEFAULT_SETTINGS)));
    render();
    bindInputs();
  }

  bootstrap();
})();
