importScripts('utils/language-utils.js', 'utils/extension-api.js');

(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const extensionApi = app.extensionApi;
  const languageUtils = app.languageUtils;

  const DEFAULT_PROVIDER_STATE = {
    provider: languageUtils.DEFAULT_SETTINGS.translationProvider,
    apiKey: '',
    geminiModel: languageUtils.DEFAULT_SETTINGS.geminiModel,
    grokModel: languageUtils.DEFAULT_SETTINGS.grokModel
  };

  const KIMI_API_URL = 'https://api.kimi.com/coding/v1/messages';
  const KIMI_MODEL = 'kimi-coding/k2p5';

  let currentProvider = { ...DEFAULT_PROVIDER_STATE };

  async function loadProviderConfig() {
    const keys = [
      'translationProvider',
      'googleCloudApiKey',
      'deeplApiKey',
      'claudeApiKey',
      'geminiApiKey',
      'geminiModel',
      'grokApiKey',
      'grokModel',
      'kimiApiKey'
    ];

    try {
      const settings = await extensionApi.storage.get(keys);
      const providerId = typeof settings.translationProvider === 'string'
        ? settings.translationProvider
        : languageUtils.DEFAULT_SETTINGS.translationProvider;
      const provider = languageUtils.getProvider(providerId);

      currentProvider = {
        provider: provider.id,
        apiKey: provider.apiKeyField ? String(settings[provider.apiKeyField] || '') : '',
        geminiModel: String(settings.geminiModel || languageUtils.DEFAULT_SETTINGS.geminiModel),
        grokModel: String(settings.grokModel || languageUtils.DEFAULT_SETTINGS.grokModel)
      };
    } catch (error) {
      console.warn('NetflixLanguageLearner: Failed to load provider config:', error);
      currentProvider = { ...DEFAULT_PROVIDER_STATE };
    }
  }

  function isRetryableTranslationError(message) {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('rate limit') ||
      normalized.includes('503') ||
      normalized.includes('timeout') ||
      normalized.includes('failed to fetch');
  }

  function calculateBackoffDelay(attempt) {
    return (1000 * (2 ** attempt)) + Math.random() * 300;
  }

  async function translateTextsWithRetry(texts, targetLanguage) {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const result = await translateTexts(texts, targetLanguage);
      if (result[0]) {
        return result;
      }

      if (attempt < maxRetries - 1 && isRetryableTranslationError(result[1])) {
        await languageUtils.sleep(calculateBackoffDelay(attempt));
        continue;
      }

      return result;
    }

    return [false, 'Translation failed after retries'];
  }

  async function translateTexts(texts, targetLanguage) {
    switch (currentProvider.provider) {
      case 'google':
        return translateWithGoogle(texts, targetLanguage);
      case 'googleCloud':
        return translateWithGoogleCloud(texts, targetLanguage);
      case 'deepl':
        return translateWithDeepL(texts, targetLanguage);
      case 'claude':
        return translateWithClaude(texts, targetLanguage);
      case 'gemini':
        return translateWithGemini(texts, targetLanguage);
      case 'grok':
        return translateWithGrok(texts, targetLanguage);
      case 'kimi':
        return translateWithKimi(texts, targetLanguage);
      default:
        return translateWithGoogle(texts, targetLanguage);
    }
  }

  async function translateBatchWithContext(texts, targetLanguage, isContextual) {
    const provider = currentProvider.provider;
    const usesPromptedContext = provider === 'claude' || provider === 'gemini' || provider === 'grok' || provider === 'kimi';

    if (isContextual && usesPromptedContext) {
      return translateWithContextualAI(texts, targetLanguage, provider);
    }

    return translateTextsWithRetry(texts, targetLanguage);
  }

  function normalizeTranslatedLines(content, originals) {
    const lines = String(content || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, originals.length);

    while (lines.length < originals.length) {
      lines.push(null);
    }

    return lines;
  }

  function appendErrorDetail(baseMessage, detail) {
    if (!detail) {
      return baseMessage;
    }
    return `${baseMessage} - ${detail}`;
  }

  async function getResponseErrorDetail(response) {
    try {
      const text = await response.text();
      if (!text) {
        return '';
      }

      try {
        const data = JSON.parse(text);
        return String(data?.error?.message || data?.message || text).trim();
      } catch (_error) {
        return text.trim();
      }
    } catch (_error) {
      return '';
    }
  }

  async function requestAiProviderText(providerId, prompt, maxTokens) {
    if (providerId === 'kimi') {
      return requestKimiCompletion(prompt, maxTokens);
    }

    if (!currentProvider.apiKey) {
      return [false, `${providerId} API key not configured`];
    }

    try {
      let response;
      if (providerId === 'claude') {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': currentProvider.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
          })
        });
      } else if (providerId === 'gemini') {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentProvider.geminiModel}:generateContent?key=${currentProvider.apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: maxTokens
            }
          })
        });
      } else if (providerId === 'grok') {
        response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentProvider.apiKey}`
          },
          body: JSON.stringify({
            model: currentProvider.grokModel,
            temperature: 0.1,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
          })
        });
      } else {
        return [false, 'Unsupported AI provider'];
      }

      if (!response.ok) {
        const detail = await getResponseErrorDetail(response);
        return [false, appendErrorDetail(`${providerId} error: ${response.status}`, detail)];
      }

      const data = await response.json();
      if (providerId === 'claude') {
        return [true, data?.content?.[0]?.text || ''];
      }
      if (providerId === 'gemini') {
        return [true, data?.candidates?.[0]?.content?.parts?.[0]?.text || ''];
      }
      if (providerId === 'grok') {
        return [true, data?.choices?.[0]?.message?.content || ''];
      }

      return [false, 'Unsupported AI provider'];
    } catch (error) {
      return [false, `${providerId} translation failed: ${error.message || String(error)}`];
    }
  }

  async function translateWithContextualAI(texts, targetLanguage, providerId) {
    const languageName = languageUtils.getLanguageName(targetLanguage);
    const prompt = `You are a subtitle translator. Translate each subtitle line to ${languageName}.

