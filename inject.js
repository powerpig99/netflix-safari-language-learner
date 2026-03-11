(() => {
  if (globalThis !== globalThis.top) {
    return;
  }

  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const extensionApi = app.extensionApi;
  let injected = false;

  function createNonce() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    return `nll-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }

  app.injectPageScript = function injectPageScript(path = 'platform/netflix-injected.js') {
    if (injected) {
      return;
    }

    const scriptId = 'nll-netflix-injected-script';
    if (document.getElementById(scriptId)) {
      injected = true;
      return;
    }

    const script = document.createElement('script');
    const nonce = createNonce();
    script.id = scriptId;
    script.src = extensionApi.runtime.getURL(path);
    script.dataset.nllNonce = nonce;
    script.async = false;
    script.onload = () => {
      document.documentElement.removeAttribute('data-nll-page-script-nonce');
      script.remove();
    };
    app.pageScriptNonce = nonce;
    document.documentElement.setAttribute('data-nll-page-script-nonce', nonce);
    (document.head || document.documentElement).appendChild(script);
    injected = true;
  };

  app.injectPageScript();
})();
