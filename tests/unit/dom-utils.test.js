const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function loadDomUtils() {
  const context = {
    NetflixLanguageLearner: {},
    console
  };
  context.globalThis = context;

  const scriptPath = path.resolve(__dirname, '../../utils/dom-utils.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'dom-utils.js' });
  return context.NetflixLanguageLearner.domUtils;
}

function mockElementRect(rect) {
  return {
    getBoundingClientRect() {
      return {
        left: rect.left,
        right: rect.right ?? (rect.left + rect.width),
        top: rect.top,
        bottom: rect.bottom ?? (rect.top + rect.height),
        width: rect.width,
        height: rect.height
      };
    },
    videoWidth: rect.videoWidth || 0,
    videoHeight: rect.videoHeight || 0
  };
}

describe('dom utils rendered video geometry', () => {
  test('getRenderedVideoRect pillarboxes wide element boxes for tall content', () => {
    const domUtils = loadDomUtils();
    // Element is 16:9 (1920x1080), content is 4:3 → horizontal pillarbox.
    const video = mockElementRect({
      left: 100,
      top: 50,
      width: 1920,
      height: 1080,
      videoWidth: 1440,
      videoHeight: 1080
    });

    const rect = domUtils.getRenderedVideoRect(video);
    assert.ok(rect);
    assert.equal(Math.round(rect.width), 1440);
    assert.equal(Math.round(rect.height), 1080);
    assert.equal(Math.round(rect.left), 100 + (1920 - 1440) / 2);
    assert.equal(Math.round(rect.top), 50);
  });

  test('getRenderedVideoRect letterboxes tall element boxes for wide content', () => {
    const domUtils = loadDomUtils();
    // Element is square; content is 16:9 → vertical letterbox.
    const video = mockElementRect({
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
      videoWidth: 1920,
      videoHeight: 1080
    });

    const rect = domUtils.getRenderedVideoRect(video);
    assert.ok(rect);
    assert.equal(Math.round(rect.width), 1000);
    assert.equal(Math.round(rect.height), Math.round(1000 * 1080 / 1920));
    assert.equal(Math.round(rect.left), 0);
    assert.ok(rect.top > 0);
  });

  test('getRenderedVideoRect falls back to mount target when video missing', () => {
    const domUtils = loadDomUtils();
    const mount = mockElementRect({
      left: 10,
      top: 20,
      width: 800,
      height: 450
    });

    const rect = domUtils.getRenderedVideoRect(null, mount);
    assert.ok(rect);
    assert.equal(rect.left, 10);
    assert.equal(rect.top, 20);
    assert.equal(rect.width, 800);
    assert.equal(rect.height, 450);
  });

  test('toLocalRect converts viewport rects into mount-local coordinates', () => {
    const domUtils = loadDomUtils();
    const local = domUtils.toLocalRect(
      { left: 120, top: 80, right: 320, bottom: 180, width: 200, height: 100 },
      { left: 100, top: 50 }
    );

    assert.equal(local.x, 20);
    assert.equal(local.y, 30);
    assert.equal(local.width, 200);
    assert.equal(local.height, 100);
    assert.equal(local.right, 220);
    assert.equal(local.bottom, 130);
  });
});
