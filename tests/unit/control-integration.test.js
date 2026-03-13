const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.filter(Boolean).forEach((token) => this.tokens.add(token));
  }

  remove(...tokens) {
    tokens.filter(Boolean).forEach((token) => this.tokens.delete(token));
  }

  toggle(token, force) {
    if (force === true) {
      this.tokens.add(token);
      return true;
    }

    if (force === false) {
      this.tokens.delete(token);
      return false;
    }

    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return false;
    }

    this.tokens.add(token);
    return true;
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this._rect = {
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  contains(node) {
    if (node === this) {
      return true;
    }

    return this.children.some((child) => typeof child.contains === 'function' && child.contains(node));
  }

  addEventListener(type, handler, options) {
    const capture = options === true || options?.capture === true;
    const entries = this.listeners.get(type) || [];
    entries.push({ handler, capture });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, handler, options) {
    const capture = options === true || options?.capture === true;
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.handler !== handler || entry.capture !== capture));
  }

  listenerCount(type, capture = null) {
    const entries = this.listeners.get(type) || [];
    if (capture == null) {
      return entries.length;
    }

    return entries.filter((entry) => entry.capture === capture).length;
  }

  emit(type, event = {}, capture = true) {
    const entries = this.listeners.get(type) || [];
    for (const entry of entries) {
      if (entry.capture !== capture) {
        continue;
      }
      entry.handler(event);
    }
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }
}

function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    get() {
      return { ...state };
    },
    getState() {
      return { ...state };
    },
    set(patch) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener({ ...state }));
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

function loadControlIntegrationHarness() {
  const panelElement = new FakeElement('div');
  panelElement._rect = {
    left: 60,
    top: 0,
    right: 100,
    bottom: 40,
    width: 40,
    height: 40
  };
  const mountTarget = new FakeElement('div');
  const video = new FakeElement('video');
  mountTarget.appendChild(video);
  const controlRegionNode = new FakeElement('button');
  controlRegionNode._rect = {
    left: 120,
    top: 70,
    right: 180,
    bottom: 110,
    width: 60,
    height: 40
  };
  mountTarget.appendChild(controlRegionNode);
  const panelState = {
    visible: false,
    payload: null
  };
  let elementsFromPointStack = [];

  const keyboard = {
    config: {
      enabled: false,
      interceptSpace: false
    },
    attached: false,
    attachCalls: 0,
    detachCalls: 0,
    attach() {
      this.attached = true;
      this.attachCalls += 1;
    },
    detach() {
      this.attached = false;
      this.detachCalls += 1;
    }
  };

  const adapterState = {
    active: false
  };
  const controlCalls = [];
  const settingsStore = createStore({
    extensionEnabled: true
  });
  const subtitleStore = createStore({
    featureAvailability: {
      dualSubs: true,
      subtitleNavigation: true,
      autoPause: true,
      repeat: true,
      playbackSpeed: true
    },
    platformError: null,
    playerReady: false
  });

  const globalListeners = new Map();
  const context = {
    console,
    Element: FakeElement,
    document: {
      documentElement: new FakeElement('html'),
      body: new FakeElement('body'),
      elementsFromPoint() {
        return elementsFromPointStack;
      }
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1'
    }),
    addEventListener(type, handler) {
      const entries = globalListeners.get(type) || [];
      entries.push(handler);
      globalListeners.set(type, entries);
    },
    removeEventListener(type, handler) {
      const entries = globalListeners.get(type) || [];
      globalListeners.set(type, entries.filter((entry) => entry !== handler));
    },
    setTimeout,
    clearTimeout,
    NetflixLanguageLearner: {
      domUtils: {
        ensureRelativePosition: () => {}
      },
      core: {
        createControlKeyboard(options) {
          keyboard.config = {
            ...keyboard.config,
            ...(options.config || {})
          };
          keyboard.callbacks = options.callbacks;
          return keyboard;
        }
      },
      ui: {
        createControlPanel() {
          return {
            element: panelElement,
            setVisible(value) {
              panelState.visible = Boolean(value);
              panelElement.classList.toggle('is-visible', Boolean(value));
            },
            update(payload) {
              panelState.payload = payload;
            }
          };
        }
      }
    }
  };
  context.globalThis = context;

  const scriptPath = path.resolve(__dirname, '../../ui/control-integration.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'control-integration.js' });

  const integration = context.NetflixLanguageLearner.ui.createControlIntegration({
    adapter: {
      getVideo: () => (adapterState.active ? video : null),
      getMountTarget: () => mountTarget,
      isWatchPlaybackActive: () => adapterState.active
    },
    settingsStore,
    subtitleStore,
    controlActions: {
      toggleExtension() {},
      toggleDualSub() {},
      previousSubtitle() {},
      repeatSubtitle() {},
      nextSubtitle() {},
      toggleAutoPause() {},
      setPlaybackSpeed() {},
      openSettings() {},
      retrySubtitleTranslation() {},
      changePlaybackSpeed() {},
      togglePlayPause() {
        controlCalls.push('togglePlayPause');
      }
    }
  });

  return {
    integration,
    adapterState,
    settingsStore,
    subtitleStore,
    keyboard,
    mountTarget,
    controlCalls,
    controlRegionNode,
    setElementsFromPoint(stack) {
      elementsFromPointStack = stack;
    },
    panelElement,
    panelState
  };
}

