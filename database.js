(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const languageUtils = app.languageUtils;

  const DATABASE_NAME = 'NetflixLanguageLearnerCache';
  const DATABASE_VERSION = 2;
  const SUBTITLE_STORE = 'subtitleTranslations';
  const WORD_STORE = 'wordTranslations';
  const TITLE_STORE = 'titleMetadata';
  const DATABASE_OPEN_TIMEOUT_MS = 1500;

  function logDatabase(stage, detail) {
    if (app.extensionApi && app.extensionApi.debugLog) {
      app.extensionApi.debugLog.record('runtime', `database:${stage}`, detail);
    }
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);

      promise.then((value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      }).catch((error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let settled = false;

      function settle(reducer) {
        if (settled) {
          return;
        }

        settled = true;
        reducer();
      }

      request.onerror = () => {
        settle(() => {
          reject(request.error);
        });
      };

      request.onsuccess = () => {
        settle(() => {
          resolve(request.result);
        });
      };

      request.onblocked = () => {
        settle(() => {
          reject(new Error('IndexedDB open blocked'));
        });
      };

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(SUBTITLE_STORE)) {
          const subtitleStore = database.createObjectStore(SUBTITLE_STORE, {
            keyPath: ['title', 'sourceLanguage', 'targetLanguage', 'originalText']
          });
          subtitleStore.createIndex('byTitleAndLanguage', ['title', 'sourceLanguage', 'targetLanguage'], { unique: false });
        }

        if (!database.objectStoreNames.contains(WORD_STORE)) {
          const wordStore = database.createObjectStore(WORD_STORE, {
            keyPath: ['word', 'sourceLanguage', 'targetLanguage']
          });
          wordStore.createIndex('byTargetLanguage', ['targetLanguage'], { unique: false });
        }

        if (!database.objectStoreNames.contains(TITLE_STORE)) {
          database.createObjectStore(TITLE_STORE, {
            keyPath: 'title'
          });
        }
      };
    });
  }

  function waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  }

  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getSubtitleTranslation(database, title, sourceLanguage, targetLanguage, originalText) {
    const transaction = database.transaction([SUBTITLE_STORE], 'readonly');
    const store = transaction.objectStore(SUBTITLE_STORE);
    const normalizedTitle = languageUtils.normalizeCueText(title);
    const normalizedSourceLanguage = languageUtils.normalizeLanguageCode(sourceLanguage);
    const normalizedTargetLanguage = String(targetLanguage || '').toUpperCase();
    const normalizedOriginalText = languageUtils.normalizeCueText(originalText);

    const record = await promisifyRequest(store.get([
      normalizedTitle,
      normalizedSourceLanguage,
      normalizedTargetLanguage,
      normalizedOriginalText
    ]));

    if (record) {
      await waitForTransaction(transaction);
      return record;
    }

    await waitForTransaction(transaction);
    return null;
  }

  async function getSubtitleTranslationsByTitle(database, title, sourceLanguage, targetLanguage) {
    const transaction = database.transaction([SUBTITLE_STORE], 'readonly');
    const store = transaction.objectStore(SUBTITLE_STORE);
    const index = store.index('byTitleAndLanguage');
    const records = await promisifyRequest(index.getAll([
      languageUtils.normalizeCueText(title),
      languageUtils.normalizeLanguageCode(sourceLanguage),
      String(targetLanguage || '').toUpperCase()
    ]));
    await waitForTransaction(transaction);
    return Array.isArray(records) ? records : [];
  }

  async function saveSubtitleTranslations(database, records) {
    if (!Array.isArray(records) || records.length === 0) {
      return 0;
    }

    const transaction = database.transaction([SUBTITLE_STORE], 'readwrite');
    const store = transaction.objectStore(SUBTITLE_STORE);

    records.forEach((record) => {
      store.put({
        title: languageUtils.normalizeCueText(record.title),
        sourceLanguage: languageUtils.normalizeLanguageCode(record.sourceLanguage),
        targetLanguage: String(record.targetLanguage || '').toUpperCase(),
        originalText: languageUtils.normalizeCueText(record.originalText),
        translatedText: String(record.translatedText || '').trim(),
        updatedAt: Date.now()
      });
    });

    await waitForTransaction(transaction);
    return records.length;
  }

  async function clearSubtitleTranslations(database, title = null) {
    const transaction = database.transaction([SUBTITLE_STORE], 'readwrite');
    const store = transaction.objectStore(SUBTITLE_STORE);

    if (!title) {
      const count = await promisifyRequest(store.count());
      store.clear();
      await waitForTransaction(transaction);
      return count;
    }

    const normalizedTitle = languageUtils.normalizeCueText(title);
    const range = IDBKeyRange.bound(
      [normalizedTitle, '', '', ''],
      [normalizedTitle, '\uffff', '\uffff', '\uffff']
    );
    const count = await deleteByCursor(store, range);
    await waitForTransaction(transaction);
    return count;
  }

  async function deleteSubtitleTranslation(database, title, sourceLanguage, targetLanguage, originalText) {
    const transaction = database.transaction([SUBTITLE_STORE], 'readwrite');
    const store = transaction.objectStore(SUBTITLE_STORE);

    store.delete([
      languageUtils.normalizeCueText(title),
      languageUtils.normalizeLanguageCode(sourceLanguage),
      String(targetLanguage || '').toUpperCase(),
      languageUtils.normalizeCueText(originalText)
    ]);

    await waitForTransaction(transaction);
    return 1;
  }

  async function getWordTranslation(database, word, sourceLanguage, targetLanguage) {
    const transaction = database.transaction([WORD_STORE], 'readonly');
    const store = transaction.objectStore(WORD_STORE);
    const record = await promisifyRequest(store.get([
      languageUtils.normalizeWord(word),
      languageUtils.normalizeLanguageCode(sourceLanguage),
      String(targetLanguage || '').toUpperCase()
    ]));
    await waitForTransaction(transaction);
    return record || null;
  }

  async function saveWordTranslation(database, word, sourceLanguage, targetLanguage, translation, source = 'provider') {
    const transaction = database.transaction([WORD_STORE], 'readwrite');
    const store = transaction.objectStore(WORD_STORE);

    store.put({
      word: languageUtils.normalizeWord(word),
      sourceLanguage: languageUtils.normalizeLanguageCode(sourceLanguage),
      targetLanguage: String(targetLanguage || '').toUpperCase(),
      translation: String(translation || '').trim(),
      source,
      updatedAt: Date.now()
    });

    await waitForTransaction(transaction);
  }

  async function clearWordTranslations(database) {
    const transaction = database.transaction([WORD_STORE], 'readwrite');
    const store = transaction.objectStore(WORD_STORE);
    const count = await promisifyRequest(store.count());
    store.clear();
    await waitForTransaction(transaction);
    return count;
  }

  async function countSubtitleTranslations(database) {
    const transaction = database.transaction([SUBTITLE_STORE], 'readonly');
    const count = await promisifyRequest(transaction.objectStore(SUBTITLE_STORE).count());
    await waitForTransaction(transaction);
    return count;
  }

  async function countWordTranslations(database) {
    const transaction = database.transaction([WORD_STORE], 'readonly');
    const count = await promisifyRequest(transaction.objectStore(WORD_STORE).count());
    await waitForTransaction(transaction);
    return count;
  }

  async function upsertTitleMetadata(database, title, patch = {}) {
    const transaction = database.transaction([TITLE_STORE], 'readwrite');
    const store = transaction.objectStore(TITLE_STORE);
    const existing = await promisifyRequest(store.get(languageUtils.normalizeCueText(title))) || {};

    store.put({
      title: languageUtils.normalizeCueText(title),
      updatedAt: Date.now(),
      ...existing,
      ...patch
    });

    await waitForTransaction(transaction);
  }

  async function deleteByCursor(store, range) {
    return new Promise((resolve, reject) => {
      let count = 0;
      const request = store.openCursor(range);

      request.onerror = () => {
        reject(request.error);
      };

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(count);
          return;
        }

        cursor.delete();
        count += 1;
        cursor.continue();
      };
    });
  }

  function createClient() {
    let databasePromise = null;
    let databaseDisabled = false;
    let databaseDisableReason = null;

    function disableDatabase(error) {
      databaseDisabled = true;
      databaseDisableReason = error ? (error.message || String(error)) : 'IndexedDB unavailable';
      databasePromise = null;
      logDatabase('disabled', {
        error: databaseDisableReason
      });
    }

    async function getDatabase() {
      if (databaseDisabled) {
        throw new Error(databaseDisableReason || 'IndexedDB unavailable');
      }

      if (!databasePromise) {
        databasePromise = withTimeout(openDatabase(), DATABASE_OPEN_TIMEOUT_MS, 'IndexedDB open').catch((error) => {
          logDatabase('open-error', {
            error: error?.message || String(error)
          });
          disableDatabase(error);
          throw error;
        });
      }
      return databasePromise;
    }

    async function withDatabase(run, fallbackValue) {
      try {
        const database = await getDatabase();
        return await run(database);
      } catch (_error) {
        return fallbackValue;
      }
    }

    return {
      open: getDatabase,
      async getSubtitleTranslation(title, sourceLanguage, targetLanguage, originalText) {
        return withDatabase((database) => {
          return getSubtitleTranslation(database, title, sourceLanguage, targetLanguage, originalText);
        }, null);
      },
      async getSubtitleTranslationsByTitle(title, sourceLanguage, targetLanguage) {
        return withDatabase((database) => {
          return getSubtitleTranslationsByTitle(database, title, sourceLanguage, targetLanguage);
        }, []);
      },
      async saveSubtitleTranslations(records) {
        return withDatabase((database) => {
          return saveSubtitleTranslations(database, records);
        }, 0);
      },
      async clearSubtitleTranslations(title) {
        return withDatabase((database) => {
          return clearSubtitleTranslations(database, title);
        }, 0);
      },
      async deleteSubtitleTranslation(title, sourceLanguage, targetLanguage, originalText) {
        return withDatabase((database) => {
          return deleteSubtitleTranslation(database, title, sourceLanguage, targetLanguage, originalText);
        }, 0);
      },
      async countSubtitleTranslations() {
        return withDatabase((database) => {
          return countSubtitleTranslations(database);
        }, 0);
      },
      async getWordTranslation(word, sourceLanguage, targetLanguage) {
        return withDatabase((database) => {
          return getWordTranslation(database, word, sourceLanguage, targetLanguage);
        }, null);
      },
      async saveWordTranslation(word, sourceLanguage, targetLanguage, translation, source) {
        return withDatabase((database) => {
          return saveWordTranslation(database, word, sourceLanguage, targetLanguage, translation, source);
        }, undefined);
      },
      async clearWordTranslations() {
        return withDatabase((database) => {
          return clearWordTranslations(database);
        }, 0);
      },
      async countWordTranslations() {
        return withDatabase((database) => {
          return countWordTranslations(database);
        }, 0);
      },
      async upsertTitleMetadata(title, patch) {
        return withDatabase((database) => {
          return upsertTitleMetadata(database, title, patch);
        }, undefined);
      }
    };
  }

  app.database = {
    createClient,
    openDatabase
  };
})();
