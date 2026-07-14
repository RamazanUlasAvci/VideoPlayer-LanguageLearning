'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeLanguageCode } = require('./settings-store');

const CURRENT_LIBRARY_VERSION = 3;
const VALID_CLIP_STATUSES = new Set(['processing', 'ready', 'failed']);

function createId() {
  return globalThis.crypto.randomUUID();
}

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
      await this.writeData({ version: CURRENT_LIBRARY_VERSION, items: [] });
    }
  }

  migrateData(parsed) {
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('Kütüphane dosyası beklenen biçimde değil.');
    }

    for (const item of parsed.items) {
      if (!item.id) item.id = createId();
      item.contexts = Array.isArray(item.contexts) ? item.contexts : [];

      for (const context of item.contexts) {
        if (!context.id) context.id = createId();

        if (context.mediaClip && !context.clipId) {
          context.clipId = context.mediaClip.id || null;
          context.clipPath = context.mediaClip.path || null;
          context.clipStatus = context.mediaClip.status || null;
          context.clipStartMs = context.mediaClip.startMs ?? null;
          context.clipEndMs = context.mediaClip.endMs ?? null;
          context.clipError = context.mediaClip.error || null;
          delete context.mediaClip;
        }
      }
    }

    return {
      version: CURRENT_LIBRARY_VERSION,
      items: parsed.items
    };
  }

  async readData() {
    await this.ensureFile();

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return this.migrateData(JSON.parse(raw));
    } catch {
      const backupPath = `${this.filePath}.bozuk-${Date.now()}`;

      try {
        await fs.rename(this.filePath, backupPath);
      } catch {
        // Create a clean library even if the damaged file cannot be moved.
      }

      const empty = { version: CURRENT_LIBRARY_VERSION, items: [] };
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

  normalizeClip(input) {
    if (!input?.clipId) return null;

    const clipStatus = VALID_CLIP_STATUSES.has(input.clipStatus)
      ? input.clipStatus
      : 'processing';

    return {
      clipId: String(input.clipId),
      clipPath: input.clipPath ? String(input.clipPath) : null,
      clipStatus,
      clipStartMs: Number.isFinite(input.clipStartMs)
        ? Math.max(0, Math.round(input.clipStartMs))
        : null,
      clipEndMs: Number.isFinite(input.clipEndMs)
        ? Math.max(0, Math.round(input.clipEndMs))
        : null,
      clipError: input.clipError ? String(input.clipError) : null,
      clipUpdatedAt: new Date().toISOString()
    };
  }

  applyClipToContext(context, clip) {
    if (!clip) return;

    context.clipId = clip.clipId;
    context.clipPath = clip.clipPath;
    context.clipStatus = clip.clipStatus;
    context.clipStartMs = clip.clipStartMs;
    context.clipEndMs = clip.clipEndMs;
    context.clipError = clip.clipError;
    context.clipUpdatedAt = clip.clipUpdatedAt;
  }

  async withWriteLock(callback) {
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(callback);

    return this.writeQueue;
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
    const clip = this.normalizeClip(input);

    return this.withWriteLock(async () => {
      const data = await this.readData();
      data.version = CURRENT_LIBRARY_VERSION;
      const now = new Date().toISOString();
      const existing = data.items.find((item) => {
        const savedNormalized = item.normalizedTerm || item.normalizedWord;
        return savedNormalized === normalizedTerm &&
          (item.sourceLanguage || 'en') === sourceLanguage;
      });

      let item;
      let context;
      let contextAlreadyExists = false;

      if (existing) {
        item = existing;
        item.id = item.id || createId();
        item.term = item.term || item.clickedWord || term;
        item.normalizedTerm = normalizedTerm;
        item.lemma = item.lemma || lemma;
        item.unitType = item.unitType || unitType;
        item.sourceLanguage = sourceLanguage;
        item.timesSaved = Number(item.timesSaved || 1) + 1;
        item.lastSavedAt = now;
        item.surfaceForms = Array.from(new Set([
          ...(item.surfaceForms || item.clickedForms || []),
          term
        ]));
        item.analysis = item.analysis || {
          provider: analysisProvider,
          model: analysisModel,
          confidence
        };
        item.contexts = Array.isArray(item.contexts) ? item.contexts : [];

        context = item.contexts.find((savedContext) =>
          savedContext.sourceSentence === sourceSentence &&
          savedContext.translatedSentence === translatedSentence &&
          savedContext.targetLanguage === targetLanguage &&
          savedContext.videoName === videoName &&
          savedContext.subtitleStartMs === subtitleStartMs &&
          savedContext.subtitleEndMs === subtitleEndMs
        );

        contextAlreadyExists = Boolean(context);

        if (!context) {
          context = {
            id: createId(),
            sourceSentence,
            translatedSentence,
            targetLanguage,
            videoName,
            subtitleStartMs,
            subtitleEndMs,
            savedAt: now
          };
          item.contexts.push(context);
        } else {
          context.id = context.id || createId();
          context.lastSavedAt = now;
        }

        this.applyClipToContext(context, clip);
      } else {
        context = {
          id: createId(),
          sourceSentence,
          translatedSentence,
          targetLanguage,
          videoName,
          subtitleStartMs,
          subtitleEndMs,
          savedAt: now
        };
        this.applyClipToContext(context, clip);

        item = {
          id: createId(),
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
        };
        data.items.push(item);
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
        wasExisting: Boolean(existing),
        contextAlreadyExists,
        itemId: item.id,
        contextId: context.id,
        clipId: context.clipId || null,
        clipStatus: context.clipStatus || null,
        clipPath: context.clipPath || null
      };
    });
  }

  async updateClipStatus(clipId, update) {
    const normalizedClipId = String(clipId || '').trim();
    if (!normalizedClipId) throw new Error('Klip kimliği eksik.');

    return this.withWriteLock(async () => {
      const data = await this.readData();
      const now = new Date().toISOString();
      let affectedContexts = 0;

      for (const item of data.items) {
        for (const context of item.contexts || []) {
          if (context.clipId !== normalizedClipId) continue;

          if (update.status && VALID_CLIP_STATUSES.has(update.status)) {
            context.clipStatus = update.status;
          }
          if (Object.hasOwn(update, 'clipPath')) {
            context.clipPath = update.clipPath ? String(update.clipPath) : null;
          }
          if (Number.isFinite(update.clipStartMs)) {
            context.clipStartMs = Math.max(0, Math.round(update.clipStartMs));
          }
          if (Number.isFinite(update.clipEndMs)) {
            context.clipEndMs = Math.max(0, Math.round(update.clipEndMs));
          }
          if (Object.hasOwn(update, 'error')) {
            context.clipError = update.error ? String(update.error) : null;
          }
          context.clipUpdatedAt = now;
          affectedContexts += 1;
        }
      }

      if (affectedContexts > 0) {
        data.version = CURRENT_LIBRARY_VERSION;
        await this.writeData(data);
      }

      return { affectedContexts };
    });
  }

  async markInterruptedClipJobs() {
    return this.withWriteLock(async () => {
      const data = await this.readData();
      const now = new Date().toISOString();
      let affectedContexts = 0;

      for (const item of data.items) {
        for (const context of item.contexts || []) {
          if (context.clipStatus !== 'processing') continue;
          context.clipStatus = 'failed';
          context.clipError = 'The app closed before the scene clip finished. Save the item again to retry.';
          context.clipUpdatedAt = now;
          affectedContexts += 1;
        }
      }

      if (affectedContexts > 0) {
        data.version = CURRENT_LIBRARY_VERSION;
        await this.writeData(data);
      }

      return { affectedContexts };
    });
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
    const clipStatuses = { ready: 0, processing: 0, failed: 0 };
    const uniqueClipIds = new Set();

    for (const item of data.items) {
      for (const context of item.contexts || []) {
        if (!context.clipId || uniqueClipIds.has(context.clipId)) continue;
        uniqueClipIds.add(context.clipId);
        if (clipStatuses[context.clipStatus] !== undefined) {
          clipStatuses[context.clipStatus] += 1;
        }
      }
    }

    return {
      totalWords: data.items.length,
      totalClips: uniqueClipIds.size,
      clipStatuses,
      filePath: this.filePath
    };
  }
}

module.exports = { LearningLibraryStore, CURRENT_LIBRARY_VERSION };