function makeClickEvent(target) {
  return {
    button: 0,
    target,
    clientX: 50,
    clientY: 50,
    preventDefaultCalled: false,
    stopPropagationCalled: false,
    stopImmediatePropagationCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
    stopPropagation() {
      this.stopPropagationCalled = true;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCalled = true;
    }
  };
}

describe('Control integration playback ownership lifecycle', () => {
  test('attaches and detaches playback interception from the adapter activation signal', () => {
    const harness = loadControlIntegrationHarness();

    assert.equal(harness.keyboard.config.interceptSpace, true);
    assert.equal(harness.keyboard.attached, false);
    assert.equal(harness.mountTarget.listenerCount('pointerdown', true), 0);
    assert.equal(harness.mountTarget.listenerCount('click', true), 0);

    harness.adapterState.active = true;
    harness.subtitleStore.set({ playerReady: true });

    assert.equal(harness.keyboard.attached, true);
    assert.equal(harness.mountTarget.listenerCount('pointerdown', true), 1);
    assert.equal(harness.mountTarget.listenerCount('click', true), 1);

    harness.adapterState.active = false;
    harness.subtitleStore.set({ playerReady: false });

    assert.equal(harness.keyboard.attached, false);
    assert.equal(harness.mountTarget.listenerCount('pointerdown', true), 0);
    assert.equal(harness.mountTarget.listenerCount('click', true), 0);

    harness.integration.destroy();
  });

  test('intercepts bare playback clicks only while playback ownership is active', () => {
    const harness = loadControlIntegrationHarness();
    harness.adapterState.active = true;
    harness.subtitleStore.set({ playerReady: true });

    const pointerDownEvent = makeClickEvent(harness.mountTarget);
    const clickEvent = makeClickEvent(harness.mountTarget);
    harness.mountTarget.emit('pointerdown', pointerDownEvent, true);
    harness.mountTarget.emit('click', clickEvent, true);

    assert.equal(pointerDownEvent.preventDefaultCalled, true);
    assert.equal(clickEvent.preventDefaultCalled, true);
    assert.deepEqual(harness.controlCalls, ['togglePlayPause']);

    harness.adapterState.active = false;
    harness.subtitleStore.set({ playerReady: false });

    const inactiveClickEvent = makeClickEvent(harness.mountTarget);
    harness.mountTarget.emit('click', inactiveClickEvent, true);

    assert.equal(inactiveClickEvent.preventDefaultCalled, false);
    assert.deepEqual(harness.controlCalls, ['togglePlayPause']);

    harness.integration.destroy();
  });

  test('keeps panel and cursor visible while hovering the panel after the cursor timer expires', async () => {
    const harness = loadControlIntegrationHarness();
    harness.adapterState.active = true;
    harness.subtitleStore.set({ playerReady: true });

    harness.mountTarget.emit('mousemove', {
      clientX: 50,
      clientY: 95
    }, false);

    assert.equal(harness.panelState.visible, true);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), true);

    harness.mountTarget.emit('mousemove', {
      clientX: 80,
      clientY: 20
    }, false);

    await new Promise((resolve) => setTimeout(resolve, 950));

    assert.equal(harness.panelState.visible, true);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), true);

    harness.mountTarget.emit('mousemove', {
      clientX: 50,
      clientY: 50
    }, false);

    assert.equal(harness.panelState.visible, true);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), true);

    await new Promise((resolve) => setTimeout(resolve, 2050));

    assert.equal(harness.panelState.visible, false);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), false);

    harness.integration.destroy();
  });

  test('keeps controls visible while the pointer stays over a visible native control region after the timer expires', async () => {
    const harness = loadControlIntegrationHarness();
    harness.adapterState.active = true;
    harness.subtitleStore.set({ playerReady: true });
    harness.mountTarget.querySelectorAll = () => [harness.controlRegionNode];
    harness.setElementsFromPoint([harness.controlRegionNode]);

    harness.mountTarget.emit('mousemove', {
      clientX: 140,
      clientY: 90
    }, false);

    assert.equal(harness.panelState.visible, true);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), true);

    await new Promise((resolve) => setTimeout(resolve, 950));

    assert.equal(harness.panelState.visible, true);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), true);

    harness.setElementsFromPoint([]);
    harness.mountTarget.emit('mousemove', {
      clientX: 50,
      clientY: 50
    }, false);

    await new Promise((resolve) => setTimeout(resolve, 950));

    assert.equal(harness.panelState.visible, false);
    assert.equal(harness.mountTarget.classList.contains('nll-cursor-visible'), false);

    harness.integration.destroy();
  });
});
