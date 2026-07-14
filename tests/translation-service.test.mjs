import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TranslationService } = require('../electron/translation-service.js');

test('translation cache keys are separated by target language', () => {
  const service = new TranslationService('unused.json');

  const german = service.cacheKey('Hello', 'en', 'de');
  const japanese = service.cacheKey('Hello', 'en', 'ja');
  const brazilianPortuguese = service.cacheKey('Hello', 'en', 'pt-br');

  assert.notEqual(german, japanese);
  assert.equal(brazilianPortuguese, 'en|pt-BR|Hello');
});
