import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LearningLibraryStore } = require('../electron/library-store.js');

test('öğrenme kütüphanesi kelimeyi kalıcı kaydeder ve tekrarında bağlamı günceller', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'izlerken-ogren-test-'));
  const filePath = path.join(directory, 'learning-library.json');
  const store = new LearningLibraryStore(filePath);

  const first = await store.saveWord({
    clickedWord: 'Merhaba',
    sourceSentence: 'Hello there.',
    translatedSentence: 'Merhaba.',
    videoName: 'test.mp4',
    subtitleStartMs: 1000
  });

  const second = await store.saveWord({
    clickedWord: 'merhaba',
    sourceSentence: 'Hello again.',
    translatedSentence: 'Tekrar merhaba.',
    videoName: 'test.mp4',
    subtitleStartMs: 3000
  });

  assert.equal(first.totalWords, 1);
  assert.equal(first.wasExisting, false);
  assert.equal(second.totalWords, 1);
  assert.equal(second.wasExisting, true);

  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].timesSaved, 2);
  assert.equal(data.items[0].contexts.length, 2);

  await fs.rm(directory, { recursive: true, force: true });
});
