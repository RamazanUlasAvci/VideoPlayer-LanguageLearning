'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MODEL_ID = 'gemini-3.5-flash';
const UNIT_TYPES = [
  'phrasal_verb',
  'idiom',
  'fixed_expression',
  'collocation',
  'compound_term',
  'proper_name'
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

function normalizeToken(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en');
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
      confidence: Math.max(0, Math.min(1, Number(unit?.confidence) || 0))
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
      confidence: 0.55
    });
  }

  return units;
}

class LearningUnitAnalysisService {
  constructor(cacheFilePath, credentialStore) {
    this.cacheFilePath = cacheFilePath;
    this.credentialStore = credentialStore;
    this.cache = new Map();
    this.loaded = false;
    this.writeQueue = Promise.resolve();
    this.clientByKey = new Map();
  }

  cacheKey(sentence) {
    return `${MODEL_ID}|${String(sentence || '').replace(/\s+/g, ' ').trim()}`;
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

  buildPrompt(sentence, tokens) {
    const indexedTokens = tokens.map((token) => `${token.index}: ${JSON.stringify(token.text)}`).join('\n');

    return `You are analyzing an English subtitle for a language-learning application.\n\nSentence:\n${sentence}\n\nIndexed word tokens:\n${indexedTokens}\n\nIdentify only multiword lexical units that should be learned together rather than as separate words. Include conventional phrasal verbs, idioms, fixed expressions, strong collocations, compound terms, and proper names. Do not group ordinary compositional noun phrases or arbitrary adjacent words. For example, group "give up", "look forward to", "by the way", and "New York", but do not automatically group "another person" or "old house".\n\nRules:\n- Return only spans containing at least two tokens.\n- Token indices are inclusive.\n- Spans must not overlap.\n- Use the smallest complete meaningful unit.\n- lemma must be the dictionary/base form when reasonable.\n- confidence is between 0 and 1.\n- If there are no multiword units, return an empty units array.`;
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
    const interaction = await client.interactions.create({
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
                  confidence: { type: 'number' }
                },
                required: ['startToken', 'endToken', 'lemma', 'type', 'confidence']
              }
            }
          },
          required: ['units']
        }
      }
    });

    const parsed = JSON.parse(interaction.output_text || '{"units":[]}');
    return sanitizeUnits(parsed.units, tokens.length);
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
        provider: 'local-fallback',
        model: null,
        cached: false,
        aiConfigured: false,
        warning: 'Gemini API anahtarı ayarlanmadığı için sınırlı yerel ifade analizi kullanıldı.'
      };
    }

    try {
      const units = await this.analyzeWithGemini(sentence, tokens, apiKey);
      const result = {
        units,
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
  sanitizeUnits,
  MODEL_ID
};
