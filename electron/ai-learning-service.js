'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MODEL_ID = 'gemini-3.5-flash';
const ANALYSIS_SCHEMA_VERSION = 2;
const ENRICHMENT_SCHEMA_VERSION = 3;
const AI_ANALYSIS_TIMEOUT_MS = 12000;
const AI_ENRICHMENT_TIMEOUT_MS = 15000;
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN'];
const UNIT_TYPES = [
  'phrasal_verb',
  'idiom',
  'fixed_expression',
  'collocation',
  'compound_term',
  'proper_name'
];

const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'interjection',
  'determiner',
  'numeral',
  'auxiliary',
  'modal',
  'phrasal_verb',
  'idiom',
  'fixed_expression',
  'collocation',
  'compound_term',
  'proper_name',
  'other',
  'unknown'
];

const LOCAL_MULTIWORD_PATTERNS = [
  ['as', 'soon', 'as'],
  ['by', 'the', 'way'],
  ['in', 'spite', 'of'],
  ['look', 'forward', 'to'],
  ['take', 'care', 'of'],
  ['get', 'rid', 'of'],
  ['be', 'supposed', 'to'],
  ['used', 'to'],
  ['have', 'to'],
  ['give', 'up'],
  ['find', 'out'],
  ['figure', 'out'],
  ['pick', 'up'],
  ['put', 'off'],
  ['turn', 'down'],
  ['turn', 'out'],
  ['work', 'out'],
  ['come', 'across'],
  ['run', 'out'],
  ['carry', 'on'],
  ['go', 'on'],
  ['end', 'up'],
  ['make', 'sense'],
  ['of', 'course'],
  ['at', 'least'],
  ['for', 'example'],
  ['right', 'away'],
  ['no', 'matter'],
  ['i’m', 'sorry'],
  ["i'm", 'sorry']
];


function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function normalizeToken(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en');
}

function sanitizeCefrLevel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return CEFR_LEVELS.includes(normalized) ? normalized : 'UNKNOWN';
}

function sanitizeConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function validateTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    throw new Error('Analiz edilecek İngilizce kelime bulunamadı.');
  }

  if (tokens.length > 90) {
    throw new Error('Altyazı AI analizi için fazla uzun.');
  }

  return tokens.map((token, index) => ({
    index,
    text: String(token?.text || '').trim()
  })).filter((token) => token.text);
}

function sanitizeUnits(rawUnits, tokenCount) {
  const candidates = (Array.isArray(rawUnits) ? rawUnits : [])
    .map((unit) => ({
      startToken: Math.trunc(Number(unit?.startToken)),
      endToken: Math.trunc(Number(unit?.endToken)),
      lemma: String(unit?.lemma || '').trim(),
      type: UNIT_TYPES.includes(unit?.type) ? unit.type : 'fixed_expression',
      confidence: sanitizeConfidence(unit?.confidence),
      cefrLevel: sanitizeCefrLevel(unit?.cefrLevel),
      cefrConfidence: sanitizeConfidence(unit?.cefrConfidence)
    }))
    .filter((unit) =>
      Number.isInteger(unit.startToken) &&
      Number.isInteger(unit.endToken) &&
      unit.startToken >= 0 &&
      unit.endToken < tokenCount &&
      unit.endToken > unit.startToken
    )
    .sort((first, second) => {
      const firstLength = first.endToken - first.startToken;
      const secondLength = second.endToken - second.startToken;
      return secondLength - firstLength || second.confidence - first.confidence;
    });

  const occupied = new Set();
  const accepted = [];

  for (const unit of candidates) {
    let overlaps = false;
    for (let index = unit.startToken; index <= unit.endToken; index += 1) {
      if (occupied.has(index)) overlaps = true;
    }
    if (overlaps) continue;

    for (let index = unit.startToken; index <= unit.endToken; index += 1) {
      occupied.add(index);
    }
    accepted.push(unit);
  }

  return accepted.sort((first, second) => first.startToken - second.startToken);
}

