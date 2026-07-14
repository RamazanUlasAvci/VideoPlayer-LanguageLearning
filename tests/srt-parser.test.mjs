import test from 'node:test';
import assert from 'node:assert/strict';
import { findActiveCue, parseSrt, timestampToMs } from '../src/srt-parser.mjs';

test('timestampToMs virgül ve nokta ayırıcısını destekler', () => {
  assert.equal(timestampToMs('00:01:02,345'), 62_345);
  assert.equal(timestampToMs('01:00:00.5'), 3_600_500);
});

test('parseSrt çok satırlı altyazıları ayrıştırır ve HTML etiketlerini temizler', () => {
  const cues = parseSrt(`1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i> world!\nSecond line.\n\n2\n00:00:04.000 --> 00:00:05.250\nHow are you?`);

  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], {
    id: 1,
    startMs: 1000,
    endMs: 3500,
    text: 'Hello world!\nSecond line.'
  });
});

test('findActiveCue belirtilen zamandaki altyazıyı bulur', () => {
  const cues = parseSrt(`1\n00:00:01,000 --> 00:00:02,000\nOne\n\n2\n00:00:03,000 --> 00:00:04,000\nTwo`);

  assert.equal(findActiveCue(cues, 1500)?.text, 'One');
  assert.equal(findActiveCue(cues, 2500), null);
  assert.equal(findActiveCue(cues, 3500)?.text, 'Two');
});
