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
    let flushQueued = false;
    let generation = 0;
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
      generation += 1;
      entries.clear();
      pending.clear();
      traceTranslation('queue:clear', {
        targetLanguage: lastTargetLanguage,
        generation
      });
      emit();
    }

    function queueFlush() {
      if (flushQueued) {
        return;
      }

      flushQueued = true;
      Promise.resolve().then(() => {
        flushQueued = false;
        return flush();
      }).catch((error) => {
        traceTranslation('queue:flush-unhandled', {
          error: error?.message || String(error)
        });
      });
    }

    function isStaleRequestGeneration(requestGeneration, targetLanguage) {
      return requestGeneration !== generation
        || targetLanguage !== lastTargetLanguage
        || !settingsStore.get().extensionEnabled;
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
        key: languageUtils.toTranslationKey(title, targetLanguage, text),
        generation
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
        texts: batch.map((request) => request.text),
        generation: batch[0]?.generation ?? null
      });

      try {
        const result = await translationApi.fetchBatchTranslation(
          batch.map((request) => request.text),
          batch[0].targetLanguage
        );

        if (isStaleRequestGeneration(batch[0]?.generation, batch[0]?.targetLanguage)) {
          traceTranslation('queue:flush-discard-stale', {
            keys: batch.map((request) => request.key),
            batchGeneration: batch[0]?.generation ?? null,
            generation
          });
          return;
        }

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

        if (isStaleRequestGeneration(batch[0]?.generation, batch[0]?.targetLanguage)) {
          traceTranslation('queue:flush-discard-after-save', {
            keys: batch.map((request) => request.key),
            batchGeneration: batch[0]?.generation ?? null,
            generation
          });
          return;
        }

        emit(batch.map((request) => request.key));
        traceTranslation('queue:flush-success', {
          keys: batch.map((request) => request.key),
          translatedCount: recordsToSave.length
        });
      } catch (error) {
        if (isStaleRequestGeneration(batch[0]?.generation, batch[0]?.targetLanguage)) {
          traceTranslation('queue:flush-discard-error-stale', {
            keys: batch.map((request) => request.key),
            batchGeneration: batch[0]?.generation ?? null,
            generation
          });
          return;
        }

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
          queueFlush();
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
      const requestGeneration = generation;

      for (const cue of cues) {
        if (isStaleRequestGeneration(requestGeneration, targetLanguage)) {
          traceTranslation('queue:prefetch-abort-stale', {
            targetLanguage,
            requestGeneration,
            generation
          });
          return;
        }

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

        if (isStaleRequestGeneration(requestGeneration, targetLanguage)) {
          traceTranslation('queue:prefetch-abort-after-cache-stale', {
            key: request.key,
            targetLanguage,
            requestGeneration,
            generation
          });
          return;
        }

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

      queueFlush();
    }

    async function retry({ title, cue, sourceLanguage }) {
      const settings = settingsStore.get();
      if (!settingsStore.shouldTranslate(sourceLanguage)) {
        return false;
      }

      const request = buildRequest(title, cue, sourceLanguage, settings.targetLanguage);
      if (!request) {
        return false;
      }

      const requestGeneration = generation;

      traceTranslation('queue:retry', {
        key: request.key,
        title: request.title,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        text: request.text
      });

      await databaseClient.deleteSubtitleTranslation(
        request.title,
        request.sourceLanguage,
        request.targetLanguage,
        request.text
      );

      if (isStaleRequestGeneration(requestGeneration, request.targetLanguage)) {
        traceTranslation('queue:retry-abort-stale', {
          key: request.key,
          targetLanguage: request.targetLanguage,
          requestGeneration,
          generation
        });
        return false;
      }

      pending.delete(request.key);
      entries.delete(request.key);
      pending.set(request.key, request);
      setEntry(request.key, {
        status: 'pending',
        text: null,
        error: null
      });
      emit([request.key]);
      queueFlush();
      return true;
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
      prefetch,
      retry
    };
  }

  core.createTranslationQueue = createTranslationQueue;
})();
