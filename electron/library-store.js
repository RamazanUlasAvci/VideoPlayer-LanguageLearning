'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class LearningLibraryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.writeData({ version: 1, items: [] });
    }
  }

  async readData() {
    await this.ensureFile();

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error('Kütüphane dosyası beklenen biçimde değil.');
      }

      return parsed;
    } catch (error) {
      const backupPath = `${this.filePath}.bozuk-${Date.now()}`;

      try {
        await fs.rename(this.filePath, backupPath);
      } catch {
        // Bozuk dosya taşınamasa bile temiz bir kütüphane oluşturmayı dene.
      }

      const empty = { version: 1, items: [] };
      await this.writeData(empty);
      return empty;
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

  normalizeWord(value) {
    return String(value)
      .normalize('NFKC')
      .toLocaleLowerCase('tr-TR')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .trim();
  }

  async saveWord(input) {
    const clickedWord = String(input.clickedWord || '').trim();
    const normalizedWord = this.normalizeWord(clickedWord);

    if (!normalizedWord) {
      throw new Error('Kaydedilecek geçerli bir kelime bulunamadı.');
    }

    const sourceSentence = String(input.sourceSentence || '').trim();
    const translatedSentence = String(input.translatedSentence || '').trim();
    const videoName = String(input.videoName || '').trim();
    const subtitleStartMs = Number.isFinite(input.subtitleStartMs)
      ? Math.max(0, Math.round(input.subtitleStartMs))
      : null;

    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const data = await this.readData();
      const now = new Date().toISOString();
      const existing = data.items.find(
        (item) => item.normalizedWord === normalizedWord && item.targetLanguage === 'tr'
      );

      const context = {
        sourceSentence,
        translatedSentence,
        videoName,
        subtitleStartMs,
        savedAt: now
      };

      if (existing) {
        existing.timesSaved = Number(existing.timesSaved || 1) + 1;
        existing.lastSavedAt = now;
        existing.clickedForms = Array.from(
          new Set([...(existing.clickedForms || []), clickedWord])
        );
        existing.contexts = Array.isArray(existing.contexts) ? existing.contexts : [];

        const contextAlreadyExists = existing.contexts.some(
          (savedContext) =>
            savedContext.sourceSentence === sourceSentence &&
            savedContext.translatedSentence === translatedSentence &&
            savedContext.videoName === videoName &&
            savedContext.subtitleStartMs === subtitleStartMs
        );

        if (!contextAlreadyExists) {
          existing.contexts.push(context);
        }
      } else {
        data.items.push({
          id: globalThis.crypto.randomUUID(),
          clickedWord,
          clickedForms: [clickedWord],
          normalizedWord,
          sourceLanguage: 'en',
          targetLanguage: 'tr',
          firstSavedAt: now,
          lastSavedAt: now,
          timesSaved: 1,
          contexts: [context]
        });
      }

      data.items.sort((a, b) => a.normalizedWord.localeCompare(b.normalizedWord, 'tr'));
      await this.writeData(data);

      return {
        totalWords: data.items.length,
        savedWord: clickedWord,
        wasExisting: Boolean(existing)
      };
    });

    return this.writeQueue;
  }

  async getSummary() {
    const data = await this.readData();
    return {
      totalWords: data.items.length,
      filePath: this.filePath
    };
  }
}

module.exports = { LearningLibraryStore };
