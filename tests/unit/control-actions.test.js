const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function loadCreateControlActions(runtimeOverrides = {}) {
  const context = {
    NetflixLanguageLearner: {
      core: {},
      extensionApi: {
        runtime: {
          sendMessage: () => Promise.resolve({ success: true }),
          openOptionsPage: () => Promise.resolve(),
          getURL: () => '',
          ...runtimeOverrides
        }
      }
    },
    document: {
      querySelector: () => null
    },
    console
  };
  context.globalThis = context;

  const scriptPath = path.resolve(__dirname, '../../core/control-actions.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'control-actions.js' });
  return context.NetflixLanguageLearner.core.createControlActions;
}

function createHarness({ paused, autoPaused, runtimeOverrides = {}, adapterOverrides = {} }) {
  const createControlActions = loadCreateControlActions(runtimeOverrides);
  const video = {
    paused,
    playbackRate: 1,
    currentTime: 1.95,
    playCalls: 0,
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
    pauseCalls: 0,
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    }
  };

  const seekCalls = [];
  const actions = createControlActions({
    adapter: {
      getVideo: () => video,
      getCurrentTime: () => 1.95,
      seekAndPlay: (time, options) => {
        seekCalls.push({ time, options });
        return true;
      },
      togglePlayback: () => {
        video.paused = !video.paused;
        return true;
      },
      playPlayback: () => {
        video.playCalls += 1;
        video.paused = false;
        return true;
      },
      pausePlayback: () => {
        video.pauseCalls += 1;
        video.paused = true;
        return true;
      },
      ...adapterOverrides
    },
    subtitleStore: {
      getState: () => ({
        timeline: [
          { startTime: 1, endTime: 2, text: 'first' },
          { startTime: 3, endTime: 4, text: 'second' }
        ],
        activeSubtitle: { cue: { startTime: 1, endTime: 2, text: 'first' } },
        sourceLanguage: 'fi',
        title: 'Netflix'
      })
    },
    settingsStore: {
      get: () => ({
        playbackSpeed: 1
      })
    },
    translationQueue: null
  });

  return {
    actions,
    video,
    seekCalls
  };
}

describe('Control actions subtitle navigation', () => {
  test('resumes playback when navigating from auto-paused state', async () => {
    const harness = createHarness({
      paused: true,
      autoPaused: true
    });

    const handled = harness.actions.nextSubtitle();
    await Promise.resolve();

    assert.equal(handled, true);
    assert.equal(harness.seekCalls.length, 1);
    assert.equal(harness.seekCalls[0].time, 3);
    assert.equal(harness.video.playCalls, 0);
  });

  test('also resumes playback when navigating from manual paused state', async () => {
    const harness = createHarness({
      paused: true,
      autoPaused: false
    });

    const handled = harness.actions.nextSubtitle();
    await Promise.resolve();

    assert.equal(handled, true);
    assert.equal(harness.seekCalls.length, 1);
    assert.equal(harness.video.playCalls, 0);
  });

  test('navigating while already playing still reissues play after seek', async () => {
    const harness = createHarness({
      paused: false,
      autoPaused: false
    });

    const handled = harness.actions.nextSubtitle();
    await Promise.resolve();

    assert.equal(handled, true);
    assert.equal(harness.seekCalls.length, 1);
    assert.equal(harness.video.playCalls, 0);
  });

  test('opens settings through the background message path first', async () => {
    const calls = [];
    const harness = createHarness({
      paused: false,
      autoPaused: false,
      runtimeOverrides: {
        sendMessage: async (message) => {
          calls.push(['sendMessage', message]);
          return { success: true };
        },
        openOptionsPage: async () => {
          calls.push(['openOptionsPage']);
        }
      }
    });

    const result = await harness.actions.openSettings();

    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'sendMessage');
    assert.equal(calls[0][1].action, 'openOptionsPage');
  });

  test('togglePlayPause uses adapter toggle command', () => {
    const calls = [];
    const harness = createHarness({
      paused: true,
      autoPaused: false,
      adapterOverrides: {
        togglePlayback: () => {
          calls.push('toggle');
          harness.video.paused = !harness.video.paused;
          return true;
        }
      }
    });

    const playResult = harness.actions.togglePlayPause();
    const pauseResult = harness.actions.togglePlayPause();

    assert.equal(playResult, true);
    assert.equal(pauseResult, true);
    assert.deepEqual(calls, ['toggle', 'toggle']);
    assert.equal(harness.video.playCalls, 0);
    assert.equal(harness.video.pauseCalls, 0);
  });

  test('togglePlayPause does not fall back to raw video methods when adapter toggle command is unavailable', () => {
    const harness = createHarness({
      paused: true,
      autoPaused: false,
      adapterOverrides: {
        togglePlayback: () => false
      }
    });

    const result = harness.actions.togglePlayPause();

    assert.equal(result, false);
    assert.equal(harness.video.playCalls, 0);
    assert.equal(harness.video.pauseCalls, 0);
  });
});