function sanitizeWordLevels(rawLevels, tokenCount) {
  const byToken = new Map();

  for (const entry of Array.isArray(rawLevels) ? rawLevels : []) {
    const tokenIndex = Math.trunc(Number(entry?.tokenIndex));
    if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokenCount) continue;
    if (byToken.has(tokenIndex)) continue;

    byToken.set(tokenIndex, {
      tokenIndex,
      lemma: String(entry?.lemma || '').trim(),
      cefrLevel: sanitizeCefrLevel(entry?.cefrLevel),
      cefrConfidence: sanitizeConfidence(entry?.cefrConfidence)
    });
  }

  return [...byToken.values()].sort((first, second) => first.tokenIndex - second.tokenIndex);
}

function createLocalWordLevels(tokens) {
  return tokens.map((token, tokenIndex) => ({
    tokenIndex,
    lemma: normalizeToken(token.text),
    cefrLevel: 'UNKNOWN',
    cefrConfidence: 0
  }));
}

function createLocalFallback(tokens) {
  const normalized = tokens.map((token) => normalizeToken(token.text));
  const units = [];
  const occupied = new Set();
  const patterns = [...LOCAL_MULTIWORD_PATTERNS].sort((a, b) => b.length - a.length);

  for (let start = 0; start < normalized.length; start += 1) {
    if (occupied.has(start)) continue;

    const match = patterns.find((pattern) =>
      pattern.every((part, offset) => normalized[start + offset] === part)
    );

    if (!match) continue;
    const end = start + match.length - 1;
    if (end >= normalized.length) continue;

    for (let index = start; index <= end; index += 1) occupied.add(index);
    units.push({
      startToken: start,
      endToken: end,
      lemma: match.join(' '),
      type: 'fixed_expression',
      confidence: 0.55,
      cefrLevel: 'UNKNOWN',
      cefrConfidence: 0
    });
  }

  return units;
}


function sanitizeDictionaryDefinitions(value) {
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


function sanitizeStudyHint(value, forbiddenTerms = []) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!cleaned) return '';

  const normalizedHint = normalizeToken(cleaned);
  const revealsAnswer = forbiddenTerms.some((term) => {
    const normalizedTerm = normalizeToken(term).trim();
    if (!normalizedTerm || normalizedTerm.length < 3) return false;
    return normalizedHint.includes(normalizedTerm);
  });

  return revealsAnswer ? '' : cleaned;
}

function sanitizePartOfSpeech(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PARTS_OF_SPEECH.includes(normalized) ? normalized : 'unknown';
}

function sanitizeLexicalEnrichment(value, fallback = {}) {
  const lemma = String(value?.lemma || fallback.lemma || fallback.term || '').trim();
  const partOfSpeech = sanitizePartOfSpeech(value?.partOfSpeech || fallback.unitType);
  const wordForm = String(value?.wordForm || '').replace(/\s+/g, ' ').trim();

  return {
    lemma,
    partOfSpeech,
    wordForm,
    dictionaryDefinitions: sanitizeDictionaryDefinitions(value?.dictionaryDefinitions),
    studyHint: sanitizeStudyHint(value?.studyHint, [fallback.term, lemma]),
    studyHintLanguage: 'en',
    confidence: sanitizeConfidence(value?.confidence)
  };
}

function createLocalLexicalFallback(input) {
  const term = String(input?.term || '').trim();
  const lemma = String(input?.lemma || term).trim();
  const unitType = sanitizePartOfSpeech(input?.unitType);
  const sameForm = normalizeToken(term) === normalizeToken(lemma);

  return {
    lemma,
    partOfSpeech: unitType,
    wordForm: unitType === 'unknown'
      ? (sameForm ? 'base or unclassified form' : `inflected form of ${lemma}`)
      : unitType.replaceAll('_', ' '),
    dictionaryDefinitions: [],
    studyHint: '',
    studyHintLanguage: 'en',
    confidence: 0
  };
}

class LearningUnitAnalysisService {
  constructor(cacheFilePath, credentialStore) {
    this.cacheFilePath = cacheFilePath;
    this.credentialStore = credentialStore;
    this.cache = new Map();
    this.loaded = false;
    this.writeQueue = Promise.resolve();
    this.enrichmentCacheFilePath = path.join(path.dirname(cacheFilePath), 'lexical-enrichment-cache.json');
    this.enrichmentCache = new Map();
    this.enrichmentLoaded = false;
    this.enrichmentWriteQueue = Promise.resolve();
    this.clientByKey = new Map();
  }

