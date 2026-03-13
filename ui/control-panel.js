(() => {
  const app = globalThis.NetflixLanguageLearner = globalThis.NetflixLanguageLearner || {};
  const ui = app.ui = app.ui || {};
  const languageUtils = app.languageUtils;

  function createButton(icon, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nll-control-btn';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function updateToggleState(button, enabled) {
    button.setAttribute('aria-pressed', String(Boolean(enabled)));
    button.classList.toggle('is-active', Boolean(enabled));
  }

  function createControlPanel({ onAction }) {
    const icons = ui.controlIcons;
    const element = document.createElement('div');
    element.className = 'nll-control-panel';
    const status = document.createElement('div');
    status.className = 'nll-control-status';

    const buttons = {
      power: createButton(icons.power, 'Toggle extension', 'toggleExtension'),
      dual: createButton(icons.dual, 'Toggle dual subtitles', 'toggleDualSub'),
      previous: createButton(icons.previous, 'Previous subtitle', 'previousSubtitle'),
      repeat: createButton(icons.repeat, 'Repeat subtitle', 'repeatSubtitle'),
      next: createButton(icons.next, 'Next subtitle', 'nextSubtitle'),
      autoPause: createButton(icons.pause, 'Toggle auto-pause', 'toggleAutoPause'),
      settings: createButton(icons.settings, 'Open settings', 'openSettings')
    };

    const speedSelect = document.createElement('select');
    speedSelect.className = 'nll-control-speed';
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach((speed) => {
      const option = document.createElement('option');
      option.value = String(speed);
      option.textContent = `${speed}x`;
      speedSelect.appendChild(option);
    });

    Object.values(buttons).forEach((button) => {
      button.addEventListener('click', () => {
        onAction(button.dataset.action);
      });
      element.appendChild(button);
    });

    speedSelect.addEventListener('change', () => {
      onAction('setPlaybackSpeed', Number(speedSelect.value));
    });
    element.insertBefore(speedSelect, buttons.autoPause);
    element.appendChild(status);

    function update({ settings, availability, platformError }) {
      updateToggleState(buttons.power, settings.extensionEnabled);
      updateToggleState(buttons.dual, settings.dualSubEnabled);
      updateToggleState(buttons.autoPause, settings.autoPauseEnabled);

      buttons.dual.disabled = !settings.extensionEnabled || !availability.dualSubs;
      buttons.previous.disabled = !settings.extensionEnabled || !availability.subtitleNavigation;
      buttons.repeat.disabled = !settings.extensionEnabled || !availability.repeat;
      buttons.next.disabled = !settings.extensionEnabled || !availability.subtitleNavigation;
      buttons.autoPause.disabled = !settings.extensionEnabled || !availability.autoPause;
      speedSelect.disabled = !settings.extensionEnabled || !availability.playbackSpeed;
      speedSelect.value = String(settings.playbackSpeed);

      status.hidden = !platformError;
      status.textContent = platformError || '';
    }

    return {
      element,
      setVisible(isVisible) {
        element.classList.toggle('is-visible', Boolean(isVisible));
      },
      update
    };
  }

  ui.createControlPanel = createControlPanel;
})();
