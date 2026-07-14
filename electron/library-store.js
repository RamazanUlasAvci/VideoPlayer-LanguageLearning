'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeLanguageCode } = require('./settings-store');

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
      await this.writeData({ version: 2, items: [] });
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

      return {
        version: Math.max(2, Number(parsed.version) || 1),
        items: parsed.items
      };
    } catch {
      const backupPath = `${this.filePath}.bozuk-${Date.now()}`;

      try {
        await fs.rename(this.filePath, backupPath);
      } catch {
        // Create a clean library even if the damaged file cannot be moved.
      }

      const empty = { version: 2, items: [] };
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

  normalizeTerm(value) {
    return String(value)
      .normalize('NFKC')
      .toLocaleLowerCase('en')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async saveLearningUnit(input) {
    const sourceLanguage = normalizeLanguageCode(input.sourceLanguage || 'en');
    const targetLanguage = normalizeLanguageCode(input.targetLanguage);
    const term = String(input.term || input.clickedWord || '').trim();
    const normalizedTerm = this.normalizeTerm(input.normalizedTerm || input.lemma || term);

    if (!normalizedTerm) {
      throw new Error('Kaydedilecek geçerli bir İngilizce kelime veya ifade bulunamadı.');
    }

    const lemma = String(input.lemma || normalizedTerm).trim();
    const unitType = String(input.unitType || 'word').trim();
    const sourceSentence = String(input.sourceSentence || '').trim();
    const translatedSentence = String(input.translatedSentence || '').trim();
    const videoName = String(input.videoName || '').trim();
    const subtitleStartMs = Number.isFinite(input.subtitleStartMs)
      ? Math.max(0, Math.round(input.subtitleStartMs))
      : null;
    const subtitleEndMs = Number.isFinite(input.subtitleEndMs)
      ? Math.max(0, Math.round(input.subtitleEndMs))
      : null;
    const confidence = Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, Number(input.confidence)))
      : null;
    const analysisProvider = String(input.analysisProvider || '').trim() || null;
    const analysisModel = String(input.analysisModel || '').trim() || null;

    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const data = await this.readData();
      data.version = 2;
      const now = new Date().toISOString();
      const existing = data.items.find((item) => {
        const savedNormalized = item.normalizedTerm || item.normalizedWord;
        return savedNormalized === normalizedTerm &&
          (item.sourceLanguage || 'en') === sourceLanguage;
      });

      const context = {
        sourceSentence,
        translatedSentence,
        targetLanguage,
        videoName,
        subtitleStartMs,
        subtitleEndMs,
        savedAt: now
      };

      if (existing) {
        existing.term = existing.term || existing.clickedWord || term;
        existing.normalizedTerm = normalizedTerm;
        existing.lemma = existing.lemma || lemma;
        existing.unitType = existing.unitType || unitType;
        existing.sourceLanguage = sourceLanguage;
        existing.timesSaved = Number(existing.timesSaved || 1) + 1;
        existing.lastSavedAt = now;
        existing.surfaceForms = Array.from(new Set([
          ...(existing.surfaceForms || existing.clickedForms || []),
          term
        ]));
        existing.analysis = existing.analysis || {
          provider: analysisProvider,
          model: analysisModel,
          confidence
        };
        existing.contexts = Array.isArray(existing.contexts) ? existing.contexts : [];

        const contextAlreadyExists = existing.contexts.some((savedContext) =>
          savedContext.sourceSentence === sourceSentence &&
          savedContext.translatedSentence === translatedSentence &&
          savedContext.targetLanguage === targetLanguage &&
          savedContext.videoName === videoName &&
          savedContext.subtitleStartMs === subtitleStartMs
        );

        if (!contextAlreadyExists) existing.contexts.push(context);
      } else {
        data.items.push({
          id: globalThis.crypto.randomUUID(),
          term,
          normalizedTerm,
          lemma,
          unitType,
          sourceLanguage,
          surfaceForms: [term],
          firstSavedAt: now,
          lastSavedAt: now,
          timesSaved: 1,
          analysis: {
            provider: analysisProvider,
            model: analysisModel,
            confidence
          },
          contexts: [context]
        });
      }

      data.items.sort((a, b) =>
        String(a.normalizedTerm || a.normalizedWord || '').localeCompare(
          String(b.normalizedTerm || b.normalizedWord || ''),
          'en'
        )
      );

      await this.writeData(data);

      return {
        totalWords: data.items.length,
        savedTerm: term,
        unitType,
        wasExisting: Boolean(existing)
      };
    });

    return this.writeQueue;
  }

  // Backward-compatible method for old callers and existing tests.
  async saveWord(input) {
    return this.saveLearningUnit({
      ...input,
      term: input.term || input.clickedWord,
      unitType: input.unitType || 'word'
    });
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
