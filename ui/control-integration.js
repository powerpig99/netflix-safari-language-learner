(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const ui = app.ui = app.ui || {};
  const domUtils = app.domUtils;
  const extensionApi = app.extensionApi;
  const HOT_ZONE_TOP_PX = 44;
  const HOT_ZONE_BOTTOM_PX = 48;
  const CURSOR_HIDE_DELAY_MS = 900;
  const PANEL_LEAVE_HIDE_DELAY_MS = 2000;
  const TOOLTIP_CURSOR_EVENT = 'nll:cursor-activity';
  const CONTROL_REGION_SELECTORS = [
    '.watch-video--back-container',
    '.watch-video--flag-container',
    '.watch-video--bottom-controls-container',
    '[data-uia="controls-standard"]',
    '[data-uia="timeline"]',
    '[data-uia="video-title"]',
    '[data-uia="controls-time-remaining"]',
    '[data-uia^="control-"]'
  ].join(', ');
  const INTERACTIVE_CONTROL_SELECTORS = [
    'button',
    '[role="button"]',
    'a',
    'summary'
  ].join(', ');

  function logControls(stage, detail) {
    if (extensionApi && extensionApi.debugLog) {
      extensionApi.debugLog.record('controls', stage, detail);
    }
  }

  function createControlIntegration({ adapter, settingsStore, subtitleStore, controlActions }) {
    const panel = ui.createControlPanel({
      onAction(action, value) {
        switch (action) {
          case 'toggleExtension':
            controlActions.toggleExtension();
            break;
          case 'toggleDualSub':
            controlActions.toggleDualSub();
            break;
          case 'previousSubtitle':
            controlActions.previousSubtitle();
            break;
          case 'repeatSubtitle':
            controlActions.repeatSubtitle();
            break;
          case 'nextSubtitle':
            controlActions.nextSubtitle();
            break;
          case 'toggleAutoPause':
            controlActions.toggleAutoPause();
            break;
          case 'setPlaybackSpeed':
            controlActions.setPlaybackSpeed(value);
            break;
          case 'openSettings':
            controlActions.openSettings();
            break;
          default:
            break;
        }
      }
    });

    let mountTarget = null;
    let visibilityEnabled = true;
    let panelHovered = false;
    let controlsVisible = false;
    let cursorVisible = false;
    let cursorTimer = null;
    let lastPointerPosition = null;
    let cleanupVisibilityListeners = null;
    let cleanupPlaybackControlListeners = null;
    const rootCursorClass = 'nll-root-cursor-hidden';
    const keyboard = app.core && typeof app.core.createControlKeyboard === 'function'
      ? app.core.createControlKeyboard({
          callbacks: {
            onDualSubToggle() {
              if (isFeatureAvailable('dualSubs')) {
                controlActions.toggleDualSub();
              }
            },
            onPrevSubtitle() {
              if (isFeatureAvailable('subtitleNavigation')) {
                controlActions.previousSubtitle();
              }
            },
            onNextSubtitle() {
              if (isFeatureAvailable('subtitleNavigation')) {
                controlActions.nextSubtitle();
              }
            },
            onRepeatSubtitle() {
              if (isFeatureAvailable('repeat')) {
                controlActions.repeatSubtitle();
              }
            },
            onRetrySubtitleTranslation() {
              if (isFeatureAvailable('dualSubs')) {
                controlActions.retrySubtitleTranslation();
              }
            },
            onAutoPauseToggle() {
              if (isFeatureAvailable('autoPause')) {
                controlActions.toggleAutoPause();
              }
            },
            onSpeedChange(delta) {
              if (isFeatureAvailable('playbackSpeed')) {
                controlActions.changePlaybackSpeed(delta);
              }
            },
            onPlayPause() {
              if (shouldInterceptPlaybackControls()) {
                logControls('input:keyboard-playback-toggle', {
                  source: 'keyboard'
                });
                controlActions.togglePlayPause();
              }
            }
          },
          config: {
            interceptSpace: true
          }
        })
      : null;

    function getAvailability() {
      return subtitleStore.getState().featureAvailability || {};
    }

    function isPlaybackContextActive() {
      if (!settingsStore.get().extensionEnabled) {
        return false;
      }

      if (typeof adapter.isWatchPlaybackActive === 'function') {
        return Boolean(adapter.isWatchPlaybackActive());
      }

      return false;
    }

    function shouldInterceptPlaybackControls() {
      return isPlaybackContextActive();
    }

    function isFeatureAvailable(featureKey) {
      if (!isPlaybackContextActive()) {
        return false;
      }

      return Boolean(getAvailability()[featureKey]);
    }

    function syncDebugState(reason) {
      if (!mountTarget) {
        return;
      }

      mountTarget.dataset.nllVisibilityReason = String(reason || '');
      mountTarget.dataset.nllCursorVisible = cursorVisible ? '1' : '0';
      mountTarget.dataset.nllPanelHovered = panelHovered ? '1' : '0';
      mountTarget.dataset.nllVisibilityEnabled = visibilityEnabled ? '1' : '0';
    }

    function getPlayerRect() {
      if (mountTarget && typeof mountTarget.getBoundingClientRect === 'function') {
        const rect = mountTarget.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return rect;
        }
      }

      const video = adapter.getVideo();
      if (video && typeof video.getBoundingClientRect === 'function') {
        return video.getBoundingClientRect();
      }

      return null;
    }

    function isVisibleControlNode(node) {
      if (!(node instanceof Element)) {
        return false;
      }

      const style = globalThis.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) < 0.05) {
        return false;
      }

      const rect = node.getBoundingClientRect();
      return rect.width > 4 && rect.height > 4;
    }

    function isWithinVisibleControlRegion(clientX, clientY) {
      if (!mountTarget || typeof mountTarget.querySelectorAll !== 'function') {
        return false;
      }

      if (typeof document.elementsFromPoint === 'function') {
        const pointStack = document.elementsFromPoint(clientX, clientY);
        for (const node of pointStack) {
          if (!(node instanceof Element)) {
            continue;
          }

          if (!mountTarget.contains(node)) {
            continue;
          }

          if (node.closest('.nll-control-panel, .nll-overlay, .nll-word-tooltip')) {
            continue;
          }

          const interactiveNode = node.closest(INTERACTIVE_CONTROL_SELECTORS);
          if (!interactiveNode || !mountTarget.contains(interactiveNode)) {
            continue;
          }

          if (isVisibleControlNode(interactiveNode)) {
            return true;
          }
        }
      }

      return Array.from(mountTarget.querySelectorAll(CONTROL_REGION_SELECTORS)).some((node) => {
        if (!isVisibleControlNode(node)) {
          return false;
        }

        if (node.closest('.nll-control-panel, .nll-overlay, .nll-word-tooltip')) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        return clientX >= rect.left
          && clientX <= rect.right
          && clientY >= rect.top
          && clientY <= rect.bottom;
      });
    }

    function syncUi(reason) {
      const shouldShowControls = Boolean(visibilityEnabled && (panelHovered || (controlsVisible && cursorVisible)));
      const shouldShowCursor = Boolean(visibilityEnabled && (panelHovered || cursorVisible));
      panel.setVisible(shouldShowControls);

      document.documentElement.classList.toggle(rootCursorClass, visibilityEnabled && !shouldShowCursor);
      if (document.body) {
        document.body.classList.toggle(rootCursorClass, visibilityEnabled && !shouldShowCursor);
      }

      if (mountTarget) {
        mountTarget.classList.toggle('nll-managed-visibility', visibilityEnabled);
        mountTarget.classList.toggle('nll-controls-visible', shouldShowControls);
        mountTarget.classList.toggle('nll-controls-hidden', !shouldShowControls && visibilityEnabled);
        mountTarget.classList.toggle('nll-cursor-visible', shouldShowCursor);
        if (!visibilityEnabled) {
          mountTarget.classList.remove('nll-managed-visibility', 'nll-controls-visible', 'nll-controls-hidden', 'nll-cursor-visible');
        }
      }

      syncDebugState(reason || (shouldShowControls ? 'controls-visible' : 'controls-hidden'));
    }

    function clearCursorTimer() {
      if (cursorTimer) {
        globalThis.clearTimeout(cursorTimer);
        cursorTimer = null;
      }
    }

    function getKeepVisibleRegion(pointer) {
      if (!pointer || typeof pointer.clientX !== 'number' || typeof pointer.clientY !== 'number') {
        return null;
      }

      if (isWithinPanelRegion(pointer.clientX, pointer.clientY)) {
        return 'panel';
      }

      if (isWithinVisibleControlRegion(pointer.clientX, pointer.clientY)) {
        return 'control-region';
      }

      if (isInHotZone(pointer.clientX, pointer.clientY)) {
        return 'hotzone';
      }

      return null;
    }

    function setCursorVisible(isVisible, { reason = null, delayMs = CURSOR_HIDE_DELAY_MS } = {}) {
      cursorVisible = Boolean(isVisible);
      clearCursorTimer();
      syncUi(reason || (cursorVisible ? 'cursor-visible' : 'cursor-hidden'));
      logControls('cursor:set-visible', {
        visible: cursorVisible,
        reason: reason || null,
        delayMs,
        panelHovered,
        controlsVisible
      });

      if (cursorVisible) {
        cursorTimer = globalThis.setTimeout(() => {
          const keepRegion = visibilityEnabled ? getKeepVisibleRegion(lastPointerPosition) : null;
          if (keepRegion) {
            panelHovered = keepRegion === 'panel';
            controlsVisible = true;
            cursorVisible = true;
            logControls('cursor:timer-keep-region', {
              keepRegion,
              pointer: lastPointerPosition
            });
            syncUi(`cursor-timer-keep-${keepRegion}`);
            cursorTimer = null;
            setCursorVisible(true, {
              reason: `cursor-timer-keep-${keepRegion}`,
              delayMs
            });
            return;
          }

          cursorVisible = false;
          controlsVisible = false;
          panelHovered = false;
          logControls('cursor:timer-hide', {
            panelHovered,
            controlsVisible
          });
          syncUi('cursor-timer-hide');
          cursorTimer = null;
        }, Math.max(0, Number(delayMs) || 0));
      }
    }

    function isInHotZone(clientX, clientY) {
      const rect = getPlayerRect();
      if (!rect) {
        return false;
      }

      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return false;
      }

      const topThreshold = rect.top + Math.min(HOT_ZONE_TOP_PX, rect.height * 0.08);
      const bottomThreshold = rect.bottom - Math.min(HOT_ZONE_BOTTOM_PX, rect.height * 0.08);
      return clientY <= topThreshold || clientY >= bottomThreshold;
    }

    function isWithinPanelRegion(clientX, clientY) {
      if (!(panel.element instanceof Element)) {
        return false;
      }

      if (!panel.element.classList.contains('is-visible')) {
        return false;
      }

      const rect = panel.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      return clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;
    }

    function installVisibilityListeners() {
      if (!mountTarget) {
        return () => {};
      }

      const visibilityTarget = mountTarget;

      function handlePointerMove(event) {
        if (!visibilityEnabled) {
          controlsVisible = false;
          cursorVisible = false;
          lastPointerPosition = null;
          clearCursorTimer();
          syncUi('mousemove-disabled');
          return;
        }

        lastPointerPosition = {
          clientX: event.clientX,
          clientY: event.clientY
        };
        const wasPanelHovered = panelHovered;
        const inPanelRegion = isWithinPanelRegion(event.clientX, event.clientY);
        panelHovered = inPanelRegion;
        if (inPanelRegion) {
          controlsVisible = true;
          setCursorVisible(true, { reason: 'mousemove-panel-hover' });
          return;
        }

        if (wasPanelHovered) {
          controlsVisible = true;
          setCursorVisible(true, {
            reason: 'panel-leave-delay',
            delayMs: PANEL_LEAVE_HIDE_DELAY_MS
          });
          return;
        }

        const inHotZone = isInHotZone(event.clientX, event.clientY);
        const inControlRegion = isWithinVisibleControlRegion(event.clientX, event.clientY);
        controlsVisible = inHotZone || inControlRegion;
        setCursorVisible(true, {
          reason: inHotZone
            ? 'mousemove-hotzone'
            : (inControlRegion ? 'mousemove-control-region' : 'mousemove-nonhotzone')
        });
      }

      function handlePointerLeave() {
        clearCursorTimer();
        controlsVisible = false;
        cursorVisible = false;
        panelHovered = false;
        lastPointerPosition = null;
        syncUi('mouseleave');
      }

      function handleTooltipCursorActivity(event) {
        if (!visibilityEnabled) {
          return;
        }

        const source = event?.detail?.source || 'interactive-overlay';
        controlsVisible = false;
        setCursorVisible(true, {
          reason: `${source}-mousemove`
        });
      }

      visibilityTarget.addEventListener('mousemove', handlePointerMove, { passive: true });
      visibilityTarget.addEventListener('mouseleave', handlePointerLeave, { passive: true });
      globalThis.addEventListener(TOOLTIP_CURSOR_EVENT, handleTooltipCursorActivity);
      controlsVisible = false;
      cursorVisible = false;
      panelHovered = false;
      syncUi('install');

      return () => {
        clearCursorTimer();
        visibilityTarget.removeEventListener('mousemove', handlePointerMove);
        visibilityTarget.removeEventListener('mouseleave', handlePointerLeave);
        globalThis.removeEventListener(TOOLTIP_CURSOR_EVENT, handleTooltipCursorActivity);
        document.documentElement.classList.remove(rootCursorClass);
        if (document.body) {
          document.body.classList.remove(rootCursorClass);
        }
        visibilityTarget.classList.remove('nll-managed-visibility', 'nll-controls-visible', 'nll-controls-hidden', 'nll-cursor-visible');
        delete visibilityTarget.dataset.nllVisibilityReason;
        delete visibilityTarget.dataset.nllCursorVisible;
        delete visibilityTarget.dataset.nllPanelHovered;
        delete visibilityTarget.dataset.nllVisibilityEnabled;
      };
    }

    function isWithinManagedPlaybackSurface(clientX, clientY) {
      const rect = getPlayerRect();
      if (!rect) {
        return false;
      }

      return clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;
    }

    function isExtensionOwnedTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(target.closest('.nll-control-panel, .nll-overlay, .nll-word-tooltip'));
    }

    function isInteractiveTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(target.closest('a, button, input, select, textarea, summary, [role="button"], [contenteditable="true"]'));
    }

    function isBarePlaybackClick(event) {
      if (!event || event.button !== 0 || !mountTarget || !shouldInterceptPlaybackControls()) {
        return false;
      }

      if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') {
        return false;
      }

      if (!isWithinManagedPlaybackSurface(event.clientX, event.clientY)) {
        return false;
      }

      if (isWithinVisibleControlRegion(event.clientX, event.clientY)) {
        return false;
      }

      if (isExtensionOwnedTarget(event.target) || isInteractiveTarget(event.target)) {
        return false;
      }

      return true;
    }

    function installPlaybackControlListeners() {
      if (!mountTarget) {
        return () => {};
      }

      const listenerTarget = mountTarget;

      function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }

      function handlePointerDown(event) {
        if (!isBarePlaybackClick(event)) {
          return;
        }

        stopEvent(event);
      }

      function handleClick(event) {
        if (!isBarePlaybackClick(event)) {
          return;
        }

        stopEvent(event);
        logControls('input:bare-playback-click', {
          clientX: event.clientX,
          clientY: event.clientY
        });
        controlsVisible = false;
        panelHovered = false;
        syncUi('intercepted-playback-click');
        controlActions.togglePlayPause();
      }

      listenerTarget.addEventListener('pointerdown', handlePointerDown, true);
      listenerTarget.addEventListener('click', handleClick, true);

      return () => {
        listenerTarget.removeEventListener('pointerdown', handlePointerDown, true);
        listenerTarget.removeEventListener('click', handleClick, true);
      };
    }

    function attachPlaybackInterception() {
      if (keyboard) {
        keyboard.config.enabled = true;
        keyboard.attach();
      }

      if (!cleanupPlaybackControlListeners) {
        logControls('interception:attach', {
          mountTarget: Boolean(mountTarget)
        });
        cleanupPlaybackControlListeners = installPlaybackControlListeners();
      }
    }

    function detachPlaybackInterception() {
      if (cleanupPlaybackControlListeners || (keyboard && keyboard.config.enabled)) {
        logControls('interception:detach', {
          mountTarget: Boolean(mountTarget)
        });
      }
      if (cleanupPlaybackControlListeners) {
        cleanupPlaybackControlListeners();
        cleanupPlaybackControlListeners = null;
      }

      if (keyboard) {
        keyboard.config.enabled = false;
        keyboard.detach();
      }
    }

    function unmount() {
      if (cleanupVisibilityListeners) {
        cleanupVisibilityListeners();
        cleanupVisibilityListeners = null;
      }

      detachPlaybackInterception();
      clearCursorTimer();
      controlsVisible = false;
      cursorVisible = false;
      panelHovered = false;
      panel.element.remove();
      mountTarget = null;
    }

    function ensureMounted() {
      const nextMountTarget = isPlaybackContextActive()
        ? (adapter.getMountTarget() || document.body)
        : null;
      if (!nextMountTarget) {
        unmount();
        return;
      }

      if (mountTarget === nextMountTarget && panel.element.parentElement === nextMountTarget) {
        return;
      }

      mountTarget = nextMountTarget;
      domUtils.ensureRelativePosition(mountTarget);
      mountTarget.appendChild(panel.element);
      if (cleanupVisibilityListeners) {
        cleanupVisibilityListeners();
      }
      if (cleanupPlaybackControlListeners) {
        cleanupPlaybackControlListeners();
        cleanupPlaybackControlListeners = null;
      }
      cleanupVisibilityListeners = installVisibilityListeners();
    }

    function render() {
      visibilityEnabled = isPlaybackContextActive();
      ensureMounted();
      const subtitleState = subtitleStore.getState();
      const settings = settingsStore.get();
      if (visibilityEnabled) {
        attachPlaybackInterception();
      } else {
        detachPlaybackInterception();
      }
      panel.update({
        settings,
        availability: subtitleState.featureAvailability,
        platformError: subtitleState.platformError
      });
      if (!visibilityEnabled) {
        controlsVisible = false;
        cursorVisible = false;
        clearCursorTimer();
        syncUi('render-disabled');
      } else {
        syncUi('render');
      }
    }

    const unsubscribeSettings = settingsStore.subscribe(render);
    const unsubscribeStore = subtitleStore.subscribe(render);

    return {
      syncMount: ensureMounted,
      destroy() {
        unsubscribeSettings();
        unsubscribeStore();
        if (keyboard) {
          keyboard.detach();
        }
        unmount();
      }
    };
  }

  ui.createControlIntegration = createControlIntegration;
})();
