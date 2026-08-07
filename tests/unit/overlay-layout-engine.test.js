const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function loadEngine() {
  const context = {
    NetflixLanguageLearner: {},
    console
  };
  context.globalThis = context;

  const scriptPath = path.resolve(__dirname, '../../core/overlay-layout-engine.js');
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: 'overlay-layout-engine.js' });
  return context.NetflixLanguageLearner.core.overlayLayoutEngine;
}

describe('overlay layout engine', () => {
  test('computeVideoScale clamps between min and max from content size', () => {
    const engine = loadEngine();
    assert.equal(engine.computeVideoScale({ left: 0, top: 0, width: 640, height: 360 }), 1);
    assert.equal(
      Number(engine.computeVideoScale({ left: 0, top: 0, width: 2560, height: 1440 }).toFixed(2)),
      2
    );
    assert.equal(engine.computeVideoScale({ left: 0, top: 0, width: 4000, height: 3000 }), 2.1);
  });

  test('computeSubtitlePlacement centers over content and uses base inset without exclusions', () => {
    const engine = loadEngine();
    const placement = engine.computeSubtitlePlacement({
      mountRect: { left: 0, top: 0, width: 1920, height: 1080 },
      contentRect: { left: 0, top: 0, width: 1920, height: 1080 },
      exclusions: []
    });

    assert.ok(placement);
    assert.equal(placement.left, 960);
    assert.equal(placement.baseBottomInset, Math.max(10, Math.round(1080 * 0.1)));
    assert.equal(placement.bottomInset, placement.baseBottomInset);
    assert.equal(placement.bottom, placement.baseBottomInset);
    assert.ok(placement.width >= 260);
    assert.ok(placement.scale >= 1);
  });

  test('exclusions in the lower band raise the subtitle bottom inset', () => {
    const engine = loadEngine();
    const contentRect = { left: 100, top: 50, width: 1000, height: 600, right: 1100, bottom: 650 };
    const mountRect = { left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700 };
    const base = engine.computeBaseBottomInset(contentRect);

    const placement = engine.computeSubtitlePlacement({
      mountRect,
      contentRect,
      estimatedOverlayHeight: 80,
      exclusions: [
        {
          // Bottom control bar overlapping the projected subtitle band
          left: 200,
          top: 560,
          width: 800,
          height: 70
        }
      ]
    });

    assert.ok(placement.bottomInset > base);
    assert.equal(placement.bottomInset, Math.round(contentRect.bottom - 560 + 12));
    // mount bottom is 700, content bottom 650 → videoBottomInset 50
    assert.equal(placement.videoBottomInset, 50);
    assert.equal(placement.bottom, 50 + placement.bottomInset);
  });

  test('exclusions outside the lower band or video center do not lift subtitles', () => {
    const engine = loadEngine();
    const contentRect = { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 };
    const mountRect = contentRect;
    const base = engine.computeBaseBottomInset(contentRect);

    const placement = engine.computeSubtitlePlacement({
      mountRect,
      contentRect,
      exclusions: [
        { left: 0, top: 0, width: 200, height: 40 }, // top chrome
        { left: -100, top: 500, width: 50, height: 50 } // outside horizontally
      ]
    });

    assert.equal(placement.bottomInset, base);
  });

  test('computeControlBandExclusions returns top and bottom bands', () => {
    const engine = loadEngine();
    const bands = engine.computeControlBandExclusions({
      left: 0,
      top: 0,
      width: 1000,
      height: 500
    });

    assert.equal(bands.length, 2);
    assert.equal(bands[0].id, 'top-controls-band');
    assert.equal(bands[1].id, 'bottom-controls-band');
    assert.equal(bands[0].top, 0);
    assert.equal(bands[1].bottom, 500);
    assert.ok(bands[1].top < 500);
  });

  test('layout exclusion store merges sources and notifies subscribers', () => {
    const engine = loadEngine();
    const store = engine.createLayoutExclusionStore();
    let notifications = 0;
    const stop = store.subscribe(() => {
      notifications += 1;
    });

    store.set('native-controls', [{ left: 0, top: 400, width: 100, height: 40 }]);
    store.set('panel', [{ left: 80, top: 10, width: 20, height: 20 }]);
    assert.equal(store.getAll().length, 2);
    assert.equal(notifications, 2);

    store.clear('panel');
    assert.equal(store.getAll().length, 1);
    assert.equal(store.getAll()[0].source, 'native-controls');
    stop();
  });
});