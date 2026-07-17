import test from 'node:test';
import assert from 'node:assert/strict';
import { createClozeQuestion, flattenLibrary, isSafeBundlePath, validatePortableLibrary } from '../index.js';

test('creates a cloze question', () => {
  assert.equal(createClozeQuestion('I sold the house.', 'sold'), 'I [...] the house.');
});

test('validates and flattens a portable library', () => {
  const library = validatePortableLibrary({ version: 7, items: [{ id: '1', term: 'sell', contexts: [{ id: 'c', sourceSentence: 'I sell it.', targetLanguage: 'tr' }] }] });
  assert.equal(flattenLibrary(library).length, 1);
  assert.equal(library.items[0].contexts[0].cefrLevel, 'UNKNOWN');
});

test('rejects unsafe archive paths', () => {
  assert.equal(isSafeBundlePath('library-media/a.mp4'), true);
  assert.equal(isSafeBundlePath('../a.mp4'), false);
  assert.equal(isSafeBundlePath('C:/a.mp4'), false);
});