Rules:
- Keep exactly one output line per input line.
- Output subtitle text only.
- Do not add numbering or explanations.
- Do not output language names or codes.
- Preserve tone and colloquial meaning.

${texts.join('\n')}`;

    const result = await requestAiProviderText(providerId, prompt, 4096);
    if (!result[0]) {
      return result;
    }

    return [true, normalizeTranslatedLines(result[1], texts)];
  }

  async function translateWordWithContext(word, context, targetLanguage, sourceLanguage = null) {
    const provider = currentProvider.provider;
    if (provider === 'google' || provider === 'googleCloud' || provider === 'deepl') {
      const result = await translateTexts([word], targetLanguage);
      if (result[0]) {
        return [true, result[1][0]];
      }
      return result;
    }

    const languageName = languageUtils.getLanguageName(targetLanguage);
    const sourceHint = sourceLanguage ? `Source language hint: ${sourceLanguage}.` : 'Auto-detect the source language.';
    const prompt = `Translate the word "${word}" to ${languageName}. Context: "${context}"
${sourceHint}
Return only the translation.`;

    return requestAiProviderText(provider, prompt, 128);
  }

  async function translateWithGoogle(texts, targetLanguage) {
    const googleLanguage = languageUtils.convertToGoogleLangCode(targetLanguage);
    const translations = [];

    try {
      for (let index = 0; index < texts.length; index += 1) {
        if (index > 0) {
          await languageUtils.sleep(150);
        }

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${googleLanguage}&dt=t&q=${encodeURIComponent(texts[index])}`;
        try {
          const controller = new AbortController();
          const timeoutId = globalThis.setTimeout(() => controller.abort(), 8000);
          const response = await fetch(url, { signal: controller.signal });
          globalThis.clearTimeout(timeoutId);

          if (!response.ok) {
            translations.push(null);
            continue;
          }

          const data = await response.json();
          const translated = Array.isArray(data?.[0])
            ? data[0].map((part) => part?.[0] || '').join('')
            : '';
          translations.push(translated || null);
        } catch (_error) {
          translations.push(null);
        }
      }

      return [true, translations];
    } catch (error) {
      return [false, `Google Translate failed: ${error.message || String(error)}`];
    }
  }

  async function translateWithGoogleCloud(texts, targetLanguage) {
    if (!currentProvider.apiKey) {
      return [false, 'Google Cloud API key not configured'];
    }

    try {
      const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${currentProvider.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: texts,
          target: languageUtils.convertToGoogleLangCode(targetLanguage),
          format: 'text'
        })
      });

      if (!response.ok) {
        return [false, appendErrorDetail(`Google Cloud error: ${response.status}`, await getResponseErrorDetail(response))];
      }

      const data = await response.json();
      const translations = Array.isArray(data?.data?.translations)
        ? data.data.translations.map((item) => item?.translatedText || null)
        : null;

      if (!translations) {
        return [false, 'Google Cloud returned a malformed response'];
      }

      return [true, translations];
    } catch (error) {
      return [false, `Google Cloud translation failed: ${error.message || String(error)}`];
    }
  }

  async function translateWithDeepL(texts, targetLanguage) {
    if (!currentProvider.apiKey) {
      return [false, 'DeepL API key not configured'];
    }

    try {
      const response = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeepL-Auth-Key ${currentProvider.apiKey}`
        },
        body: JSON.stringify({
          text: texts,
          target_lang: String(targetLanguage || '').toUpperCase()
        })
      });

      if (!response.ok) {
        return [false, appendErrorDetail(`DeepL error: ${response.status}`, await getResponseErrorDetail(response))];
      }

      const data = await response.json();
      return [true, Array.isArray(data?.translations) ? data.translations.map((item) => item?.text || null) : []];
    } catch (error) {
      return [false, `DeepL translation failed: ${error.message || String(error)}`];
    }
  }

  async function translateWithClaude(texts, targetLanguage) {
    const languageName = languageUtils.getLanguageName(targetLanguage);
    const prompt = `Translate the following subtitle lines to ${languageName}. Return only the translations, one line per input.

${texts.join('\n')}`;
    const result = await requestAiProviderText('claude', prompt, 1024);
    return result[0] ? [true, normalizeTranslatedLines(result[1], texts)] : result;
  }

  async function translateWithGemini(texts, targetLanguage) {
    const languageName = languageUtils.getLanguageName(targetLanguage);
    const prompt = `Translate the following subtitle lines to ${languageName}. Output translations only, one line per input.

${texts.join('\n')}`;
    const result = await requestAiProviderText('gemini', prompt, 1024);
    return result[0] ? [true, normalizeTranslatedLines(result[1], texts)] : result;
  }

  async function translateWithGrok(texts, targetLanguage) {
    const languageName = languageUtils.getLanguageName(targetLanguage);
    const prompt = `Translate the following subtitle lines to ${languageName}. Return subtitle text only.

${texts.join('\n')}`;
    const result = await requestAiProviderText('grok', prompt, 1024);
    return result[0] ? [true, normalizeTranslatedLines(result[1], texts)] : result;
  }

  async function requestKimiCompletion(prompt, maxTokens) {
    if (!currentProvider.apiKey) {
      return [false, 'Kimi API key not configured'];
    }

    try {
      const response = await fetch(KIMI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': currentProvider.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: KIMI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: maxTokens
        })
      });

      if (!response.ok) {
        return [false, appendErrorDetail(`Kimi error: ${response.status}`, await getResponseErrorDetail(response))];
      }

      const data = await response.json();
      if (Array.isArray(data?.content)) {
        return [true, data.content.map((block) => block?.text || '').join('')];
      }
      if (typeof data?.content === 'string') {
        return [true, data.content];
      }
      return [true, ''];
    } catch (error) {
      return [false, `Kimi translation failed: ${error.message || String(error)}`];
    }
  }

  async function translateWithKimi(texts, targetLanguage) {
    const languageName = languageUtils.getLanguageName(targetLanguage);
    const prompt = `Translate the following subtitle lines to ${languageName}. Return one translated line for each input line.

${texts.join('\n')}`;
    const result = await requestKimiCompletion(prompt, 1024);
    return result[0] ? [true, normalizeTranslatedLines(result[1], texts)] : result;
  }

  extensionApi.runtime.addMessageListener(async (request) => {
    if (!request || typeof request.action !== 'string') {
      return undefined;
    }

    if (request.action === 'fetchBatchTranslation') {
      const { texts, targetLanguage, isContextual } = request.data || {};
      return translateBatchWithContext(Array.isArray(texts) ? texts : [], targetLanguage, Boolean(isContextual));
    }

    if (request.action === 'translateWordWithContext') {
      const { word, context, targetLanguage, sourceLanguage } = request.data || {};
      return translateWordWithContext(word, context, targetLanguage, sourceLanguage);
    }

    if (request.action === 'openOptionsPage') {
      await extensionApi.runtime.openOptionsPage();
      return { success: true };
    }

    return undefined;
  });

  extensionApi.storage.addChangeListener((changes, areaName) => {
    if (areaName !== 'sync') {
      return;
    }

    const relevantKeys = [
      'translationProvider',
      'googleCloudApiKey',
      'deeplApiKey',
      'claudeApiKey',
      'geminiApiKey',
      'geminiModel',
      'grokApiKey',
      'grokModel',
      'kimiApiKey'
    ];

    if (relevantKeys.some((key) => key in changes)) {
      loadProviderConfig();
    }
  });

  loadProviderConfig();
})();
