import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTextForTokenSpan, tokenizeEnglishText } from '../src/text-tokenizer.mjs';

test('English tokenization preserves contractions, punctuation, and source offsets', () => {
  const result = tokenizeEnglishText("I'm looking forward to it.");

  assert.deepEqual(
    result.wordTokens.map((token) => token.text),
    ["I'm", 'looking', 'forward', 'to', 'it']
  );
  assert.equal(sourceTextForTokenSpan(result.text, result.wordTokens, 1, 3), 'looking forward to');
  assert.equal(result.segments.map((segment) => segment.text).join(''), result.text);
});
