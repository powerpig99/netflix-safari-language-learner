const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function loadLanguageUtils() {
  const context = {
    NetflixLanguageLearner: {},
    setTimeout,
    console
  };
  context.globalThis = context;

  const scriptPath = path.resolve(__dirname, '../../utils/language-utils.js');
  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'language-utils.js' });
  return context.NetflixLanguageLearner.languageUtils;
}

describe('language utils translation keys', () => {
  test('toTranslationKey includes normalized title to avoid cross-title collisions', () => {
    const languageUtils = loadLanguageUtils();

    const first = languageUtils.toTranslationKey('Show A', 'EN-US', 'Hello there');
    const second = languageUtils.toTranslationKey('Show B', 'EN-US', 'Hello there');

    assert.notEqual(first, second);
    assert.equal(first, 'Show A::en::Hello there');
    assert.equal(
      languageUtils.toTranslationKey('  Show A  ', 'en-gb', '  Hello   there  '),
      'Show A::en::Hello there'
    );
  });
});

describe('language utils model defaults and migration', () => {
  test('defaults use current Gemini and Grok model IDs', () => {
    const languageUtils = loadLanguageUtils();
    assert.equal(languageUtils.DEFAULT_SETTINGS.geminiModel, 'gemini-3.5-flash-lite');
    assert.equal(languageUtils.DEFAULT_SETTINGS.grokModel, 'grok-4.3');
    assert.equal(languageUtils.CLAUDE_MODEL, 'claude-haiku-4-5-20251001');
    assert.equal(languageUtils.KIMI_MODEL, 'kimi-for-coding');
    assert.ok(languageUtils.GEMINI_MODELS.every((entry) => !entry.id.includes('preview')));
    assert.ok(languageUtils.GEMINI_MODELS.some((entry) => entry.id === 'gemini-3.5-flash-lite'));
    assert.ok(languageUtils.GROK_MODELS.some((entry) => entry.id === 'grok-4.3'));
  });

  test('migrateModelSettings rewrites retired Gemini and Grok IDs', () => {
    const languageUtils = loadLanguageUtils();

    assert.equal(
      languageUtils.normalizeGeminiModel('gemini-3.1-flash-lite-preview'),
      'gemini-3.1-flash-lite'
    );
    assert.equal(
      languageUtils.normalizeGrokModel('grok-4-1-fast-non-reasoning-latest'),
      'grok-4.3'
    );

    const patch = languageUtils.migrateModelSettings({
      geminiModel: 'gemini-3.1-flash-lite-preview',
      grokModel: 'grok-4-1-fast-non-reasoning'
    });
    assert.equal(patch.geminiModel, 'gemini-3.1-flash-lite');
    assert.equal(patch.grokModel, 'grok-4.3');
    assert.equal(Object.keys(patch).length, 2);
  });
});
