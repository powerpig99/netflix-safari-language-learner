(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const ui = app.ui = app.ui || {};
  const domUtils = app.domUtils;
  const HOT_ZONE_TOP_PX = 72;
  const HOT_ZONE_BOTTOM_PX = 120;
  const CURSOR_HIDE_DELAY_MS = 120;

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
    let cleanupVisibilityListeners = null;
    const rootCursorClass = 'nll-root-cursor-hidden';

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

    function syncUi(reason) {
      const shouldShowControls = Boolean((controlsVisible || panelHovered) && visibilityEnabled);
      const shouldShowCursor = Boolean(cursorVisible && visibilityEnabled);
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

    function setCursorVisible(isVisible, { reason = null } = {}) {
      cursorVisible = Boolean(isVisible);
      clearCursorTimer();
      syncUi(reason || (cursorVisible ? 'cursor-visible' : 'cursor-hidden'));

      if (cursorVisible) {
        cursorTimer = globalThis.setTimeout(() => {
          cursorVisible = false;
          syncUi('cursor-timer-hide');
          cursorTimer = null;
        }, CURSOR_HIDE_DELAY_MS);
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

      const topThreshold = rect.top + Math.min(HOT_ZONE_TOP_PX, rect.height * 0.16);
      const bottomThreshold = rect.bottom - Math.min(HOT_ZONE_BOTTOM_PX, rect.height * 0.22);
      return clientY <= topThreshold || clientY >= bottomThreshold;
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
          clearCursorTimer();
          syncUi('mousemove-disabled');
          return;
        }

        const inHotZone = isInHotZone(event.clientX, event.clientY);
        if (panelHovered) {
          controlsVisible = true;
          setCursorVisible(true, { reason: 'mousemove-panel-hover' });
          return;
        }

        controlsVisible = inHotZone;
        setCursorVisible(true, {
          reason: inHotZone ? 'mousemove-hotzone' : 'mousemove-nonhotzone'
        });
      }

      function handlePointerLeave() {
        clearCursorTimer();
        controlsVisible = false;
        cursorVisible = false;
        syncUi('mouseleave');
      }

      function handlePanelEnter() {
        panelHovered = true;
        controlsVisible = true;
        if (visibilityEnabled) {
          syncUi('panel-enter');
        }
      }

      function handlePanelLeave(event) {
        panelHovered = false;
        if (!event || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') {
          controlsVisible = false;
          syncUi('panel-leave-no-pointer');
          return;
        }

        const inHotZone = isInHotZone(event.clientX, event.clientY);
        controlsVisible = inHotZone;
        syncUi(inHotZone ? 'panel-leave-hotzone' : 'panel-leave-nonhotzone');
      }

      visibilityTarget.addEventListener('mousemove', handlePointerMove, { passive: true });
      visibilityTarget.addEventListener('mouseleave', handlePointerLeave, { passive: true });
      panel.element.addEventListener('mouseenter', handlePanelEnter, { passive: true });
      panel.element.addEventListener('mouseleave', handlePanelLeave, { passive: true });
      controlsVisible = false;
      cursorVisible = false;
      syncUi('install');

      return () => {
        clearCursorTimer();
        visibilityTarget.removeEventListener('mousemove', handlePointerMove);
        visibilityTarget.removeEventListener('mouseleave', handlePointerLeave);
        panel.element.removeEventListener('mouseenter', handlePanelEnter);
        panel.element.removeEventListener('mouseleave', handlePanelLeave);
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

    function ensureMounted() {
      const nextMountTarget = adapter.getMountTarget() || document.body;
      if (!nextMountTarget) {
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
      cleanupVisibilityListeners = installVisibilityListeners();
    }

    function render() {
      ensureMounted();
      const subtitleState = subtitleStore.getState();
      const settings = settingsStore.get();
      visibilityEnabled = Boolean(settings.extensionEnabled);
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
        if (cleanupVisibilityListeners) {
          cleanupVisibilityListeners();
          cleanupVisibilityListeners = null;
        }
        panel.element.remove();
      }
    };
  }

  ui.createControlIntegration = createControlIntegration;
})();
