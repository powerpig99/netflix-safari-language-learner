(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const utils = app.languageUtils = app.languageUtils || {};

  const DEFAULT_SETTINGS = {
    extensionEnabled: true,
    dualSubEnabled: true,
    autoPauseEnabled: false,
    playbackSpeed: 1,
    targetLanguage: 'EN-US',
    translationProvider: 'google',
    subtitleFontSize: 'medium',
    googleCloudApiKey: '',
    deeplApiKey: '',
    claudeApiKey: '',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash-lite',
    grokApiKey: '',
    grokModel: 'grok-4-1-fast-non-reasoning-latest',
    kimiApiKey: ''
  };

  const PROVIDERS = [
    { id: 'google', name: 'Google Translate', description: 'Free endpoint, no API key', apiKeyField: null, link: '' },
    { id: 'googleCloud', name: 'Google Cloud', description: 'Translation API v2', apiKeyField: 'googleCloudApiKey', link: 'https://console.cloud.google.com/apis/library/translate.googleapis.com' },
    { id: 'deepl', name: 'DeepL', description: 'API key required', apiKeyField: 'deeplApiKey', link: 'https://www.deepl.com/pro-api' },
    { id: 'claude', name: 'Claude', description: 'Anthropic API', apiKeyField: 'claudeApiKey', link: 'https://console.anthropic.com/settings/keys' },
    { id: 'gemini', name: 'Gemini', description: 'Google AI Studio', apiKeyField: 'geminiApiKey', link: 'https://aistudio.google.com/apikey' },
    { id: 'grok', name: 'Grok', description: 'xAI API', apiKeyField: 'grokApiKey', link: 'https://console.x.ai' },
    { id: 'kimi', name: 'Kimi', description: 'Moonshot API', apiKeyField: 'kimiApiKey', link: 'https://platform.moonshot.ai' }
  ];

  const GEMINI_MODELS = [
    {
      id: 'gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash-Lite',
      description: 'Default low-cost model for subtitle translation.'
    },
    {
      id: 'gemini-3.1-flash-lite-preview',
      name: 'Gemini 3.1 Flash-Lite Preview',
      description: 'Preview option with potentially better quality or latency.'
    }
  ];

  const TARGET_LANGUAGES = [
    { code: 'EN-US', name: 'English (US)' },
    { code: 'EN-GB', name: 'English (UK)' },
    { code: 'AR', name: 'Arabic' },
    { code: 'CS', name: 'Czech' },
    { code: 'DA', name: 'Danish' },
    { code: 'DE', name: 'German' },
    { code: 'EL', name: 'Greek' },
    { code: 'ES', name: 'Spanish' },
    { code: 'FI', name: 'Finnish' },
    { code: 'FR', name: 'French' },
    { code: 'HI', name: 'Hindi' },
    { code: 'HU', name: 'Hungarian' },
    { code: 'ID', name: 'Indonesian' },
    { code: 'IT', name: 'Italian' },
    { code: 'JA', name: 'Japanese' },
    { code: 'KO', name: 'Korean' },
    { code: 'NL', name: 'Dutch' },
    { code: 'NO', name: 'Norwegian' },
    { code: 'PL', name: 'Polish' },
    { code: 'PT-BR', name: 'Portuguese (Brazil)' },
    { code: 'PT-PT', name: 'Portuguese (Portugal)' },
    { code: 'RO', name: 'Romanian' },
    { code: 'RU', name: 'Russian' },
    { code: 'SV', name: 'Swedish' },
    { code: 'TR', name: 'Turkish' },
    { code: 'UK', name: 'Ukrainian' },
    { code: 'VI', name: 'Vietnamese' },
    { code: 'ZH-HANS', name: 'Chinese (Simplified)' },
    { code: 'ZH-HANT', name: 'Chinese (Traditional)' }
  ];

  const FONT_SIZE_OPTIONS = [
    { value: 'small', label: 'S', cssValue: '0.95rem' },
    { value: 'medium', label: 'M', cssValue: '1.15rem' },
    { value: 'large', label: 'L', cssValue: '1.35rem' },
    { value: 'xlarge', label: 'XL', cssValue: '1.6rem' }
  ];

  const LANGUAGE_CODE_MAP = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'english': 'en',
    'ar': 'ar',
    'arabic': 'ar',
    'cs': 'cs',
    'czech': 'cs',
    'da': 'da',
    'danish': 'da',
    'de': 'de',
    'german': 'de',
    'el': 'el',
    'greek': 'el',
    'es': 'es',
    'spanish': 'es',
    'fi': 'fi',
    'finnish': 'fi',
    'fr': 'fr',
    'french': 'fr',
    'hi': 'hi',
    'hindi': 'hi',
    'hu': 'hu',
    'hungarian': 'hu',
    'id': 'id',
    'indonesian': 'id',
    'it': 'it',
    'italian': 'it',
    'ja': 'ja',
    'japanese': 'ja',
    'ko': 'ko',
    'korean': 'ko',
    'nl': 'nl',
    'dutch': 'nl',
    'no': 'no',
    'nb': 'no',
    'norwegian': 'no',
    'pl': 'pl',
    'polish': 'pl',
    'pt': 'pt',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    'portuguese': 'pt',
    'ro': 'ro',
    'romanian': 'ro',
    'ru': 'ru',
    'russian': 'ru',
    'sv': 'sv',
    'swedish': 'sv',
    'tr': 'tr',
    'turkish': 'tr',
    'uk': 'uk',
    'ukrainian': 'uk',
    'vi': 'vi',
    'vietnamese': 'vi',
    'zh': 'zh',
    'zh-hans': 'zh',
    'zh-hant': 'zh',
    'chinese': 'zh'
  };

  const WIKTIONARY_LANGUAGE_MAP = {
    ar: 'en',
    cs: 'en',
    da: 'en',
    de: 'de',
    el: 'el',
    en: 'en',
    es: 'es',
    fi: 'fi',
    fr: 'fr',
    hi: 'en',
    hu: 'en',
    id: 'en',
    it: 'it',
    ja: 'ja',
    ko: 'ko',
    nl: 'nl',
    no: 'no',
    pl: 'pl',
    pt: 'pt',
    ro: 'en',
    ru: 'ru',
    sv: 'sv',
    tr: 'en',
    uk: 'uk',
    vi: 'vi',
    zh: 'zh'
  };

  function sleep(ms) {
    return new Promise((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }

  function normalizeLanguageCode(languageCode) {
    if (typeof languageCode !== 'string' || !languageCode.trim()) {
      return 'en';
    }

    const normalized = languageCode.trim().toLowerCase();
    if (LANGUAGE_CODE_MAP[normalized]) {
      return LANGUAGE_CODE_MAP[normalized];
    }

    const withoutRegion = normalized.split(/[-_]/)[0];
    if (LANGUAGE_CODE_MAP[withoutRegion]) {
      return LANGUAGE_CODE_MAP[withoutRegion];
    }

    return withoutRegion || 'en';
  }

  function getLanguageName(languageCode) {
    const normalized = normalizeLanguageCode(languageCode);
    const matched = TARGET_LANGUAGES.find((entry) => {
      return normalizeLanguageCode(entry.code) === normalized || entry.code.toLowerCase() === String(languageCode || '').toLowerCase();
    });
    return matched ? matched.name : normalized.toUpperCase();
  }

  function convertToGoogleLangCode(languageCode) {
    const mapping = {
      'EN-US': 'en',
      'EN-GB': 'en',
      'PT-BR': 'pt',
      'PT-PT': 'pt',
      'ZH-HANS': 'zh-CN',
      'ZH-HANT': 'zh-TW'
    };

    const normalized = String(languageCode || '').toUpperCase();
    if (mapping[normalized]) {
      return mapping[normalized];
    }

    return normalizeLanguageCode(languageCode);
  }

  function normalizeCueText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toTranslationKey(title, targetLanguage, text) {
    return [
      normalizeLanguageCode(targetLanguage),
      normalizeCueText(text)
    ].join('::');
  }

  function normalizeWord(word) {
    return String(word || '')
      .trim()
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  }

  function tokenizeSubtitleText(text) {
    const tokens = [];
    const expression = /([\p{L}\p{N}][\p{L}\p{N}'’-]*)|([^\p{L}\p{N}]+)/gu;
    let match;

    while ((match = expression.exec(String(text || ''))) !== null) {
      if (match[1]) {
        tokens.push({ type: 'word', value: match[1] });
      } else if (match[2]) {
        tokens.push({ type: 'separator', value: match[2] });
      }
    }

    return tokens;
  }

  function getWiktionaryLanguage(languageCode) {
    const normalized = normalizeLanguageCode(languageCode);
    return WIKTIONARY_LANGUAGE_MAP[normalized] || 'en';
  }

  function getProvider(providerId) {
    return PROVIDERS.find((provider) => provider.id === providerId) || PROVIDERS[0];
  }

  function getFontSizeOption(value) {
    return FONT_SIZE_OPTIONS.find((entry) => entry.value === value) || FONT_SIZE_OPTIONS[1];
  }

  utils.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  utils.PROVIDERS = PROVIDERS;
  utils.GEMINI_MODELS = GEMINI_MODELS;
  utils.TARGET_LANGUAGES = TARGET_LANGUAGES;
  utils.FONT_SIZE_OPTIONS = FONT_SIZE_OPTIONS;
  utils.sleep = sleep;
  utils.normalizeLanguageCode = normalizeLanguageCode;
  utils.getLanguageName = getLanguageName;
  utils.convertToGoogleLangCode = convertToGoogleLangCode;
  utils.normalizeCueText = normalizeCueText;
  utils.toTranslationKey = toTranslationKey;
  utils.normalizeWord = normalizeWord;
  utils.tokenizeSubtitleText = tokenizeSubtitleText;
  utils.getWiktionaryLanguage = getWiktionaryLanguage;
  utils.getProvider = getProvider;
  utils.getFontSizeOption = getFontSizeOption;
})();
