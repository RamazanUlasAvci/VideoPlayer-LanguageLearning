const VALID_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN']);

export function normalizeCefrLevel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_LEVELS.has(normalized) ? normalized : 'UNKNOWN';
}

export function createClozeQuestion(sourceSentence, answer, sourceStart = null, sourceEnd = null) {
  const sentence = String(sourceSentence || '');
  const term = String(answer || '').trim();
  if (!sentence || !term) return sentence;

  if (Number.isInteger(sourceStart) && Number.isInteger(sourceEnd) && sourceStart >= 0 && sourceEnd > sourceStart && sourceEnd <= sentence.length) {
    return `${sentence.slice(0, sourceStart)}[...]${sentence.slice(sourceEnd)}`;
  }

  const index = sentence.toLocaleLowerCase('en').indexOf(term.toLocaleLowerCase('en'));
  if (index < 0) return sentence;
  return `${sentence.slice(0, index)}[...]${sentence.slice(index + term.length)}`;
}

export function validatePortableLibrary(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
    throw new Error('The bundle does not contain a valid learning library.');
  }

  return {
    version: Number.isFinite(Number(value.version)) ? Number(value.version) : 1,
    items: value.items.map((item, itemIndex) => {
      if (!item || typeof item !== 'object') throw new Error(`Invalid library item at index ${itemIndex}.`);
      const term = String(item.term || item.lemma || '').trim();
      if (!term) throw new Error(`Library item ${itemIndex + 1} has no English term.`);
      const contexts = Array.isArray(item.contexts) ? item.contexts : [];
      return {
        ...item,
        id: String(item.id || `item-${itemIndex}`),
        term,
        lemma: String(item.lemma || term),
        unitType: String(item.unitType || 'word'),
        sourceLanguage: String(item.sourceLanguage || 'en'),
        contexts: contexts.map((context, contextIndex) => ({
          ...context,
          id: String(context?.id || `${item.id || itemIndex}-context-${contextIndex}`),
          sourceSentence: String(context?.sourceSentence || ''),
          translatedSentence: String(context?.translatedSentence || ''),
          targetLanguage: String(context?.targetLanguage || 'unknown'),
          cefrLevel: normalizeCefrLevel(context?.cefrLevel),
          dictionaryDefinitions: Array.isArray(context?.dictionaryDefinitions)
            ? context.dictionaryDefinitions.map(String).filter(Boolean).slice(0, 2)
            : [],
          studyAnswer: String(context?.studyAnswer || term),
          studyQuestion: String(context?.studyQuestion || '') || createClozeQuestion(context?.sourceSentence, context?.studyAnswer || term),
          studyHint: context?.studyHint ? String(context.studyHint) : null,
          clipPath: context?.clipPath ? String(context.clipPath).replace(/\\/g, '/') : null,
          clipStatus: String(context?.clipStatus || (context?.clipPath ? 'ready' : 'failed'))
        }))
      };
    })
  };
}

export function flattenLibrary(library) {
  const result = [];
  for (const item of library.items || []) {
    for (const context of item.contexts || []) {
      result.push({ item, context, key: `${item.id}:${context.id}` });
    }
  }
  return result;
}

export function languageLabel(code) {
  const normalized = String(code || '').trim();
  if (!normalized) return 'Unknown';
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' });
    return display.of(normalized) || normalized.toUpperCase();
  } catch {
    return normalized.toUpperCase();
  }
}

export function isSafeBundlePath(value) {
  const path = String(value || '').replace(/\\/g, '/');
  return Boolean(path) && !path.startsWith('/') && !path.includes('../') && !/^[A-Za-z]:/.test(path);
}
