'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeLanguageCode(value) {
  const raw = String(value || '').trim();

  if (!raw || raw.length > 35) {
    throw new Error('Geçerli bir çeviri dili seçilmedi.');
  }

  try {
    return new Intl.Locale(raw).toString();
  } catch {
    throw new Error('Çeviri dili kodu geçerli değil. Örnek: tr, de, ja veya pt-BR.');
  }
}

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeData({ version: 1, targetLanguage: null });
    }
  }

  async readData() {
    await this.ensureFile();

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      return {
        version: 1,
        targetLanguage: parsed?.targetLanguage
          ? normalizeLanguageCode(parsed.targetLanguage)
          : null
      };
    } catch {
      const clean = { version: 1, targetLanguage: null };
      await this.writeData(clean);
      return clean;
    }
  }

  async writeData(data) {
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    try {
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      await fs.rm(this.filePath, { force: true });
      await fs.rename(temporaryPath, this.filePath);
    }
  }

  async getPreferences() {
    return this.readData();
  }

  async setTargetLanguage(value) {
    const targetLanguage = normalizeLanguageCode(value);

    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const data = await this.readData();
      data.targetLanguage = targetLanguage;
      await this.writeData(data);
      return { targetLanguage };
    });

    return this.writeQueue;
  }
}

module.exports = { SettingsStore, normalizeLanguageCode };
