import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SettingsStore } = require('../electron/settings-store.js');

test('target language preference is persisted and normalized', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'language-settings-test-'));
  const filePath = path.join(directory, 'preferences.json');
  const store = new SettingsStore(filePath);

  const initial = await store.getPreferences();
  assert.equal(initial.targetLanguage, null);

  await store.setTargetLanguage('pt-br');

  const reloadedStore = new SettingsStore(filePath);
  const saved = await reloadedStore.getPreferences();
  assert.equal(saved.targetLanguage, 'pt-BR');

  await fs.rm(directory, { recursive: true, force: true });
});
