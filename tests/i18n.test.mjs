import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SUPPORTED_LOCALES,
  detectBrowserLocale,
  interpolate,
  i18n,
} from '../js/i18n/index.js';
import en from '../js/i18n/locales/en.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function extractPlaceholders(str) {
  const matches = str.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches)].sort();
}

async function testLocaleCompleteness() {
  assert.equal(SUPPORTED_LOCALES.length, 10, 'Expected 10 supported locales');
  const enKeys = Object.keys(en).sort();
  assert.ok(enKeys.length > 150, `Expected full translation catalog, got ${enKeys.length} keys`);

  for (const key of enKeys) {
    assert.equal(typeof en[key], 'string', `en[${key}] must be string`);
    assert.ok(en[key].trim().length > 0, `en[${key}] must be non-empty`);
  }

  for (const { code } of SUPPORTED_LOCALES) {
    const mod = await import(`../js/i18n/locales/${code}.js`);
    const dict = mod.default;
    assert.ok(dict && typeof dict === 'object', `Locale ${code} must export default object`);

    const keys = Object.keys(dict).sort();
    const missing = enKeys.filter(k => !Object.prototype.hasOwnProperty.call(dict, k));
    const extra = keys.filter(k => !Object.prototype.hasOwnProperty.call(en, k));

    assert.deepEqual(missing, [], `Locale ${code} missing keys: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `Locale ${code} extra keys: ${extra.join(', ')}`);

    for (const key of enKeys) {
      assert.equal(typeof dict[key], 'string', `${code}[${key}] must be string`);
      assert.ok(dict[key].trim().length > 0, `${code}[${key}] must not be empty`);
      assert.deepEqual(
        extractPlaceholders(dict[key]),
        extractPlaceholders(en[key]),
        `Placeholder mismatch in ${code}[${key}]: "${dict[key]}" vs "${en[key]}"`
      );
    }
  }
}

async function testHtmlAndJsKeyReferences() {
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const htmlRegex = /data-i18n(?:-(?:title|aria|placeholder|alt))?="([^"]+)"/g;
  let match;
  let htmlKeyCount = 0;
  while ((match = htmlRegex.exec(html)) !== null) {
    htmlKeyCount++;
    const key = match[1];
    assert.ok(
      Object.prototype.hasOwnProperty.call(en, key),
      `index.html references missing i18n key "${key}"`
    );
  }
  assert.ok(htmlKeyCount > 50, `Expected >50 data-i18n attributes in index.html, got ${htmlKeyCount}`);

  const jsFiles = ['js/app.js', 'js/hid/webhid-manager.js'];
  let jsKeyCount = 0;
  for (const rel of jsFiles) {
    const src = await fs.readFile(path.join(ROOT, rel), 'utf8');
    const tRegex = /\bt\(\s*'([^']+)'/g;
    while ((match = tRegex.exec(src)) !== null) {
      jsKeyCount++;
      const key = match[1];
      assert.ok(
        Object.prototype.hasOwnProperty.call(en, key),
        `${rel} references missing i18n key "${key}"`
      );
    }
  }
  assert.ok(jsKeyCount > 30, `Expected >30 literal t('...') calls in JS modules, got ${jsKeyCount}`);

  const dynamicFamilies = [
    ...[0, 1, 2, 3].map(n => `sensor.hintMode${n}`),
    ...[0, 1, 2, 3].map(n => `nvram.dpiField${n}`),
    ...[0, 1, 2, 3].map(n => `nvram.ledCh${n}`),
    ...Array.from({ length: 12 }, (_, n) => `nvram.btnCat${n}`),
    ...[0, 1, 2, 3].map(n => `nvram.btnSub${n}`),
    ...[0, 1, 2, 3, 4].map(n => `diagnostics.clickBtn${n}`),
  ];
  for (const key of dynamicFamilies) {
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `Missing dynamic i18n key "${key}"`);
  }
}

function testLocaleDetection() {
  assert.equal(detectBrowserLocale(['zh-TW', 'en-US']), 'zh-TW');
  assert.equal(detectBrowserLocale(['zh-HK']), 'zh-TW');
  assert.equal(detectBrowserLocale(['zh-Hant-TW']), 'zh-TW');
  assert.equal(detectBrowserLocale(['zh-CN']), 'zh-CN');
  assert.equal(detectBrowserLocale(['zh-SG']), 'zh-CN');
  assert.equal(detectBrowserLocale(['zh']), 'zh-CN');
  assert.equal(detectBrowserLocale(['ja-JP']), 'ja');
  assert.equal(detectBrowserLocale(['ko-KR']), 'ko');
  assert.equal(detectBrowserLocale(['es-419']), 'es');
  assert.equal(detectBrowserLocale(['de-DE']), 'de');
  assert.equal(detectBrowserLocale(['fr-FR']), 'fr');
  assert.equal(detectBrowserLocale(['pt-BR']), 'pt-BR');
  assert.equal(detectBrowserLocale(['pt-PT']), 'pt-BR');
  assert.equal(detectBrowserLocale(['ru-RU']), 'ru');
  assert.equal(detectBrowserLocale(['en-GB']), 'en');
  assert.equal(detectBrowserLocale(['nl-NL']), 'en');
  assert.equal(detectBrowserLocale(['fr-FR', 'en-US']), 'fr');
}

async function testRuntimeApi() {
  assert.equal(interpolate('Hello {{name}} ({{n}})', { name: 'A950', n: 2 }), 'Hello A950 (2)');
  assert.equal(interpolate('Missing {{x}}!', {}), 'Missing !');

  await i18n.setPreference('ja');
  assert.equal(i18n.locale, 'ja');
  assert.equal(i18n.preference, 'ja');
  assert.notEqual(i18n.t('nav.sensor'), 'Sensor & Performance');

  await i18n.setPreference('de');
  assert.equal(i18n.locale, 'de');
  assert.equal(i18n.t('common.durationMinSec', { m: 5, s: '00' }), '5m 00s');

  await i18n.setPreference('en');
  assert.equal(i18n.locale, 'en');
}

async function run() {
  await testLocaleCompleteness();
  await testHtmlAndJsKeyReferences();
  testLocaleDetection();
  await testRuntimeApi();
  console.log(`i18n verification passed across all ${SUPPORTED_LOCALES.length} locales.`);
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
