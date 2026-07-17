import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createLocalFallback,
  sanitizeUnits,
  sanitizeWordLevels,
  sanitizeLexicalEnrichment,
  sanitizeStudyHint,
  withTimeout
} = require('../electron/ai-learning-service.js');

test('local fallback groups known expressions but leaves ordinary phrases alone', () => {
  const tokens = ['I', 'will', 'give', 'up', 'the', 'old', 'house'].map((text, index) => ({ index, text }));
  const units = createLocalFallback(tokens);

  assert.deepEqual(units.map(({ startToken, endToken }) => [startToken, endToken]), [[2, 3]]);
});

test('AI units are validated and overlapping spans are rejected', () => {
  const units = sanitizeUnits([
    {
      startToken: 1,
      endToken: 3,
      lemma: 'look forward to',
      type: 'phrasal_verb',
      confidence: 0.9,
      cefrLevel: 'B1',
      cefrConfidence: 0.86
    },
    { startToken: 2, endToken: 3, lemma: 'forward to', type: 'collocation', confidence: 0.99 },
    { startToken: -1, endToken: 2, lemma: 'invalid', type: 'idiom', confidence: 1 }
  ], 5);

  assert.equal(units.length, 1);
  assert.equal(units[0].lemma, 'look forward to');
  assert.equal(units[0].cefrLevel, 'B1');
  assert.equal(units[0].cefrConfidence, 0.86);
});

test('contextual CEFR word levels are normalized and invalid entries are ignored', () => {
  const levels = sanitizeWordLevels([
    { tokenIndex: 0, lemma: 'run', cefrLevel: 'b1', cefrConfidence: 0.75 },
    { tokenIndex: 1, lemma: 'company', cefrLevel: 'invalid', cefrConfidence: 4 },
    { tokenIndex: 99, lemma: 'outside', cefrLevel: 'C1', cefrConfidence: 0.9 }
  ], 2);

  assert.deepEqual(levels, [
    { tokenIndex: 0, lemma: 'run', cefrLevel: 'B1', cefrConfidence: 0.75 },
    { tokenIndex: 1, lemma: 'company', cefrLevel: 'UNKNOWN', cefrConfidence: 1 }
  ]);
});


test('lexical enrichment keeps at most two unique dictionary definitions', () => {
  const result = sanitizeLexicalEnrichment({
    lemma: 'transfer',
    partOfSpeech: 'verb',
    wordForm: 'past tense of transfer',
    dictionaryDefinitions: [
      'to move something from one place to another',
      'to move something from one place to another',
      'to change from one service or position to another'
    ],
    studyHint: 'to move something to a different place',
    confidence: 1.4
  });

  assert.equal(result.lemma, 'transfer');
  assert.equal(result.partOfSpeech, 'verb');
  assert.equal(result.wordForm, 'past tense of transfer');
  assert.deepEqual(result.dictionaryDefinitions, [
    'to move something from one place to another',
    'to change from one service or position to another'
  ]);
  assert.equal(result.studyHint, 'to move something to a different place');
  assert.equal(result.studyHintLanguage, 'en');
  assert.equal(result.confidence, 1);
});

test('study hints that reveal the English answer are rejected', () => {
  assert.equal(sanitizeStudyHint('the act of selling something', ['sell']), '');
  assert.equal(sanitizeStudyHint('to exchange something for money', ['sell']), 'to exchange something for money');
});


test('AI timeout rejects a request that never settles', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 15, 'AI timeout test'),
    /AI timeout test/
  );
});
