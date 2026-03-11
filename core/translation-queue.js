(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const languageUtils = app.languageUtils;
  const extensionApi = app.extensionApi;

  function traceTranslation(stage, detail) {
    if (globalThis.__NLL_TRACE_TRANSLATION__ === false) {
      return;
    }

    extensionApi && extensionApi.debugLog && extensionApi.debugLog.record('translation', stage, detail);
    console.debug('[NLL translation]', stage, detail);
  }

  function createTranslationQueue({ settingsStore, databaseClient, translationApi }) {
    const listeners = new Set();
    const entries = new Map();
    const pending = new Map();
    let isFlushing = false;
    let lastTargetLanguage = settingsStore.get().targetLanguage;

    function getEntry(key) {
      return entries.get(key) || null;
    }

    function emit(changedKeys = []) {
      listeners.forEach((listener) => {
        listener({
          changedKeys,
          entries
        });
      });
    }

    function setEntry(key, patch) {
      const current = entries.get(key) || { key, status: 'idle', text: null, error: null, updatedAt: 0 };
      const nextEntry = {
        ...current,
        ...patch,
        updatedAt: Date.now()
      };
      entries.set(key, nextEntry);
      traceTranslation('queue:set-entry', {
        key,
        previousStatus: current.status,
        status: nextEntry.status,
        hasText: Boolean(nextEntry.text),
        error: nextEntry.error || null
      });
    }

    function clear() {
      entries.clear();
      pending.clear();
      traceTranslation('queue:clear', {
        targetLanguage: lastTargetLanguage
      });
      emit();
    }

    function buildRequest(title, cue, sourceLanguage, targetLanguage) {
      const text = languageUtils.normalizeCueText(cue && cue.text);
      if (!text) {
        return null;
      }

      return {
        title: languageUtils.normalizeCueText(title),
        text,
        sourceLanguage: languageUtils.normalizeLanguageCode(sourceLanguage || 'en'),
        targetLanguage: String(targetLanguage || '').toUpperCase(),
        key: languageUtils.toTranslationKey(title, targetLanguage, text)
      };
    }

    function nextBatch() {
      if (pending.size === 0) {
        return [];
      }

      const groups = new Map();
      pending.forEach((request) => {
        const batchKey = [
          request.title,
          request.sourceLanguage,
          request.targetLanguage
        ].join('::');

        if (!groups.has(batchKey)) {
          groups.set(batchKey, []);
        }

        const group = groups.get(batchKey);
        if (group.length < 6) {
          group.push(request);
        }
      });

      return groups.values().next().value || [];
    }

    async function flush() {
      if (isFlushing) {
        return;
      }

      const batch = nextBatch();
      if (batch.length === 0) {
        return;
      }

      batch.forEach((request) => {
        pending.delete(request.key);
      });

      isFlushing = true;
      traceTranslation('queue:flush-start', {
        keys: batch.map((request) => request.key),
        targetLanguage: batch[0]?.targetLanguage || null,
        texts: batch.map((request) => request.text)
      });

      try {
        const result = await translationApi.fetchBatchTranslation(
          batch.map((request) => request.text),
          batch[0].targetLanguage
        );

        if (!Array.isArray(result) || result[0] !== true) {
          const errorMessage = Array.isArray(result) ? result[1] : 'Translation failed';
          batch.forEach((request) => {
            setEntry(request.key, {
              status: 'error',
              error: String(errorMessage || 'Translation failed')
            });
          });
          traceTranslation('queue:flush-error-result', {
            keys: batch.map((request) => request.key),
            error: String(errorMessage || 'Translation failed')
          });
          emit(batch.map((request) => request.key));
          return;
        }

        const translatedLines = Array.isArray(result[1]) ? result[1] : [];
        const recordsToSave = [];

        batch.forEach((request, index) => {
          const translatedText = languageUtils.normalizeCueText(translatedLines[index]);
          if (!translatedText) {
            setEntry(request.key, {
              status: 'error',
              error: 'Empty translation response'
            });
            return;
          }

          setEntry(request.key, {
            status: 'success',
            text: translatedText,
            error: null
          });

          recordsToSave.push({
            title: request.title,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            originalText: request.text,
            translatedText
          });
        });

        if (recordsToSave.length > 0) {
          await databaseClient.saveSubtitleTranslations(recordsToSave);
        }

        emit(batch.map((request) => request.key));
        traceTranslation('queue:flush-success', {
          keys: batch.map((request) => request.key),
          translatedCount: recordsToSave.length
        });
      } catch (error) {
        batch.forEach((request) => {
          setEntry(request.key, {
            status: 'error',
            error: error.message || String(error)
          });
        });
        traceTranslation('queue:flush-exception', {
          keys: batch.map((request) => request.key),
          error: error?.message || String(error)
        });
        emit(batch.map((request) => request.key));
      } finally {
        isFlushing = false;
        if (pending.size > 0) {
          flush();
        }
      }
    }

    async function prefetch({ title, cues, sourceLanguage }) {
      const settings = settingsStore.get();
      if (!settingsStore.shouldTranslate(sourceLanguage) || !Array.isArray(cues) || cues.length === 0) {
        return;
      }

      const changedKeys = [];
      const targetLanguage = settings.targetLanguage;

      for (const cue of cues) {
        const request = buildRequest(title, cue, sourceLanguage, targetLanguage);
        if (!request) {
          continue;
        }

        traceTranslation('queue:prefetch-cue', {
          key: request.key,
          title: request.title,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          text: request.text
        });

        const existing = entries.get(request.key);
        if (existing && (existing.status === 'success' || existing.status === 'pending')) {
          traceTranslation('queue:prefetch-skip-existing', {
            key: request.key,
            status: existing.status
          });
          continue;
        }

        const cached = await databaseClient.getSubtitleTranslation(
          request.title,
          request.sourceLanguage,
          request.targetLanguage,
          request.text
        );

        if (cached && cached.translatedText) {
          traceTranslation('queue:prefetch-cache-hit', {
            key: request.key,
            cachedTitle: cached.title || null
          });
          setEntry(request.key, {
            status: 'success',
            text: cached.translatedText,
            error: null
          });
          changedKeys.push(request.key);
          continue;
        }

        traceTranslation('queue:prefetch-cache-miss', {
          key: request.key
        });
        pending.set(request.key, request);
        setEntry(request.key, {
          status: 'pending',
          text: null,
          error: null
        });
        changedKeys.push(request.key);
      }

      if (changedKeys.length > 0) {
        emit(changedKeys);
      }

      flush();
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    settingsStore.subscribe((settings) => {
      if (settings.targetLanguage !== lastTargetLanguage || !settings.extensionEnabled) {
        lastTargetLanguage = settings.targetLanguage;
        clear();
      }
    });

    return {
      getEntry,
      subscribe,
      clear,
      prefetch
    };
  }

  core.createTranslationQueue = createTranslationQueue;
})();
