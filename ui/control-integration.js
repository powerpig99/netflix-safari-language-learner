(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const ui = app.ui = app.ui || {};
  const domUtils = app.domUtils;

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
    }

    function render() {
      ensureMounted();
      const subtitleState = subtitleStore.getState();
      panel.update({
        settings: settingsStore.get(),
        availability: subtitleState.featureAvailability,
        platformError: subtitleState.platformError
      });
    }

    const unsubscribeSettings = settingsStore.subscribe(render);
    const unsubscribeStore = subtitleStore.subscribe(render);

    return {
      syncMount: ensureMounted,
      destroy() {
        unsubscribeSettings();
        unsubscribeStore();
        panel.element.remove();
      }
    };
  }

  ui.createControlIntegration = createControlIntegration;
})();
