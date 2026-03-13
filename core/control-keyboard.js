(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const core = app.core = app.core || {};
  const extensionApi = app.extensionApi;

  function shouldTraceKey(event) {
    return [' ', 'j', 'J', 'f', 'F', 'r', 'R'].includes(event?.key);
  }

  function logKeyboard(stage, detail) {
    if (extensionApi && extensionApi.debugLog) {
      extensionApi.debugLog.record('controls', stage, detail);
    }
  }

  class ControlKeyboard {
    constructor(options = {}) {
      this.callbacks = options.callbacks || {};
      this.config = Object.assign({
        useCapture: true,
        interceptSpace: false,
        interceptBrackets: true,
        enabled: true
      }, options.config || {});

      this._boundKeyDown = this._handleKeyDown.bind(this);
      this._boundKeyUp = this._handleKeyUp.bind(this);
      this._attached = false;

      this.keyBindings = {
        d: 'toggleDualSub',
        D: 'toggleDualSub',
        ',': 'previousSubtitle',
        '.': 'nextSubtitle',
        i: 'previousSubtitle',
        I: 'previousSubtitle',
        g: 'nextSubtitle',
        G: 'nextSubtitle',
        h: 'repeatSubtitle',
        H: 'repeatSubtitle',
        c: 'retrySubtitleTranslation',
        C: 'retrySubtitleTranslation',
        j: 'togglePlayPause',
        J: 'togglePlayPause',
        k: 'decreaseSpeed',
        K: 'decreaseSpeed',
        m: 'increaseSpeed',
        M: 'increaseSpeed',
        o: 'toggleAutoPause',
        O: 'toggleAutoPause',
        p: 'toggleAutoPause',
        P: 'toggleAutoPause',
        '[': 'decreaseSpeed',
        ']': 'increaseSpeed',
        ' ': 'togglePlayPause'
      };
    }

    attach() {
      if (this._attached) {
        return;
      }

      const useCapture = Boolean(this.config.useCapture);
      globalThis.addEventListener('keydown', this._boundKeyDown, useCapture);
      globalThis.addEventListener('keyup', this._boundKeyUp, useCapture);
      this._attached = true;
    }

    detach() {
      if (!this._attached) {
        return;
      }

      const useCapture = Boolean(this.config.useCapture);
      globalThis.removeEventListener('keydown', this._boundKeyDown, useCapture);
      globalThis.removeEventListener('keyup', this._boundKeyUp, useCapture);
      this._attached = false;
    }

    _isInputElement(event) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return false;
      }

      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
      }

      if (target.isContentEditable) {
        return true;
      }

      return target.closest('[contenteditable="true"]') !== null;
    }

    _getActionForEvent(event) {
      if (event.code === 'KeyR') {
        return event.shiftKey ? 'retrySubtitleTranslation' : 'repeatSubtitle';
      }

      return this.keyBindings[event.key] || null;
    }

    _shouldHandleKey(event) {
      const action = this._getActionForEvent(event);
      if (!action) {
        return false;
      }

      if (event.key === ' ' && !this.config.interceptSpace) {
        return false;
      }

      if ((event.key === '[' || event.key === ']') && !this.config.interceptBrackets) {
        return false;
      }

      return true;
    }

    _handleKeyDown(event) {
      if (!this.config.enabled) {
        return;
      }
      if (this._isInputElement(event)) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (!this._shouldHandleKey(event)) {
        if (shouldTraceKey(event)) {
          logKeyboard('keyboard:keydown-pass-through', {
            key: event.key,
            code: event.code,
            enabled: this.config.enabled
          });
        }
        return;
      }

      const allowsRepeat = event.key === '[' || event.key === ']';

      if (event.repeat && !allowsRepeat) {
        return;
      }

      logKeyboard('keyboard:keydown-intercept', {
        key: event.key,
        code: event.code,
        action: this._getActionForEvent(event)
      });

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      this._executeAction(this._getActionForEvent(event), event);
    }

    _handleKeyUp(event) {
      if (!this.config.enabled) {
        return;
      }
      if (this._isInputElement(event)) {
        return;
      }

      if (!this._shouldHandleKey(event)) {
        if (shouldTraceKey(event)) {
          logKeyboard('keyboard:keyup-pass-through', {
            key: event.key,
            code: event.code,
            enabled: this.config.enabled
          });
        }
        return;
      }

      logKeyboard('keyboard:keyup-intercept', {
        key: event.key,
        code: event.code,
        action: this._getActionForEvent(event)
      });

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    _executeAction(action) {
      switch (action) {
        case 'toggleDualSub':
          this.callbacks.onDualSubToggle && this.callbacks.onDualSubToggle();
          break;
        case 'previousSubtitle':
          this.callbacks.onPrevSubtitle && this.callbacks.onPrevSubtitle();
          break;
        case 'nextSubtitle':
          this.callbacks.onNextSubtitle && this.callbacks.onNextSubtitle();
          break;
        case 'repeatSubtitle':
          this.callbacks.onRepeatSubtitle && this.callbacks.onRepeatSubtitle();
          break;
        case 'retrySubtitleTranslation':
          this.callbacks.onRetrySubtitleTranslation && this.callbacks.onRetrySubtitleTranslation();
          break;
        case 'toggleAutoPause':
          this.callbacks.onAutoPauseToggle && this.callbacks.onAutoPauseToggle();
          break;
        case 'decreaseSpeed':
          this.callbacks.onSpeedChange && this.callbacks.onSpeedChange(-0.25);
          break;
        case 'increaseSpeed':
          this.callbacks.onSpeedChange && this.callbacks.onSpeedChange(0.25);
          break;
        case 'togglePlayPause':
          this.callbacks.onPlayPause && this.callbacks.onPlayPause();
          break;
        default:
          console.warn('NetflixLanguageLearner: Unknown keyboard action:', action);
      }
    }

    static getDefaultConfig() {
      return {
        useCapture: true,
        interceptSpace: false,
        interceptBrackets: true,
        enabled: true
      };
    }
  }

  core.ControlKeyboard = ControlKeyboard;
  core.createControlKeyboard = function createControlKeyboard(options) {
    return new ControlKeyboard(options);
  };
})();
