(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const browserApi = typeof globalThis.browser !== 'undefined' ? globalThis.browser : null;
  const chromeApi = typeof globalThis.chrome !== 'undefined' ? globalThis.chrome : null;
  const rawApi = browserApi || chromeApi || null;
  const DEBUG_LOG_LIMIT = 2000;
  const debugEntries = [];

  function unsupported(methodName) {
    return Promise.reject(new Error(`Extension API unavailable: ${methodName}`));
  }

  function lastRuntimeError() {
    if (!chromeApi || !chromeApi.runtime || !chromeApi.runtime.lastError) {
      return null;
    }

    const { lastError } = chromeApi.runtime;
    if (!lastError) {
      return null;
    }

    return new Error(lastError.message || String(lastError));
  }

  function callbackToPromise(invoker) {
    return new Promise((resolve, reject) => {
      invoker((result) => {
        const error = lastRuntimeError();
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  function cloneDebugDetail(detail) {
    if (typeof detail === 'undefined') {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(detail));
    } catch (_error) {
      return {
        value: String(detail)
      };
    }
  }

  function recordDebugEntry(channel, stage, detail) {
    debugEntries.push({
      ts: new Date().toISOString(),
      channel: String(channel || 'general'),
      stage: String(stage || 'event'),
      detail: cloneDebugDetail(detail)
    });

    if (debugEntries.length > DEBUG_LOG_LIMIT) {
      debugEntries.splice(0, debugEntries.length - DEBUG_LOG_LIMIT);
    }
  }

  function getStorageArea(areaName) {
    const storage = rawApi && rawApi.storage ? rawApi.storage[areaName] : null;
    return storage || null;
  }

  async function storageGet(keys, areaName = 'sync') {
    const area = getStorageArea(areaName);
    if (!area || typeof area.get !== 'function') {
      return unsupported(`storage.${areaName}.get`);
    }

    if (browserApi) {
      return area.get(keys);
    }

    return callbackToPromise((done) => {
      area.get(keys, done);
    });
  }

  async function storageSet(values, areaName = 'sync') {
    const area = getStorageArea(areaName);
    if (!area || typeof area.set !== 'function') {
      return unsupported(`storage.${areaName}.set`);
    }

    if (browserApi) {
      return area.set(values);
    }

    return callbackToPromise((done) => {
      area.set(values, done);
    });
  }

  async function storageRemove(keys, areaName = 'sync') {
    const area = getStorageArea(areaName);
    if (!area || typeof area.remove !== 'function') {
      return unsupported(`storage.${areaName}.remove`);
    }

    if (browserApi) {
      return area.remove(keys);
    }

    return callbackToPromise((done) => {
      area.remove(keys, done);
    });
  }

  async function sendMessage(message) {
    const runtime = rawApi && rawApi.runtime;
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      return unsupported('runtime.sendMessage');
    }

    if (browserApi) {
      return runtime.sendMessage(message);
    }

    return callbackToPromise((done) => {
      runtime.sendMessage(message, done);
    });
  }

  async function openOptionsPage() {
    const runtime = rawApi && rawApi.runtime;
    if (!runtime || typeof runtime.openOptionsPage !== 'function') {
      return unsupported('runtime.openOptionsPage');
    }

    if (browserApi) {
      return runtime.openOptionsPage();
    }

    return callbackToPromise((done) => {
      runtime.openOptionsPage(done);
    });
  }

  function getUrl(path) {
    const runtime = rawApi && rawApi.runtime;
    if (!runtime || typeof runtime.getURL !== 'function') {
      return '';
    }

    return runtime.getURL(path);
  }

  function addStorageChangeListener(listener) {
    const storage = rawApi && rawApi.storage;
    if (!storage || !storage.onChanged || typeof storage.onChanged.addListener !== 'function') {
      return () => {};
    }

    const wrapped = (changes, areaName) => {
      listener(changes, areaName);
    };

    storage.onChanged.addListener(wrapped);
    return () => {
      if (typeof storage.onChanged.removeListener === 'function') {
        storage.onChanged.removeListener(wrapped);
      }
    };
  }

  function addMessageListener(listener) {
    const runtime = rawApi && rawApi.runtime;
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') {
      return () => {};
    }

    if (browserApi) {
      runtime.onMessage.addListener(listener);
      return () => {
        if (typeof runtime.onMessage.removeListener === 'function') {
          runtime.onMessage.removeListener(listener);
        }
      };
    }

    const wrapped = (message, sender, sendResponse) => {
      try {
        const result = listener(message, sender);
        if (result && typeof result.then === 'function') {
          result.then(sendResponse).catch((error) => {
            sendResponse({ success: false, error: error.message || String(error) });
          });
          return true;
        }
        if (typeof result !== 'undefined') {
          sendResponse(result);
          return true;
        }
        return false;
      } catch (error) {
        sendResponse({ success: false, error: error.message || String(error) });
        return true;
      }
    };

    runtime.onMessage.addListener(wrapped);
    return () => {
      if (typeof runtime.onMessage.removeListener === 'function') {
        runtime.onMessage.removeListener(wrapped);
      }
    };
  }

  app.extensionApi = {
    raw: rawApi,
    debugLog: {
      record(channel, stage, detail) {
        recordDebugEntry(channel, stage, detail);
      },
      list(channel = null) {
        if (!channel) {
          return debugEntries.slice();
        }

        return debugEntries.filter((entry) => entry.channel === channel);
      },
      clear(channel = null) {
        if (!channel) {
          debugEntries.length = 0;
          return;
        }

        let index = debugEntries.length;
        while (index > 0) {
          index -= 1;
          if (debugEntries[index].channel === channel) {
            debugEntries.splice(index, 1);
          }
        }
      }
    },
    storage: {
      get: storageGet,
      set: storageSet,
      remove: storageRemove,
      addChangeListener: addStorageChangeListener
    },
    runtime: {
      sendMessage,
      openOptionsPage,
      addMessageListener: addMessageListener,
      getURL: getUrl
    }
  };
})();
