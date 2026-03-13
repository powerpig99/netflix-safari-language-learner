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
