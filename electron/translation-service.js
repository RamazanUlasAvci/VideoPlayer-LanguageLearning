'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class TranslationService {
  constructor(cacheFilePath) {
    this.cacheFilePath = cacheFilePath;
    this.cache = new Map();
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async loadCache() {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.cacheFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') this.cache.set(key, value);
      }
    } catch {
      // İlk çalıştırmada cache dosyasının bulunmaması normaldir.
    }
  }

  cacheKey(text) {
    return `en|tr|${text.trim()}`;
  }

  decodeEntities(value) {
    return String(value)
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
  }

  async persistCache() {
    const snapshot = Object.fromEntries(this.cache.entries());
    await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
    const temporaryPath = `${this.cacheFilePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), 'utf8');

    try {
      await fs.rename(temporaryPath, this.cacheFilePath);
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      await fs.rm(this.cacheFilePath, { force: true });
      await fs.rename(temporaryPath, this.cacheFilePath);
    }
  }

  async translate(text) {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();

    if (!cleanText) {
      throw new Error('Çevrilecek altyazı metni boş.');
    }

    if (cleanText.length > 480) {
      throw new Error('Altyazı ücretsiz çeviri servisi için fazla uzun.');
    }

    await this.loadCache();
    const key = this.cacheKey(cleanText);
    const cached = this.cache.get(key);

    if (cached) {
      return { translatedText: cached, provider: 'local-cache', cached: true };
    }

    const endpoint = new URL('https://api.mymemory.translated.net/get');
    endpoint.searchParams.set('q', cleanText);
    endpoint.searchParams.set('langpair', 'en|tr');

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Izlerken-Ogren-Player/0.1.0'
        },
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      throw new Error(`Çeviri servisine bağlanılamadı: ${error.message}`);
    }

    if (!response.ok) {
      throw new Error(`Çeviri servisi HTTP ${response.status} hatası verdi.`);
    }

    const payload = await response.json();
    const translatedText = this.decodeEntities(payload?.responseData?.translatedText || '').trim();

    if (!translatedText) {
      const message = payload?.responseDetails || 'Çeviri servisi boş yanıt verdi.';
      throw new Error(String(message));
    }

    this.cache.set(key, translatedText);
    this.writeQueue = this.writeQueue.catch(() => undefined).then(() => this.persistCache());
    await this.writeQueue;

    return { translatedText, provider: 'MyMemory', cached: false };
  }
}

module.exports = { TranslationService };
