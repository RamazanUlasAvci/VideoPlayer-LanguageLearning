import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildPortableLibrary } = require('../electron/library-mobile-export-service');

test('rewrites ready clips into portable paths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpll-export-'));
  await fs.writeFile(path.join(dir, 'clip.mp4'), Buffer.from('video'));
  const result = await buildPortableLibrary({ version: 7, items: [{ term: 'sell', contexts: [{ clipStatus: 'ready', clipPath: 'library-media/clip.mp4' }] }] }, dir);
  assert.equal(result.portable.items[0].contexts[0].clipPath, 'library-media/clip.mp4');
  assert.equal(result.clipFiles.size, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
