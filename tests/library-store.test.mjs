import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LearningLibraryStore } = require('../electron/library-store.js');

test('learning library stores an English unit with full sentence context', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'language-player-test-'));
  const filePath = path.join(directory, 'learning-library.json');
  const store = new LearningLibraryStore(filePath);

  const first = await store.saveLearningUnit({
    term: 'give up',
    lemma: 'give up',
    unitType: 'phrasal_verb',
    sourceSentence: 'I will not give up.',
    translatedSentence: 'Pes etmeyeceğim.',
    videoName: 'test.mp4',
    subtitleStartMs: 1000,
    subtitleEndMs: 2500,
    sourceLanguage: 'en',
    targetLanguage: 'tr',
    analysisProvider: 'Gemini',
    analysisModel: 'gemini-3.5-flash',
    confidence: 0.95
  });

  const second = await store.saveLearningUnit({
    term: 'gave up',
    lemma: 'give up',
    unitType: 'phrasal_verb',
    sourceSentence: 'She gave up yesterday.',
    translatedSentence: 'Dün vazgeçti.',
    sourceLanguage: 'en',
    targetLanguage: 'tr'
  });

  assert.equal(first.totalWords, 1);
  assert.equal(second.totalWords, 1);
  assert.equal(second.wasExisting, true);

  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(data.version, 2);
  assert.equal(data.items[0].term, 'give up');
  assert.equal(data.items[0].unitType, 'phrasal_verb');
  assert.deepEqual(data.items[0].surfaceForms.sort(), ['gave up', 'give up']);
  assert.equal(data.items[0].contexts.length, 2);
  assert.equal(data.items[0].contexts[0].sourceSentence, 'I will not give up.');

  await fs.rm(directory, { recursive: true, force: true });
});

test('the same English unit remains one item across different translation languages', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'language-player-test-'));
  const filePath = path.join(directory, 'learning-library.json');
  const store = new LearningLibraryStore(filePath);

  await store.saveLearningUnit({
    term: 'cat',
    sourceSentence: 'The cat is here.',
    translatedSentence: 'Le chat est ici.',
    sourceLanguage: 'en',
    targetLanguage: 'fr'
  });

  const result = await store.saveLearningUnit({
    term: 'cat',
    sourceSentence: 'The cat is sleeping.',
    translatedSentence: 'Die Katze schläft.',
    sourceLanguage: 'en',
    targetLanguage: 'de'
  });

  assert.equal(result.totalWords, 1);
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.deepEqual(
    data.items[0].contexts.map((context) => context.targetLanguage).sort(),
    ['de', 'fr']
  );

  await fs.rm(directory, { recursive: true, force: true });
});