  cacheKey(sentence) {
    return `v${ANALYSIS_SCHEMA_VERSION}|${MODEL_ID}|${String(sentence || '').replace(/\s+/g, ' ').trim()}`;
  }

  async loadCache() {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const parsed = JSON.parse(await fs.readFile(this.cacheFilePath, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (value && Array.isArray(value.units)) this.cache.set(key, value);
      }
    } catch {
      // The cache is created after the first successful AI analysis.
    }
  }

  async persistCache() {
    await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
    const temporaryPath = `${this.cacheFilePath}.tmp`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(Object.fromEntries(this.cache.entries()), null, 2)}\n`,
      'utf8'
    );

    try {
      await fs.rename(temporaryPath, this.cacheFilePath);
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      await fs.rm(this.cacheFilePath, { force: true });
      await fs.rename(temporaryPath, this.cacheFilePath);
    }
  }

  enrichmentCacheKey(input) {
    const sentence = String(input?.sentence || '').replace(/\s+/g, ' ').trim();
    const term = String(input?.term || '').replace(/\s+/g, ' ').trim();
    return `v${ENRICHMENT_SCHEMA_VERSION}|${MODEL_ID}|${term}|${sentence}`;
  }

  async loadEnrichmentCache() {
    if (this.enrichmentLoaded) return;
    this.enrichmentLoaded = true;

    try {
      const parsed = JSON.parse(await fs.readFile(this.enrichmentCacheFilePath, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (value && Array.isArray(value.dictionaryDefinitions)) {
          this.enrichmentCache.set(key, value);
        }
      }
    } catch {
      // The cache is created after the first successful lexical enrichment.
    }
  }

  async persistEnrichmentCache() {
    await fs.mkdir(path.dirname(this.enrichmentCacheFilePath), { recursive: true });
    const temporaryPath = `${this.enrichmentCacheFilePath}.tmp`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(Object.fromEntries(this.enrichmentCache.entries()), null, 2)}\n`,
      'utf8'
    );

    try {
      await fs.rename(temporaryPath, this.enrichmentCacheFilePath);
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      await fs.rm(this.enrichmentCacheFilePath, { force: true });
      await fs.rename(temporaryPath, this.enrichmentCacheFilePath);
    }
  }

  buildEnrichmentPrompt(input) {
    return `Create concise dictionary metadata for a saved English learning item.\n\nTerm as it appears: ${input.term}\nSuggested lemma: ${input.lemma || input.term}\nDetected unit type: ${input.unitType || 'word'}\nSentence: ${input.sentence}\n\nReturn the dictionary/base lemma, the part of speech in this exact sentence, the grammatical form of the surface term, up to two concise English dictionary definitions, and one short English meaning hint for a cloze study card. The first definition MUST match the meaning used in the sentence. The second definition should be another common, genuinely distinct sense only when useful. The studyHint MUST be written in English, describe only the meaning used in this sentence, and help the learner infer the missing answer. It must not contain the answer term, its lemma, an obvious inflected form, or a translation of the whole sentence. Keep the hint concise, preferably 4 to 14 words. Do not translate the definitions or the hint. Do not add examples, usage notes, markdown, or labels inside the definitions. For wordForm, use descriptions such as "base form", "past tense of transfer", "plural of child", "present participle of run", or "fixed multiword expression".`;
  }

  async enrichWithGemini(input, apiKey) {
    const client = await this.getClient(apiKey);
    const interaction = await withTimeout(
      client.interactions.create({
        model: MODEL_ID,
        input: this.buildEnrichmentPrompt(input),
        store: false,
        generation_config: {
          thinking_level: 'low',
          temperature: 0.1
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: {
              lemma: { type: 'string' },
              partOfSpeech: { type: 'string', enum: PARTS_OF_SPEECH },
              wordForm: { type: 'string' },
              dictionaryDefinitions: {
                type: 'array',
                items: { type: 'string' }
              },
              studyHint: { type: 'string' },
              confidence: { type: 'number' }
            },
            required: ['lemma', 'partOfSpeech', 'wordForm', 'dictionaryDefinitions', 'studyHint', 'confidence']
          }
        }
      }),
      AI_ENRICHMENT_TIMEOUT_MS,
      'Gemini sözlük analizi 15 saniye içinde yanıt vermedi.'
    );

    const parsed = JSON.parse(interaction.output_text || '{}');
    return sanitizeLexicalEnrichment(parsed, input);
  }

  async enrichUnit(input) {
    const term = String(input?.term || '').replace(/\s+/g, ' ').trim();
    const sentence = String(input?.sentence || '').replace(/\s+/g, ' ').trim();
    if (!term) throw new Error('Sözlük bilgisi hazırlanacak kelime veya ifade eksik.');
    if (!sentence) throw new Error('Sözlük bilgisi için cümle bağlamı eksik.');

    const normalizedInput = {
      term,
      sentence,
      lemma: String(input?.lemma || term).trim(),
      unitType: String(input?.unitType || 'word').trim(),
      translatedSentence: String(input?.translatedSentence || '').replace(/\s+/g, ' ').trim(),
      targetLanguage: String(input?.targetLanguage || '').trim()
    };

    await this.loadEnrichmentCache();
    const key = this.enrichmentCacheKey(normalizedInput);
    const cached = this.enrichmentCache.get(key);
    if (cached) return { ...cached, cached: true };

    const apiKey = await this.credentialStore.getApiKey();
    if (!apiKey) {
      return {
        ...createLocalLexicalFallback(normalizedInput),
        provider: 'local-fallback',
        model: null,
        cached: false,
        aiConfigured: false,
        warning: 'Gemini API anahtarı olmadığı için sözlük tanımları hazırlanamadı.'
      };
    }

    try {
      const enrichment = await this.enrichWithGemini(normalizedInput, apiKey);
      const result = {
        ...enrichment,
        provider: 'Gemini',
        model: MODEL_ID,
        aiConfigured: true
      };
      this.enrichmentCache.set(key, result);
      this.enrichmentWriteQueue = this.enrichmentWriteQueue
        .catch(() => undefined)
        .then(() => this.persistEnrichmentCache());
      await this.enrichmentWriteQueue;
      return { ...result, cached: false };
    } catch (error) {
      return {
        ...createLocalLexicalFallback(normalizedInput),
        provider: 'local-fallback',
        model: null,
        cached: false,
        aiConfigured: true,
        warning: `Gemini sözlük analizi başarısız oldu: ${error.message}`
      };
    }
  }

  buildPrompt(sentence, tokens) {
    const indexedTokens = tokens.map((token) => `${token.index}: ${JSON.stringify(token.text)}`).join('\n');

    return `You are analyzing an English subtitle for a language-learning application.\n\nSentence:\n${sentence}\n\nIndexed word tokens:\n${indexedTokens}\n\nComplete both tasks in one response.\n\nTASK 1 — Multiword learning units\nIdentify only multiword lexical units that should be learned together rather than as separate words. Include conventional phrasal verbs, idioms, fixed expressions, strong collocations, compound terms, and proper names. Do not group ordinary compositional noun phrases or arbitrary adjacent words. For example, group "give up", "look forward to", "by the way", and "New York", but do not automatically group "another person" or "old house".\n\nTASK 2 — Contextual CEFR estimates\nEstimate the CEFR vocabulary level for the meaning used in this exact sentence, not merely for the spelling of the word. Return an estimate for every indexed token and for every multiword unit. Use A1, A2, B1, B2, C1, C2, or UNKNOWN. Use UNKNOWN when the sense cannot be judged reliably. Treat the result as a vocabulary/sense estimate, not as a judgment of the whole sentence or the learner.\n\nRules:\n- Multiword token indices are inclusive.\n- Multiword spans must contain at least two tokens and must not overlap.\n- Use the smallest complete meaningful multiword unit.\n- lemma must be the dictionary/base form when reasonable.\n- confidence and cefrConfidence are between 0 and 1.\n- wordLevels must contain one entry for every indexed token.\n- If there are no multiword units, return an empty units array.`;
  }

  async getClient(apiKey) {
    if (this.clientByKey.has(apiKey)) return this.clientByKey.get(apiKey);
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey });
    this.clientByKey.set(apiKey, client);
    return client;
  }

  async analyzeWithGemini(sentence, tokens, apiKey) {
    const client = await this.getClient(apiKey);
    const interaction = await withTimeout(
      client.interactions.create({
        model: MODEL_ID,
        input: this.buildPrompt(sentence, tokens),
        store: false,
        generation_config: {
          thinking_level: 'low',
          temperature: 0.1
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: {
              units: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    startToken: { type: 'integer' },
                    endToken: { type: 'integer' },
                    lemma: { type: 'string' },
                    type: { type: 'string', enum: UNIT_TYPES },
                    confidence: { type: 'number' },
                    cefrLevel: { type: 'string', enum: CEFR_LEVELS },
                    cefrConfidence: { type: 'number' }
                  },
                  required: [
                    'startToken',
                    'endToken',
                    'lemma',
                    'type',
                    'confidence',
                    'cefrLevel',
                    'cefrConfidence'
                  ]
                }
              },
              wordLevels: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    tokenIndex: { type: 'integer' },
                    lemma: { type: 'string' },
                    cefrLevel: { type: 'string', enum: CEFR_LEVELS },
                    cefrConfidence: { type: 'number' }
                  },
                  required: ['tokenIndex', 'lemma', 'cefrLevel', 'cefrConfidence']
                }
              }
            },
            required: ['units', 'wordLevels']
          }
        }
      }),
      AI_ANALYSIS_TIMEOUT_MS,
      'Gemini altyazı analizi 12 saniye içinde yanıt vermedi.'
    );

    const parsed = JSON.parse(interaction.output_text || '{"units":[],"wordLevels":[]}');
    return {
      units: sanitizeUnits(parsed.units, tokens.length),
      wordLevels: sanitizeWordLevels(parsed.wordLevels, tokens.length)
    };
  }

  async analyze(input) {
    const sentence = String(input?.sentence || '').replace(/\s+/g, ' ').trim();
    if (!sentence) throw new Error('Analiz edilecek altyazı metni boş.');
    const tokens = validateTokens(input?.tokens);

    await this.loadCache();
    const key = this.cacheKey(sentence);
    const cached = this.cache.get(key);
    if (cached) {
      return { ...cached, cached: true };
    }

    const apiKey = await this.credentialStore.getApiKey();
    if (!apiKey) {
      return {
        units: createLocalFallback(tokens),
        wordLevels: createLocalWordLevels(tokens),
        provider: 'local-fallback',
        model: null,
        cached: false,
        aiConfigured: false,
        warning: 'Gemini API anahtarı ayarlanmadığı için sınırlı yerel ifade analizi kullanıldı.'
      };
    }

    try {
      const analysis = await this.analyzeWithGemini(sentence, tokens, apiKey);
      const result = {
        units: analysis.units,
        wordLevels: analysis.wordLevels,
        provider: 'Gemini',
        model: MODEL_ID,
        aiConfigured: true
      };
      this.cache.set(key, result);
      this.writeQueue = this.writeQueue.catch(() => undefined).then(() => this.persistCache());
      await this.writeQueue;
      return { ...result, cached: false };
    } catch (error) {
      return {
        units: createLocalFallback(tokens),
        wordLevels: createLocalWordLevels(tokens),
        provider: 'local-fallback',
        model: null,
        cached: false,
        aiConfigured: true,
        warning: `Gemini analizi başarısız oldu; yerel yedek kullanıldı: ${error.message}`
      };
    }
  }

  clearRuntimeClients() {
    this.clientByKey.clear();
  }
}

module.exports = {
  LearningUnitAnalysisService,
  createLocalFallback,
  createLocalWordLevels,
  sanitizeUnits,
  sanitizeWordLevels,
  sanitizeCefrLevel,
  sanitizeDictionaryDefinitions,
  sanitizeStudyHint,
  sanitizeLexicalEnrichment,
  createLocalLexicalFallback,
  CEFR_LEVELS,
  PARTS_OF_SPEECH,
  MODEL_ID,
  withTimeout,
  AI_ANALYSIS_TIMEOUT_MS,
  AI_ENRICHMENT_TIMEOUT_MS
};
