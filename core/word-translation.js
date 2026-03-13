(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const languageUtils = app.languageUtils;
  const domUtils = app.domUtils;

  function createWordTranslationController({ settingsStore, databaseClient, translationApi }) {
    const memoryCache = new Map();
    let activeTooltip = null;
    let activeAnchor = null;

    function signalCursorActivity(source = 'word-tooltip') {
      globalThis.dispatchEvent(new CustomEvent('nll:cursor-activity', {
        detail: { source }
      }));
    }

    function restorePlaybackFocus() {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }

      const focusTarget = document.querySelector(
        '[data-uia="watch-video"], [data-uia="player"], .watch-video, .NFPlayer, video'
      );

      if (!(focusTarget instanceof HTMLElement)) {
        return;
      }

      const removeTabIndex = !focusTarget.hasAttribute('tabindex');
      if (removeTabIndex) {
        focusTarget.setAttribute('tabindex', '-1');
      }

      focusTarget.focus({ preventScroll: true });

      if (removeTabIndex) {
        globalThis.setTimeout(() => {
          focusTarget.removeAttribute('tabindex');
        }, 0);
      }
    }

    function hideTooltip() {
      if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
      }
      if (activeAnchor) {
        activeAnchor.classList.remove('nll-word--active');
        activeAnchor = null;
      }
      restorePlaybackFocus();
    }

    async function resolveWordTranslation(word, context, sourceLanguage) {
      const settings = settingsStore.get();
      const targetLanguage = settings.targetLanguage;
      const cacheKey = [
        languageUtils.normalizeWord(word),
        languageUtils.normalizeLanguageCode(sourceLanguage || 'en'),
        String(targetLanguage || '').toUpperCase()
      ].join('::');

      if (memoryCache.has(cacheKey)) {
        return memoryCache.get(cacheKey);
      }

      const cached = await databaseClient.getWordTranslation(word, sourceLanguage || 'en', targetLanguage);
      if (cached && cached.translation) {
        const result = { translation: cached.translation, source: cached.source || 'cache' };
        memoryCache.set(cacheKey, result);
        return result;
      }

      const response = await translationApi.translateWordWithContext(word, context, targetLanguage, sourceLanguage);
      if (!Array.isArray(response) || response[0] !== true) {
        const errorMessage = Array.isArray(response) ? response[1] : 'Word translation failed';
        throw new Error(String(errorMessage || 'Word translation failed'));
      }

      const translation = languageUtils.normalizeCueText(response[1]);
      const result = {
        translation,
        source: 'provider'
      };

      memoryCache.set(cacheKey, result);
      await databaseClient.saveWordTranslation(word, sourceLanguage || 'en', targetLanguage, translation, result.source);
      return result;
    }

    function buildContextText(context) {
      if (!context) {
        return '';
      }

      if (typeof context === 'string') {
        return context;
      }

      const parts = [];
      if (Array.isArray(context.before) && context.before.length) {
        parts.push(`Before: ${context.before.join(' / ')}`);
      }
      if (context.current) {
        parts.push(`Current: ${context.current}`);
      }
      if (Array.isArray(context.after) && context.after.length) {
        parts.push(`After: ${context.after.join(' / ')}`);
      }
      return parts.join(' | ');
    }

    async function showTooltip(anchor, word, context, sourceLanguage) {
      hideTooltip();

      const tooltip = document.createElement('div');
      tooltip.className = 'nll-word-tooltip';

      const wordLabel = document.createElement('div');
      wordLabel.className = 'nll-word-tooltip__word';
      wordLabel.textContent = word;

      const translationLabel = document.createElement('div');
      translationLabel.className = 'nll-word-tooltip__translation nll-word-tooltip__translation--loading';
      translationLabel.textContent = 'Looking up...';

      const sourceLabel = document.createElement('div');
      sourceLabel.className = 'nll-word-tooltip__source';

      const link = document.createElement('a');
      link.className = 'nll-word-tooltip__link';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.href = `https://${languageUtils.getWiktionaryLanguage(settingsStore.get().targetLanguage)}.wiktionary.org/wiki/${encodeURIComponent(languageUtils.normalizeWord(word))}`;
      link.textContent = 'Open in Wiktionary';

      tooltip.append(wordLabel, translationLabel, sourceLabel, link);
      domUtils.getFullscreenRoot().appendChild(tooltip);
      domUtils.positionFloatingElement(anchor, tooltip);

      activeTooltip = tooltip;
      activeAnchor = anchor;
      activeAnchor.classList.add('nll-word--active');

      const stopTooltipEvent = (event) => {
        event.stopPropagation();
      };
      const stopTooltipPointerEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      tooltip.addEventListener('pointerdown', stopTooltipPointerEvent, true);
      tooltip.addEventListener('mousedown', stopTooltipPointerEvent, true);
      tooltip.addEventListener('mouseup', stopTooltipEvent, true);
      tooltip.addEventListener('click', stopTooltipEvent, true);
      tooltip.addEventListener('mouseenter', () => {
        signalCursorActivity();
      });
      tooltip.addEventListener('mousemove', () => {
        signalCursorActivity();
      }, { passive: true });
      link.addEventListener('pointerdown', stopTooltipPointerEvent, true);
      link.addEventListener('mousedown', stopTooltipPointerEvent, true);
      link.addEventListener('click', (event) => {
        event.stopPropagation();
        globalThis.setTimeout(() => {
          hideTooltip();
        }, 0);
      }, true);
      restorePlaybackFocus();

      try {
        const result = await resolveWordTranslation(word, buildContextText(context), sourceLanguage);
        if (activeTooltip !== tooltip) {
          return;
        }

        translationLabel.classList.remove('nll-word-tooltip__translation--loading');
        translationLabel.textContent = result.translation || 'No translation found';
        sourceLabel.textContent = result.source === 'cache' ? 'Cached result' : 'Translated by current provider';
      } catch (error) {
        if (activeTooltip !== tooltip) {
          return;
        }

        translationLabel.classList.remove('nll-word-tooltip__translation--loading');
        translationLabel.textContent = error.message || 'Lookup failed';
        sourceLabel.textContent = 'Translation error';
      }
    }

    function createInteractiveText(text, options = {}) {
      const container = document.createElement('span');
      container.className = 'nll-clickable-text';
      const context = options.context || { current: text, before: [], after: [] };
      const sourceLanguage = options.sourceLanguage || 'en';

      languageUtils.tokenizeSubtitleText(text).forEach((token) => {
        if (token.type === 'separator') {
          token.value.split('\n').forEach((part, index, parts) => {
            if (part) {
              container.appendChild(document.createTextNode(part));
            }
            if (index < parts.length - 1) {
              container.appendChild(document.createElement('br'));
            }
          });
          return;
        }

        const wordButton = document.createElement('button');
        wordButton.type = 'button';
        wordButton.className = 'nll-word';
        wordButton.textContent = token.value;
        wordButton.addEventListener('pointerdown', (event) => {
          event.preventDefault();
        });
        wordButton.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        wordButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          showTooltip(wordButton, token.value, context, sourceLanguage);
        });

        container.appendChild(wordButton);
      });

      return container;
    }

    document.addEventListener('click', (event) => {
      if (!activeTooltip) {
        return;
      }

      const target = event.target;
      if (activeTooltip.contains(target) || (activeAnchor && activeAnchor.contains(target))) {
        return;
      }

      hideTooltip();
    }, true);

    return {
      createInteractiveText,
      hideTooltip
    };
  }

  core.createWordTranslationController = createWordTranslationController;
})();
