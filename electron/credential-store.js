'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class GeminiCredentialStore {
  constructor(filePath, safeStorageApi) {
    this.filePath = filePath;
    this.safeStorage = safeStorageApi;
  }

  environmentKey() {
    return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  }

  async getApiKey() {
    const environmentKey = this.environmentKey();
    if (environmentKey) return environmentKey;

    try {
      const encrypted = await fs.readFile(this.filePath);
      if (!encrypted.length) return '';
      if (!this.safeStorage?.isEncryptionAvailable?.()) return '';
      return this.safeStorage.decryptString(encrypted).trim();
    } catch {
      return '';
    }
  }

  async getStatus() {
    const environmentKey = this.environmentKey();
    if (environmentKey) {
      return { configured: true, source: 'environment', securelyStored: true };
    }

    const key = await this.getApiKey();
    return {
      configured: Boolean(key),
      source: key ? 'secure-store' : 'none',
      securelyStored: Boolean(key)
    };
  }

  async saveApiKey(value) {
    const apiKey = String(value || '').trim();
    if (apiKey.length < 20) {
      throw new Error('Gemini API anahtarı geçerli görünmüyor.');
    }

    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('Bu sistemde güvenli anahtar saklama kullanılamıyor. GEMINI_API_KEY ortam değişkenini kullan.');
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const encrypted = this.safeStorage.encryptString(apiKey);
    await fs.writeFile(this.filePath, encrypted);
    return this.getStatus();
  }

  async clearApiKey() {
    await fs.rm(this.filePath, { force: true });
    return this.getStatus();
  }
}

module.exports = { GeminiCredentialStore };
