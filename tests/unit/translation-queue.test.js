const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loadQueueHarness({
  databaseClientOverrides = {},
  translationApiOverrides = {}
} = {}) {
  const settingsListeners = new Set();
  let settings = {
    targetLanguage: 'EN-US',
    extensionEnabled: true
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    NetflixLanguageLearner: {
      core: {},
      extensionApi: {
        debugLog: {
          record() {}
        }
      }
    }
  };
  context.globalThis = context;

  const languageUtilsPath = path.resolve(__dirname, '../../utils/language-utils.js');
  const queuePath = path.resolve(__dirname, '../../core/translation-queue.js');
  const languageUtilsSource = fs.readFileSync(languageUtilsPath, 'utf8');
  const queueSource = fs.readFileSync(queuePath, 'utf8');

  vm.createContext(context);
  vm.runInContext(languageUtilsSource, context, { filename: 'language-utils.js' });
  vm.runInContext(queueSource, context, { filename: 'translation-queue.js' });

  const settingsStore = {
    get() {
      return { ...settings };
    },
    subscribe(listener) {
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    },
    shouldTranslate() {
      return true;
    }
  };

  const databaseClient = {
    async getSubtitleTranslation() {
      return null;
    },
    async saveSubtitleTranslations() {
      return 0;
    },
    async deleteSubtitleTranslation() {
      return 1;
    },
    ...databaseClientOverrides
  };

  const translationApi = {
    async fetchBatchTranslation(texts) {
      return [true, texts];
    },
    ...translationApiOverrides
  };

  const queue = context.NetflixLanguageLearner.core.createTranslationQueue({
    settingsStore,
    databaseClient,
    translationApi
  });

  function updateSettings(patch) {
    settings = {
      ...settings,
      ...patch
    };
    settingsListeners.forEach((listener) => listener({ ...settings }));
  }

  return {
    queue,
    languageUtils: context.NetflixLanguageLearner.languageUtils,
    updateSettings
  };
}

describe('translation queue generation guards', () => {
  test('prefetch abandons stale cache work after target language changes', async () => {
    const deferred = createDeferred();
    let translationCalls = 0;
    const harness = loadQueueHarness({
      databaseClientOverrides: {
        async getSubtitleTranslation() {
          return deferred.promise;
        }
      },
      translationApiOverrides: {
        async fetchBatchTranslation() {
          translationCalls += 1;
          return [true, ['Hello']];
        }
      }
    });

    const prefetchPromise = harness.queue.prefetch({
      title: 'Show A',
      cues: [{ startTime: 1, endTime: 2, text: 'Moi' }],
      sourceLanguage: 'fi'
    });

    harness.updateSettings({ targetLanguage: 'FR' });
    deferred.resolve(null);
    await prefetchPromise;
    await Promise.resolve();
    await Promise.resolve();

    const staleKey = harness.languageUtils.toTranslationKey('Show A', 'EN-US', 'Moi');
    assert.equal(harness.queue.getEntry(staleKey), null);
    assert.equal(translationCalls, 0);
  });

  test('flush discards stale batch results after queue generation changes', async () => {
    const deferred = createDeferred();
    let translationCalls = 0;
    const harness = loadQueueHarness({
      translationApiOverrides: {
        async fetchBatchTranslation() {
          translationCalls += 1;
          return deferred.promise;
        }
      }
    });

    await harness.queue.prefetch({
      title: 'Show A',
      cues: [{ startTime: 1, endTime: 2, text: 'Moi' }],
      sourceLanguage: 'fi'
    });

    harness.updateSettings({ targetLanguage: 'FR' });
    deferred.resolve([true, ['Hello']]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const staleKey = harness.languageUtils.toTranslationKey('Show A', 'EN-US', 'Moi');
    assert.equal(harness.queue.getEntry(staleKey), null);
    assert.equal(translationCalls, 1);
  });
});
