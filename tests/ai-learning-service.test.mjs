import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createLocalFallback,
  sanitizeUnits
} = require('../electron/ai-learning-service.js');

test('local fallback groups known expressions but leaves ordinary phrases alone', () => {
  const tokens = ['I', 'will', 'give', 'up', 'the', 'old', 'house'].map((text, index) => ({ index, text }));
  const units = createLocalFallback(tokens);

  assert.deepEqual(units.map(({ startToken, endToken }) => [startToken, endToken]), [[2, 3]]);
});

test('AI units are validated and overlapping spans are rejected', () => {
  const units = sanitizeUnits([
    { startToken: 1, endToken: 3, lemma: 'look forward to', type: 'phrasal_verb', confidence: 0.9 },
    { startToken: 2, endToken: 3, lemma: 'forward to', type: 'collocation', confidence: 0.99 },
    { startToken: -1, endToken: 2, lemma: 'invalid', type: 'idiom', confidence: 1 }
  ], 5);

  assert.equal(units.length, 1);
  assert.equal(units[0].lemma, 'look forward to');
});
