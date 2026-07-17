'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeLanguageCode } = require('./settings-store');

const CURRENT_LIBRARY_VERSION = 7;
const VALID_CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN']);
const VALID_CLIP_STATUSES = new Set(['processing', 'ready', 'failed']);

function createId() {
  return globalThis.crypto.randomUUID();
}

function normalizeCefrLevel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_CEFR_LEVELS.has(normalized) ? normalized : 'UNKNOWN';
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
}

function normalizeDictionaryDefinitions(value) {
  const definitions = Array.isArray(value) ? value : [];
  const unique = [];

  for (const definition of definitions) {
    const cleaned = String(definition || '').replace(/\s+/g, ' ').trim();
    if (!cleaned || unique.includes(cleaned)) continue;
    unique.push(cleaned);
    if (unique.length === 2) break;
  }

  return unique;
}


function normalizeStudyHint(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null;
}

function createClozeQuestion(sourceSentence, answer, sourceStart = null, sourceEnd = null) {
  const sentence = String(sourceSentence || '');
  const term = String(answer || '').trim();
  if (!sentence || !term) return sentence;

  if (
    Number.isInteger(sourceStart) &&
    Number.isInteger(sourceEnd) &&
    sourceStart >= 0 &&
    sourceEnd > sourceStart &&
    sourceEnd <= sentence.length
  ) {
    return `${sentence.slice(0, sourceStart)}[...]${sentence.slice(sourceEnd)}`;
  }

  const index = sentence.toLocaleLowerCase('en').indexOf(term.toLocaleLowerCase('en'));
  if (index < 0) return sentence;
  return `${sentence.slice(0, index)}[...]${sentence.slice(index + term.length)}`;
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
        context.cefrLevel = normalizeCefrLevel(context.cefrLevel);
        context.cefrConfidence = normalizeConfidence(context.cefrConfidence);
        context.cefrSource = String(context.cefrSource || '').trim() || null;
        context.dictionaryLemma = String(context.dictionaryLemma || '').trim() || null;
        context.partOfSpeech = String(context.partOfSpeech || '').trim() || null;
        context.wordForm = String(context.wordForm || '').trim() || null;
        context.dictionaryDefinitions = normalizeDictionaryDefinitions(context.dictionaryDefinitions);
        context.studyHint = normalizeStudyHint(context.studyHint);
        context.studyHintLanguage = String(context.studyHintLanguage || '').trim().toLowerCase() === 'en'
          ? 'en'
          : null;
        context.lexicalProvider = String(context.lexicalProvider || '').trim() || null;
        context.lexicalModel = String(context.lexicalModel || '').trim() || null;
        context.lexicalConfidence = normalizeConfidence(context.lexicalConfidence);
        context.studyAnswer = String(context.studyAnswer || '').trim() || item.term || item.lemma || null;
        context.studyQuestion = String(context.studyQuestion || '').trim() || createClozeQuestion(
          context.sourceSentence,
          context.studyAnswer
        );

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
    const cefrLevel = normalizeCefrLevel(input.cefrLevel);
    const cefrConfidence = normalizeConfidence(input.cefrConfidence);
    const cefrSource = String(input.cefrSource || '').trim() || null;
    const dictionaryLemma = String(input.dictionaryLemma || input.lemma || normalizedTerm).trim() || null;
    const partOfSpeech = String(input.partOfSpeech || '').trim() || null;
    const wordForm = String(input.wordForm || '').trim() || null;
    const dictionaryDefinitions = normalizeDictionaryDefinitions(input.dictionaryDefinitions);
    const studyHint = normalizeStudyHint(input.studyHint);
    const studyHintLanguage = String(input.studyHintLanguage || '').trim().toLowerCase() === 'en'
      ? 'en'
      : null;
    const lexicalProvider = String(input.lexicalProvider || '').trim() || null;
    const lexicalModel = String(input.lexicalModel || '').trim() || null;
    const lexicalConfidence = normalizeConfidence(input.lexicalConfidence);
    const studyAnswer = String(input.studyAnswer || term).trim();
    const studyQuestion = String(input.studyQuestion || '').trim() || createClozeQuestion(
      sourceSentence,
      studyAnswer,
      Number.isInteger(input.sourceStart) ? input.sourceStart : null,
      Number.isInteger(input.sourceEnd) ? input.sourceEnd : null
    );
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
            cefrLevel,
            cefrConfidence,
            cefrSource,
            dictionaryLemma,
            partOfSpeech,
            wordForm,
            dictionaryDefinitions,
            studyHint,
            studyHintLanguage,
            lexicalProvider,
            lexicalModel,
            lexicalConfidence,
            studyQuestion,
            studyAnswer,
            savedAt: now
          };
          item.contexts.push(context);
        } else {
          context.id = context.id || createId();
          context.lastSavedAt = now;
          context.cefrLevel = cefrLevel;
          context.cefrConfidence = cefrConfidence;
          context.cefrSource = cefrSource;
          context.dictionaryLemma = dictionaryLemma;
          context.partOfSpeech = partOfSpeech;
          context.wordForm = wordForm;
          context.dictionaryDefinitions = dictionaryDefinitions;
          context.studyHint = studyHint;
          context.studyHintLanguage = studyHintLanguage;
          context.lexicalProvider = lexicalProvider;
          context.lexicalModel = lexicalModel;
          context.lexicalConfidence = lexicalConfidence;
          context.studyQuestion = studyQuestion;
          context.studyAnswer = studyAnswer;
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
          cefrLevel,
          cefrConfidence,
          cefrSource,
          dictionaryLemma,
          partOfSpeech,
          wordForm,
          dictionaryDefinitions,
          studyHint,
          studyHintLanguage,
          lexicalProvider,
          lexicalModel,
          lexicalConfidence,
          studyQuestion,
          studyAnswer,
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
        clipPath: context.clipPath || null,
        cefrLevel: context.cefrLevel || 'UNKNOWN',
        cefrConfidence: context.cefrConfidence ?? null,
        dictionaryDefinitions: context.dictionaryDefinitions || [],
        studyHint: context.studyHint || null,
        studyHintLanguage: context.studyHintLanguage || null,
        partOfSpeech: context.partOfSpeech || null,
        wordForm: context.wordForm || null,
        studyQuestion: context.studyQuestion || null
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

  async getItems() {
    const data = await this.readData();

    return {
      version: data.version,
      items: structuredClone(data.items)
    };
  }

  async deleteItem(itemId) {
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) throw new Error('Silinecek kütüphane öğesinin kimliği eksik.');

    return this.withWriteLock(async () => {
      const data = await this.readData();
      const itemIndex = data.items.findIndex((item) => item.id === normalizedItemId);

      if (itemIndex < 0) {
        throw new Error('Kütüphane öğesi bulunamadı.');
      }

      const [removedItem] = data.items.splice(itemIndex, 1);
      const candidateClipIds = new Set(
        (removedItem.contexts || [])
          .map((context) => context.clipId)
          .filter(Boolean)
      );
      const referencedClipIds = new Set();

      for (const item of data.items) {
        for (const context of item.contexts || []) {
          if (context.clipId) referencedClipIds.add(context.clipId);
        }
      }

      const orphanClipIds = [...candidateClipIds]
        .filter((clipId) => !referencedClipIds.has(clipId));

      data.version = CURRENT_LIBRARY_VERSION;
      await this.writeData(data);

      return {
        totalWords: data.items.length,
        deletedTerm: removedItem.term || removedItem.normalizedTerm || '',
        orphanClipIds
      };
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

module.exports = {
  LearningLibraryStore,
  CURRENT_LIBRARY_VERSION,
  normalizeCefrLevel,
  createClozeQuestion,
  normalizeDictionaryDefinitions,
  normalizeStudyHint
};
