(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const extensionApi = app.extensionApi;
  const languageUtils = app.languageUtils;

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  function traceTranslation(stage, detail) {
    if (globalThis.__NLL_TRACE_TRANSLATION__ === false) {
      return;
    }

    extensionApi && extensionApi.debugLog && extensionApi.debugLog.record('translation', stage, detail);
    console.debug('[NLL translation]', stage, detail);
  }

  function isRecoverableError(message) {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('message channel closed') ||
      normalized.includes('receiving end does not exist') ||
      normalized.includes('extension context invalidated');
  }

  async function sendMessageWithRetry(action, data) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        traceTranslation('api:send-message', {
          action,
          attempt: attempt + 1,
          data
        });
        const result = await extensionApi.runtime.sendMessage({ action, data });
        traceTranslation('api:send-message-result', {
          action,
          attempt: attempt + 1,
          result
        });
        return result;
      } catch (error) {
        traceTranslation('api:send-message-error', {
          action,
          attempt: attempt + 1,
          error: error?.message || String(error)
        });
        if (attempt < MAX_RETRIES - 1 && isRecoverableError(error.message || String(error))) {
          await languageUtils.sleep(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to send ${action}`);
  }

  function createTranslationApi() {
    return {
      async fetchBatchTranslation(texts, targetLanguage) {
        return sendMessageWithRetry('fetchBatchTranslation', {
          texts,
          targetLanguage,
          isContextual: true
        });
      },
      async translateWordWithContext(word, context, targetLanguage, sourceLanguage) {
        return sendMessageWithRetry('translateWordWithContext', {
          word,
          context,
          targetLanguage,
          sourceLanguage
        });
      }
    };
  }

  core.createTranslationApi = createTranslationApi;
})();
