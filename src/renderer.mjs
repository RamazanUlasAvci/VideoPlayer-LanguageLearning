import { findActiveCue, formatMilliseconds, parseSrt } from './srt-parser.mjs';
import { sourceTextForTokenSpan, tokenizeEnglishText } from './text-tokenizer.mjs';

const desktopAPI = window.desktopAPI;

const CUSTOM_LANGUAGE_VALUE = '__custom__';
const COMMON_TARGET_LANGUAGES = [
  'af', 'sq', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca',
  'zh-CN', 'zh-TW', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'tl', 'fi',
  'fr', 'ka', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is', 'id', 'ga',
  'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'ml', 'mr',
  'ne', 'no', 'fa', 'pl', 'pt', 'pt-BR', 'pa', 'ro', 'ru', 'sr',
  'sk', 'sl', 'es', 'sw', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur',
  'vi', 'cy'
];
const languageDisplayNames = new Intl.DisplayNames(['tr', 'en'], { type: 'language' });
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CEFR_LABELS = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
  UNKNOWN: 'Belirlenemedi'
};

const PART_OF_SPEECH_LABELS = {
  noun: 'İsim (noun)',
  verb: 'Fiil (verb)',
  adjective: 'Sıfat (adjective)',
  adverb: 'Zarf (adverb)',
  pronoun: 'Zamir (pronoun)',
  preposition: 'Edat (preposition)',
  conjunction: 'Bağlaç (conjunction)',
  interjection: 'Ünlem (interjection)',
  determiner: 'Belirleyici (determiner)',
  numeral: 'Sayı sözcüğü (numeral)',
  auxiliary: 'Yardımcı fiil (auxiliary)',
  modal: 'Modal fiil',
  phrasal_verb: 'Phrasal verb',
  idiom: 'Deyim (idiom)',
  fixed_expression: 'Sabit ifade',
  collocation: 'Eşdizim (collocation)',
  compound_term: 'Bileşik terim',
  proper_name: 'Özel ad',
  other: 'Diğer',
  unknown: 'Belirlenemedi'
};


const elements = {
  openVideoButton: document.querySelector('#openVideoButton'),
  openSubtitleButton: document.querySelector('#openSubtitleButton'),
  convertVideoButton: document.querySelector('#convertVideoButton'),
  videoFileName: document.querySelector('#videoFileName'),
  subtitleFileName: document.querySelector('#subtitleFileName'),
  targetLanguageSelect: document.querySelector('#targetLanguageSelect'),
  audioOutputSelect: document.querySelector('#audioOutputSelect'),
  chooseAudioOutputButton: document.querySelector('#chooseAudioOutputButton'),
  revealLibraryButton: document.querySelector('#revealLibraryButton'),
  aiSettingsButton: document.querySelector('#aiSettingsButton'),
  aiStatusBadge: document.querySelector('#aiStatusBadge'),
  libraryCount: document.querySelector('#libraryCount'),
  libraryDialog: document.querySelector('#libraryDialog'),
  libraryDialogSummary: document.querySelector('#libraryDialogSummary'),
  exportMobileLibraryButton: document.querySelector('#exportMobileLibraryButton'),
  openLibraryFolderButton: document.querySelector('#openLibraryFolderButton'),
  closeLibraryButton: document.querySelector('#closeLibraryButton'),
  librarySearchInput: document.querySelector('#librarySearchInput'),
  libraryLanguageFilter: document.querySelector('#libraryLanguageFilter'),
  libraryLevelFilter: document.querySelector('#libraryLevelFilter'),
  libraryLoading: document.querySelector('#libraryLoading'),
  libraryEmpty: document.querySelector('#libraryEmpty'),
  libraryNoResults: document.querySelector('#libraryNoResults'),
  libraryList: document.querySelector('#libraryList'),
  playerStage: document.querySelector('#playerStage'),
  videoPlayer: document.querySelector('#videoPlayer'),
  emptyState: document.querySelector('#emptyState'),
  dropOverlay: document.querySelector('#dropOverlay'),
  subtitleOverlay: document.querySelector('#subtitleOverlay'),
  translatedSubtitle: document.querySelector('#translatedSubtitle'),
  sourceSubtitle: document.querySelector('#sourceSubtitle'),
  busyOverlay: document.querySelector('#busyOverlay'),
  busyTitle: document.querySelector('#busyTitle'),
  busyMessage: document.querySelector('#busyMessage'),
  appStatus: document.querySelector('#appStatus'),
  toast: document.querySelector('#toast'),
  translationHint: document.querySelector('#translationHint'),
  languageDialog: document.querySelector('#languageDialog'),
  initialLanguageSelect: document.querySelector('#initialLanguageSelect'),
  customLanguageGroup: document.querySelector('#customLanguageGroup'),
  customLanguageInput: document.querySelector('#customLanguageInput'),
  saveInitialLanguageButton: document.querySelector('#saveInitialLanguageButton'),
  languageDialogError: document.querySelector('#languageDialogError'),
  aiDialog: document.querySelector('#aiDialog'),
  geminiApiKeyInput: document.querySelector('#geminiApiKeyInput'),
  saveAiKeyButton: document.querySelector('#saveAiKeyButton'),
  clearAiKeyButton: document.querySelector('#clearAiKeyButton'),
  closeAiDialogButton: document.querySelector('#closeAiDialogButton'),
  aiDialogStatus: document.querySelector('#aiDialogStatus')
};

const state = {
  selectedVideo: null,
  selectedSubtitle: null,
  subtitleCues: [],
  currentCue: null,
  currentCueKey: null,
  visibleTranslationCueKey: null,
  translationCache: new Map(),
  learningAnalysisCache: new Map(),
  translationRequestToken: 0,
  animationFrameId: null,
  conversionInProgress: false,
  conversionAttemptedAutomatically: false,
  toastTimer: null,
  dragDepth: 0,
  targetLanguage: null,
  aiStatus: { configured: false, source: 'none' },
  libraryItems: [],
  libraryLoading: false,
  expandedLibraryItemId: null
};

function setStatus(message, { error = false } = {}) {
  elements.appStatus.textContent = message;
  elements.appStatus.classList.toggle('error', error);
}

function setBusy(visible, title = '', message = '') {
  elements.busyOverlay.hidden = !visible;
  elements.busyTitle.textContent = title;
  elements.busyMessage.textContent = message;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}


function normalizeLanguageCode(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Bir çeviri dili seçmelisin.');

  try {
    return new Intl.Locale(raw).toString();
  } catch {
    throw new Error('Dil kodu geçerli değil. Örnek: tr, de, ja veya pt-BR.');
  }
}

function normalizeCefrLevel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return CEFR_LEVELS.includes(normalized) ? normalized : 'UNKNOWN';
}

function cefrLabel(value) {
  return CEFR_LABELS[normalizeCefrLevel(value)] || CEFR_LABELS.UNKNOWN;
}

function partOfSpeechLabel(value) {
  const normalized = String(value || 'unknown').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PART_OF_SPEECH_LABELS[normalized] || PART_OF_SPEECH_LABELS.unknown;
}

function createStudyQuestion(sentence, sourceStart, sourceEnd, fallbackTerm) {
  const text = String(sentence || '');
  if (
    Number.isInteger(sourceStart) &&
    Number.isInteger(sourceEnd) &&
    sourceStart >= 0 &&
    sourceEnd > sourceStart &&
    sourceEnd <= text.length
  ) {
    return `${text.slice(0, sourceStart)}[...]${text.slice(sourceEnd)}`;
  }

  const term = String(fallbackTerm || '').trim();
  const index = text.toLocaleLowerCase('en').indexOf(term.toLocaleLowerCase('en'));
  return index >= 0
    ? `${text.slice(0, index)}[...]${text.slice(index + term.length)}`
    : text;
}

function getLanguageName(languageCode) {
  if (!languageCode) return 'seçtiğin dil';

  try {
    return languageDisplayNames.of(languageCode) || languageCode;
  } catch {
    return languageCode;
  }
}

function sortedLanguageCodes() {
  return [...COMMON_TARGET_LANGUAGES].sort((first, second) =>
    getLanguageName(first).localeCompare(getLanguageName(second), 'tr')
  );
}

function appendLanguageOptions(select, { includePlaceholder = false } = {}) {
  select.replaceChildren();

  if (includePlaceholder) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Bir dil seç';
    select.append(placeholder);
  }

  for (const languageCode of sortedLanguageCodes()) {
    const option = document.createElement('option');
    option.value = languageCode;
    option.textContent = `${getLanguageName(languageCode)} (${languageCode})`;
    select.append(option);
  }

  const customOption = document.createElement('option');
  customOption.value = CUSTOM_LANGUAGE_VALUE;
  customOption.textContent = 'Başka bir dil kodu…';
  select.append(customOption);
}

function ensureLanguageOption(select, languageCode) {
  if (!languageCode) return;

  const alreadyExists = Array.from(select.options)
    .some((option) => option.value === languageCode);

  if (alreadyExists) return;

  const customOption = Array.from(select.options)
    .find((option) => option.value === CUSTOM_LANGUAGE_VALUE);
  const option = document.createElement('option');
  option.value = languageCode;
  option.textContent = `${getLanguageName(languageCode)} (${languageCode})`;
  select.insertBefore(option, customOption || null);
}

function syncLanguageControls(languageCode) {
  ensureLanguageOption(elements.targetLanguageSelect, languageCode);
  ensureLanguageOption(elements.initialLanguageSelect, languageCode);
  elements.targetLanguageSelect.value = languageCode || '';
  elements.initialLanguageSelect.value = languageCode || '';
}

function updateTranslationLanguageText() {
  const languageName = getLanguageName(state.targetLanguage);
  elements.translationHint.innerHTML = `O anki altyazıyı <strong>${languageName}</strong> diline çevirmek için <kbd>T</kbd> tuşuna bas.`;
}

function showLanguageDialog() {
  elements.languageDialogError.hidden = true;
  elements.languageDialogError.textContent = '';
  elements.initialLanguageSelect.value = state.targetLanguage || '';
  elements.customLanguageGroup.hidden = true;
  elements.customLanguageInput.value = '';
  elements.saveInitialLanguageButton.disabled = !state.targetLanguage;

  if (!elements.languageDialog.open) {
    elements.languageDialog.showModal();
  }
}

async function setTargetLanguage(languageCode, { persist = true, announce = true } = {}) {
  const normalizedLanguage = normalizeLanguageCode(languageCode);

  if (persist) {
    await desktopAPI.setTargetLanguage(normalizedLanguage);
  }

  const changed = state.targetLanguage !== normalizedLanguage;
  state.targetLanguage = normalizedLanguage;
  syncLanguageControls(normalizedLanguage);
  updateTranslationLanguageText();

  if (changed) {
    state.translationCache.clear();
    resetTranslationDisplay();
  }

  if (announce) {
    const languageName = getLanguageName(normalizedLanguage);
    setStatus(`Çeviri dili ${languageName} olarak ayarlandı.`);
    showToast(`Çeviri dili: ${languageName}`);
  }
}

async function loadTranslationPreference() {
  const preferences = await desktopAPI.getPreferences();

  if (preferences?.targetLanguage) {
    await setTargetLanguage(preferences.targetLanguage, { persist: false, announce: false });
    setStatus(`Çeviri dili: ${getLanguageName(preferences.targetLanguage)}.`);
    return;
  }

  updateTranslationLanguageText();
  showLanguageDialog();
}

function selectedInitialLanguageCode() {
  if (elements.initialLanguageSelect.value !== CUSTOM_LANGUAGE_VALUE) {
    return elements.initialLanguageSelect.value;
  }

  return elements.customLanguageInput.value;
}

function updateInitialLanguageButton() {
  const usesCustomCode = elements.initialLanguageSelect.value === CUSTOM_LANGUAGE_VALUE;
  elements.customLanguageGroup.hidden = !usesCustomCode;
  elements.saveInitialLanguageButton.disabled = usesCustomCode
    ? !elements.customLanguageInput.value.trim()
    : !elements.initialLanguageSelect.value;
}

function updateAiStatusDisplay(status) {
  state.aiStatus = status || { configured: false, source: 'none' };
  const configured = Boolean(state.aiStatus.configured);
  elements.aiStatusBadge.textContent = configured ? 'AI Açık' : 'AI Kapalı';
  elements.aiStatusBadge.classList.toggle('configured', configured);
  elements.aiSettingsButton.title = configured
    ? 'Gemini ifade analizi yapılandırıldı'
    : 'Gemini API anahtarını ayarla';
  elements.clearAiKeyButton.disabled = !configured || state.aiStatus.source === 'environment';
  elements.aiDialogStatus.textContent = configured
    ? (state.aiStatus.source === 'environment'
      ? 'Gemini anahtarı GEMINI_API_KEY ortam değişkeninden okunuyor.'
      : 'Gemini anahtarı işletim sisteminin güvenli deposunda saklanıyor.')
    : 'Anahtar eklenmezse uygulama sınırlı yerel ifade algılama kullanır.';
}

async function loadAiStatus() {
  try {
    updateAiStatusDisplay(await desktopAPI.getAiStatus());
  } catch (error) {
    updateAiStatusDisplay({ configured: false, source: 'none' });
    setStatus(`AI durumu okunamadı: ${error.message}`, { error: true });
  }
}

function showAiDialog() {
  elements.geminiApiKeyInput.value = '';
  elements.aiDialogStatus.classList.remove('error');
  if (!elements.aiDialog.open) elements.aiDialog.showModal();
}

function cueKey(cue) {
  if (!cue) return null;
  return `${cue.startMs}:${cue.endMs}:${cue.text}`;
}

function translationKey(cue) {
  const key = cueKey(cue);
  return key && state.targetLanguage ? `${state.targetLanguage}|${key}` : null;
}

function renderPlainSource(cue = state.currentCue) {
  elements.sourceSubtitle.replaceChildren();
  elements.sourceSubtitle.textContent = cue?.text || '';
  elements.sourceSubtitle.classList.remove('learning-enabled');
}

function resetTranslationDisplay() {
  state.visibleTranslationCueKey = null;
  state.translationRequestToken += 1;
  elements.translatedSubtitle.hidden = true;
  elements.translatedSubtitle.replaceChildren();
  renderPlainSource();
}

function updateSubtitleForCurrentTime() {
  const timeMs = Math.round(elements.videoPlayer.currentTime * 1000);
  const cue = findActiveCue(state.subtitleCues, timeMs);
  const nextCueKey = cueKey(cue);

  if (nextCueKey !== state.currentCueKey) {
    state.currentCue = cue;
    state.currentCueKey = nextCueKey;
    resetTranslationDisplay();
  }

  if (!cue) {
    elements.subtitleOverlay.hidden = true;
    elements.sourceSubtitle.textContent = '';
    return;
  }

  renderPlainSource(cue);
  elements.subtitleOverlay.hidden = false;
}

function runSubtitleLoop() {
  updateSubtitleForCurrentTime();

  if (!elements.videoPlayer.paused && !elements.videoPlayer.ended) {
    state.animationFrameId = window.requestAnimationFrame(runSubtitleLoop);
  }
}

function startSubtitleLoop() {
  window.cancelAnimationFrame(state.animationFrameId);
  runSubtitleLoop();
}

function stopSubtitleLoop() {
  window.cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = null;
  updateSubtitleForCurrentTime();
}

function applyVideoSelection(selected) {
  state.selectedVideo = selected;
  state.conversionAttemptedAutomatically = false;
  elements.videoFileName.textContent = selected.fileName;
  elements.videoFileName.title = selected.fileName;
  elements.convertVideoButton.disabled = false;
  elements.emptyState.hidden = true;
  resetTranslationDisplay();

  elements.videoPlayer.pause();
  elements.videoPlayer.src = selected.fileUrl;
  elements.videoPlayer.load();

  setStatus(`${selected.fileName} açılıyor...`);
}

function applySubtitleSelection(selected) {
  const cues = parseSrt(selected.content);
  if (cues.length === 0) {
    throw new Error('SRT içinde geçerli zaman kodlu altyazı bulunamadı.');
  }

  state.selectedSubtitle = selected;
  state.subtitleCues = cues;
  state.currentCue = null;
  state.currentCueKey = null;
  state.translationCache.clear();
  state.learningAnalysisCache.clear();
  resetTranslationDisplay();

  elements.subtitleFileName.textContent = selected.fileName;
  elements.subtitleFileName.title = selected.fileName;
  updateSubtitleForCurrentTime();

  setStatus(`${cues.length} altyazı satırı yüklendi.`);
}

async function openVideo() {
  try {
    const selected = await desktopAPI.openVideo();
    if (!selected) return;
    applyVideoSelection(selected);
  } catch (error) {
    setStatus(`Video açılamadı: ${error.message}`, { error: true });
  }
}

async function openSubtitle() {
  try {
    const selected = await desktopAPI.openSubtitle();
    if (!selected) return;
    applySubtitleSelection(selected);
  } catch (error) {
    setStatus(`Altyazı açılamadı: ${error.message}`, { error: true });
  }
}

function renderTranslation(translatedText) {
  elements.translatedSubtitle.replaceChildren();
  elements.translatedSubtitle.textContent = translatedText;
  elements.translatedSubtitle.hidden = false;
}

function buildLearningUnits(cue, tokenization, analysis) {
  const unitsByToken = new Map();
  const multiwordUnits = Array.isArray(analysis?.units) ? analysis.units : [];
  const wordLevels = new Map(
    (Array.isArray(analysis?.wordLevels) ? analysis.wordLevels : [])
      .map((entry) => [Number(entry.tokenIndex), entry])
  );

  for (const token of tokenization.wordTokens) {
    const wordLevel = wordLevels.get(token.index);
    unitsByToken.set(token.index, {
      id: `word-${token.index}`,
      startToken: token.index,
      endToken: token.index,
      sourceStart: token.start,
      sourceEnd: token.end,
      term: token.text,
      lemma: wordLevel?.lemma || token.text.toLocaleLowerCase('en'),
      unitType: 'word',
      confidence: null,
      cefrLevel: normalizeCefrLevel(wordLevel?.cefrLevel),
      cefrConfidence: Number.isFinite(wordLevel?.cefrConfidence)
        ? wordLevel.cefrConfidence
        : null
    });
  }

  for (const unit of multiwordUnits) {
    const term = sourceTextForTokenSpan(
      cue.text,
      tokenization.wordTokens,
      unit.startToken,
      unit.endToken
    );
    if (!term) continue;

    const normalizedUnit = {
      id: `unit-${unit.startToken}-${unit.endToken}`,
      startToken: unit.startToken,
      endToken: unit.endToken,
      sourceStart: tokenization.wordTokens[unit.startToken]?.start ?? null,
      sourceEnd: tokenization.wordTokens[unit.endToken]?.end ?? null,
      term,
      lemma: unit.lemma || term.toLocaleLowerCase('en'),
      unitType: unit.type || 'fixed_expression',
      confidence: Number.isFinite(unit.confidence) ? unit.confidence : null,
      cefrLevel: normalizeCefrLevel(unit.cefrLevel),
      cefrConfidence: Number.isFinite(unit.cefrConfidence)
        ? unit.cefrConfidence
        : null
    };

    for (let index = unit.startToken; index <= unit.endToken; index += 1) {
      unitsByToken.set(index, normalizedUnit);
    }
  }

  return unitsByToken;
}

function setUnitHover(unitId, enabled) {
  elements.sourceSubtitle
    .querySelectorAll(`[data-unit-id="${CSS.escape(unitId)}"]`)
    .forEach((button) => button.classList.toggle('unit-hover', enabled));
}

function setUnitSaved(unitId) {
  elements.sourceSubtitle
    .querySelectorAll(`[data-unit-id="${CSS.escape(unitId)}"]`)
    .forEach((button) => button.classList.add('saved'));
}

async function saveLearningUnit(unit, cue, translatedText, analysis) {
  showToast(`“${unit.term}” için sözlük bilgileri hazırlanıyor…`);

  let lexical = {
    lemma: unit.lemma,
    partOfSpeech: unit.unitType === 'word' ? 'unknown' : unit.unitType,
    wordForm: '',
    dictionaryDefinitions: [],
    studyHint: '',
    studyHintLanguage: 'en',
    provider: 'local-fallback',
    model: null,
    confidence: 0,
    warning: null
  };

  try {
    lexical = await desktopAPI.enrichLearningUnit({
      term: unit.term,
      lemma: unit.lemma,
      unitType: unit.unitType,
      sentence: cue.text,
      translatedSentence: translatedText
    });
  } catch (error) {
    lexical.warning = `Sözlük bilgileri hazırlanamadı: ${error.message}`;
  }

  const studyQuestion = createStudyQuestion(
    cue.text,
    unit.sourceStart,
    unit.sourceEnd,
    unit.term
  );

  const result = await desktopAPI.saveLearningUnit({
    term: unit.term,
    lemma: lexical.lemma || unit.lemma,
    normalizedTerm: lexical.lemma || unit.lemma,
    unitType: unit.unitType,
    sourceSentence: cue.text,
    translatedSentence: translatedText,
    videoName: state.selectedVideo?.fileName || '',
    videoPath: state.selectedVideo?.filePath || '',
    subtitleStartMs: cue.startMs,
    subtitleEndMs: cue.endMs,
    confidence: unit.confidence,
    analysisProvider: analysis?.provider || 'unknown',
    analysisModel: analysis?.model || null,
    cefrLevel: unit.cefrLevel,
    cefrConfidence: unit.cefrConfidence,
    cefrSource: analysis?.provider === 'Gemini'
      ? 'gemini-context-estimate'
      : 'local-fallback',
    dictionaryLemma: lexical.lemma || unit.lemma,
    partOfSpeech: lexical.partOfSpeech || null,
    wordForm: lexical.wordForm || null,
    dictionaryDefinitions: lexical.dictionaryDefinitions || [],
    studyHint: lexical.studyHint || '',
    studyHintLanguage: lexical.studyHintLanguage || 'en',
    lexicalProvider: lexical.provider || 'unknown',
    lexicalModel: lexical.model || null,
    lexicalConfidence: lexical.confidence,
    studyQuestion,
    studyAnswer: unit.term,
    sourceStart: unit.sourceStart,
    sourceEnd: unit.sourceEnd,
    sourceLanguage: 'en',
    targetLanguage: state.targetLanguage
  });

  elements.libraryCount.textContent = String(result.totalWords);
  setUnitSaved(unit.id);

  if (lexical.warning) {
    setStatus(lexical.warning, { error: lexical.aiConfigured });
  }

  if (result.clipStatus === 'ready') {
    showToast(
      result.wasExisting
        ? `“${unit.term}” yeniden kaydedildi; sözlük bilgisi ve sahne klibi hazır.`
        : `“${unit.term}” sözlük bilgisi ve sahne klibiyle eklendi.`
    );
    return;
  }

  showToast(
    result.wasExisting
      ? `“${unit.term}” yeniden kaydedildi; sahne klibi hazırlanıyor…`
      : `“${unit.term}” kaydedildi; sahne klibi hazırlanıyor…`
  );
}

function renderClickableSource(cue, translatedText, analysis) {
  const tokenization = tokenizeEnglishText(cue.text);
  const unitsByToken = buildLearningUnits(cue, tokenization, analysis);
  elements.sourceSubtitle.replaceChildren();
  elements.sourceSubtitle.classList.add('learning-enabled');

  for (const segment of tokenization.segments) {
    if (!segment.isWord) {
      elements.sourceSubtitle.append(document.createTextNode(segment.text));
      continue;
    }

    const unit = unitsByToken.get(segment.tokenIndex);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-learning-token';
    button.textContent = segment.text;
    button.dataset.unitId = unit.id;
    const levelHint = unit.cefrLevel && unit.cefrLevel !== 'UNKNOWN'
      ? ` · Tahmini CEFR: ${unit.cefrLevel}`
      : '';
    button.title = unit.startToken === unit.endToken
      ? `İngilizce kelimeyi kaydet: ${unit.term}${levelHint}`
      : `İfadeyi birlikte kaydet: ${unit.term}${levelHint}`;

    if (unit.startToken !== unit.endToken) {
      button.classList.add('multiword-unit');
    }

    button.addEventListener('mouseenter', () => setUnitHover(unit.id, true));
    button.addEventListener('mouseleave', () => setUnitHover(unit.id, false));
    button.addEventListener('focus', () => setUnitHover(unit.id, true));
    button.addEventListener('blur', () => setUnitHover(unit.id, false));
    button.addEventListener('click', async () => {
      const relatedButtons = elements.sourceSubtitle.querySelectorAll(
        `[data-unit-id="${CSS.escape(unit.id)}"]`
      );
      relatedButtons.forEach((item) => { item.disabled = true; });

      try {
        await saveLearningUnit(unit, cue, translatedText, analysis);
      } catch (error) {
        showToast(`Kayıt başarısız: ${error.message}`);
      } finally {
        relatedButtons.forEach((item) => { item.disabled = false; });
      }
    });

    elements.sourceSubtitle.append(button);
  }
}

function analysisTokensForCue(cue) {
  return tokenizeEnglishText(cue.text).wordTokens.map((token) => ({ text: token.text }));
}


async function toggleCurrentTranslation() {
  if (!state.targetLanguage) {
    showLanguageDialog();
    showToast('Önce bir çeviri dili seç.');
    return;
  }

  const cue = state.currentCue;
  if (!cue) {
    showToast('Bu saniyede çevrilecek bir altyazı yok.');
    return;
  }

  const key = translationKey(cue);

  if (state.visibleTranslationCueKey === key && !elements.translatedSubtitle.hidden) {
    resetTranslationDisplay();
    setStatus('Çeviri ve öğrenme seçimi gizlendi.');
    return;
  }

  const cachedTranslation = state.translationCache.get(key);
  const cachedAnalysis = state.learningAnalysisCache.get(cueKey(cue));
  if (cachedTranslation && cachedAnalysis) {
    state.visibleTranslationCueKey = key;
    renderTranslation(cachedTranslation);
    renderClickableSource(cue, cachedTranslation, cachedAnalysis);
    setStatus('Çeviri ve öğrenme birimleri yerel önbellekten gösterildi.');
    return;
  }

  const requestToken = ++state.translationRequestToken;
  state.visibleTranslationCueKey = key;
  elements.translatedSubtitle.hidden = false;
  elements.translatedSubtitle.textContent = 'Çevriliyor ve İngilizce ifade yapısı analiz ediliyor…';
  renderPlainSource(cue);
  setStatus(`Altyazı ${getLanguageName(state.targetLanguage)} diline çevriliyor ve öğrenme birimleri analiz ediliyor...`);

  try {
    const translationPromise = cachedTranslation
      ? Promise.resolve({ translatedText: cachedTranslation, cached: true, provider: 'memory-cache' })
      : desktopAPI.translateSubtitle(cue.text);
    const analysisPromise = cachedAnalysis
      ? Promise.resolve(cachedAnalysis)
      : desktopAPI.analyzeLearningUnits(cue.text, analysisTokensForCue(cue));

    // Translation and AI analysis are intentionally not awaited together. A slow or
    // unavailable Gemini request must never prevent the user from seeing the translation.
    const translationResult = await translationPromise;

    if (requestToken !== state.translationRequestToken || translationKey(state.currentCue) !== key) {
      return;
    }

    state.translationCache.set(key, translationResult.translatedText);
    renderTranslation(translationResult.translatedText);
    renderPlainSource(cue);
    setStatus('Çeviri hazır · İngilizce öğrenme birimleri analiz ediliyor...');

    const analysisResult = await analysisPromise;

    if (requestToken !== state.translationRequestToken || translationKey(state.currentCue) !== key) {
      return;
    }

    state.learningAnalysisCache.set(cueKey(cue), analysisResult);
    renderClickableSource(cue, translationResult.translatedText, analysisResult);

    if (analysisResult.warning) {
      setStatus(analysisResult.warning, { error: analysisResult.aiConfigured });
      showToast(
        analysisResult.aiConfigured
          ? 'AI analizi zaman aşımına uğradı veya başarısız oldu; yerel ifade algılama kullanıldı.'
          : 'AI anahtarı yok; sınırlı yerel ifade algılama kullanılıyor.'
      );
    } else {
      const analysisLabel = analysisResult.cached
        ? 'AI analiz önbelleği'
        : `${analysisResult.provider}${analysisResult.model ? ` / ${analysisResult.model}` : ''}`;
      setStatus(`Çeviri hazır · İngilizce kelime veya ifadeye tıklayarak kaydet · ${analysisLabel}.`);
    }
  } catch (error) {
    if (requestToken !== state.translationRequestToken) return;
    resetTranslationDisplay();
    setStatus(`Çeviri veya analiz başarısız: ${error.message}`, { error: true });
    showToast('İnternet bağlantısını ve AI ayarlarını kontrol et.');
  }
}


async function refreshAudioOutputs(preferredDeviceId = null) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    elements.audioOutputSelect.disabled = true;
    elements.chooseAudioOutputButton.disabled = true;
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    const currentValue = preferredDeviceId ?? elements.audioOutputSelect.value;

    elements.audioOutputSelect.replaceChildren();

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Sistem varsayılanı';
    elements.audioOutputSelect.append(defaultOption);

    outputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Ses çıkışı ${index + 1}`;
      elements.audioOutputSelect.append(option);
    });

    const matchingOption = Array.from(elements.audioOutputSelect.options)
      .some((option) => option.value === currentValue);
    elements.audioOutputSelect.value = matchingOption ? currentValue : '';
  } catch (error) {
    setStatus(`Ses cihazları listelenemedi: ${error.message}`, { error: true });
  }
}

async function applyAudioOutput(deviceId) {
  if (typeof elements.videoPlayer.setSinkId !== 'function') {
    throw new Error('Bu Electron sürümünde ses çıkışı değiştirme desteklenmiyor.');
  }

  await elements.videoPlayer.setSinkId(deviceId || '');
  localStorage.setItem('preferredAudioOutputId', deviceId || '');
  setStatus(deviceId ? 'Seçilen ses çıkışı kullanılıyor.' : 'Sistem varsayılan ses çıkışı kullanılıyor.');
}

async function chooseAudioOutput() {
  try {
    if (typeof navigator.mediaDevices?.selectAudioOutput !== 'function') {
      await refreshAudioOutputs();
      elements.audioOutputSelect.focus();
      showToast('Listeden izin verilmiş bir ses çıkışı seçebilirsin.');
      return;
    }

    const previousId = localStorage.getItem('preferredAudioOutputId') || undefined;
    const selected = await navigator.mediaDevices.selectAudioOutput(
      previousId ? { deviceId: previousId } : undefined
    );

    await applyAudioOutput(selected.deviceId);
    await refreshAudioOutputs(selected.deviceId);
    showToast(`Ses çıkışı: ${selected.label || 'Seçilen cihaz'}`);
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      setStatus('Ses çıkışı seçimi iptal edildi.');
      return;
    }
    setStatus(`Ses çıkışı değiştirilemedi: ${error.message}`, { error: true });
  }
}

async function convertCurrentVideo({ automatic = false } = {}) {
  if (!state.selectedVideo || state.conversionInProgress) return;

  state.conversionInProgress = true;
  elements.convertVideoButton.disabled = true;
  setBusy(
    true,
    'Video uyumlu hâle getiriliyor',
    'Bu işlem yalnızca bilgisayarında çalışır; video hiçbir yere yüklenmez.'
  );
  setStatus('FFmpeg ile H.264/AAC MP4 hazırlanıyor...');

  try {
    const converted = await desktopAPI.convertVideo(state.selectedVideo.filePath);
    elements.videoPlayer.pause();
    elements.videoPlayer.src = converted.fileUrl;
    elements.videoPlayer.load();
    setStatus(converted.cached ? 'Daha önce hazırlanmış uyumlu video açıldı.' : 'Uyumlu video hazır.');

    if (!automatic) showToast('Uyumlu MP4 sürümü açıldı.');
  } catch (error) {
    setStatus(`Video dönüştürülemedi: ${error.message}`, { error: true });
    showToast('Dönüşüm başarısız oldu. Ayrıntı alt durum çubuğunda.');
  } finally {
    state.conversionInProgress = false;
    elements.convertVideoButton.disabled = !state.selectedVideo;
    setBusy(false);
  }
}

async function loadLibrarySummary() {
  try {
    const summary = await desktopAPI.getLibrarySummary();
    elements.libraryCount.textContent = String(summary.totalWords);
  } catch (error) {
    setStatus(`Kütüphane açılamadı: ${error.message}`, { error: true });
  }
}

const LIBRARY_TYPE_LABELS = {
  word: 'Kelime',
  phrasal_verb: 'Phrasal verb',
  idiom: 'Idiom',
  fixed_expression: 'Sabit ifade'
};


function libraryTypeLabel(unitType) {
  return LIBRARY_TYPE_LABELS[unitType] || 'Diğer';
}

function cefrLevelsForContexts(contexts) {
  const order = [...CEFR_LEVELS, 'UNKNOWN'];
  return Array.from(new Set((contexts || []).map((context) => normalizeCefrLevel(context.cefrLevel))))
    .sort((first, second) => order.indexOf(first) - order.indexOf(second));
}

function cefrSummaryForContexts(contexts) {
  const levels = cefrLevelsForContexts(contexts);
  if (levels.length === 0) return { text: CEFR_LABELS.UNKNOWN, className: 'unknown' };
  if (levels.length === 1) {
    const level = levels[0];
    return { text: cefrLabel(level), className: level.toLocaleLowerCase('en') };
  }

  const knownLevels = levels.filter((level) => level !== 'UNKNOWN');
  if (knownLevels.length === 0) return { text: CEFR_LABELS.UNKNOWN, className: 'unknown' };
  return {
    text: knownLevels.join(' / '),
    className: 'mixed'
  };
}

function cefrEstimateMeta(context) {
  const level = normalizeCefrLevel(context.cefrLevel);
  if (level === 'UNKNOWN') return 'CEFR: Belirlenemedi';

  const confidence = Number.isFinite(context.cefrConfidence)
    ? ` · %${Math.round(context.cefrConfidence * 100)} güven`
    : '';
  return `CEFR: ${level} · AI tahmini${confidence}`;
}

function formatSavedDate(value) {
  if (!value) return 'Tarih bilinmiyor';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Tarih bilinmiyor';

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function appendMeta(container, text) {
  if (!text) return;
  const span = document.createElement('span');
  span.textContent = text;
  container.append(span);
}

function clipFilterStatus(context) {
  if (!context?.clipId) return 'missing';
  return context.clipStatus || 'missing';
}

function libraryLanguageKey(value) {
  if (!value) return '';

  try {
    return normalizeLanguageCode(value).toLocaleLowerCase('en');
  } catch {
    return String(value).trim().toLocaleLowerCase('en');
  }
}

function selectedLibraryLanguage() {
  return elements.libraryLanguageFilter.value || 'all';
}

function selectedLibraryLevel() {
  return elements.libraryLevelFilter.value || 'all';
}

function contextMatchesLibraryFilters(context) {
  const languageFilter = selectedLibraryLanguage();
  const levelFilter = selectedLibraryLevel();

  const languageMatches = languageFilter === 'all' ||
    libraryLanguageKey(context.targetLanguage) === libraryLanguageKey(languageFilter);
  const levelMatches = levelFilter === 'all' ||
    normalizeCefrLevel(context.cefrLevel) === normalizeCefrLevel(levelFilter);

  return languageMatches && levelMatches;
}

function contextsForLibraryFilters(item) {
  return (item.contexts || []).filter(contextMatchesLibraryFilters);
}

function refreshLibraryLanguageFilterOptions() {
  const previousValue = selectedLibraryLanguage();
  const languageCodes = new Map();

  for (const item of state.libraryItems) {
    for (const context of item.contexts || []) {
      const normalizedKey = libraryLanguageKey(context.targetLanguage);
      if (!normalizedKey || languageCodes.has(normalizedKey)) continue;
      languageCodes.set(normalizedKey, String(context.targetLanguage).trim());
    }
  }

  elements.libraryLanguageFilter.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'Tüm diller';
  elements.libraryLanguageFilter.append(allOption);

  const sortedCodes = [...languageCodes.values()].sort((first, second) =>
    getLanguageName(first).localeCompare(getLanguageName(second), 'tr')
  );

  for (const languageCode of sortedCodes) {
    const option = document.createElement('option');
    option.value = languageCode;
    option.textContent = `${getLanguageName(languageCode)} (${languageCode})`;
    elements.libraryLanguageFilter.append(option);
  }

  const canRestorePreviousValue = Array.from(elements.libraryLanguageFilter.options)
    .some((option) => libraryLanguageKey(option.value) === libraryLanguageKey(previousValue));

  elements.libraryLanguageFilter.value = canRestorePreviousValue ? previousValue : 'all';
}

function itemMatchesLibraryFilters(item) {
  const query = elements.librarySearchInput.value.trim().toLocaleLowerCase('en');
  const matchingContexts = contextsForLibraryFilters(item);

  if (matchingContexts.length === 0) return false;
  if (!query) return true;

  const searchableText = [
    item.term,
    item.lemma,
    item.normalizedTerm,
    ...(item.surfaceForms || []),
    ...matchingContexts.flatMap((context) => [
      context.sourceSentence,
      context.translatedSentence,
      context.videoName,
      context.targetLanguage,
      getLanguageName(context.targetLanguage),
      normalizeCefrLevel(context.cefrLevel),
      cefrLabel(context.cefrLevel),
      context.dictionaryLemma,
      context.partOfSpeech,
      context.wordForm,
      ...(context.dictionaryDefinitions || []),
      context.studyQuestion,
      context.studyAnswer
    ])
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase('en');

  return searchableText.includes(query);
}

async function prepareLibraryClipPlayback(video) {
  elements.videoPlayer.pause();
  elements.libraryList.querySelectorAll('.library-clip-video').forEach((otherVideo) => {
    if (otherVideo !== video && !otherVideo.paused) otherVideo.pause();
  });

  const selectedDeviceId = elements.audioOutputSelect.value || '';
  if (selectedDeviceId && typeof video.setSinkId === 'function') {
    try {
      await video.setSinkId(selectedDeviceId);
    } catch (error) {
      setStatus(`Kütüphane klibinin ses çıkışı değiştirilemedi: ${error.message}`, { error: true });
    }
  }
}

function createLibraryClipPanel(context) {
  const panel = document.createElement('div');
  panel.className = 'library-clip-panel';
  const status = clipFilterStatus(context);

  if (status === 'ready' && context.clipUrl) {
    const video = document.createElement('video');
    video.className = 'library-clip-video';
    video.controls = true;
    video.preload = 'metadata';
    video.src = context.clipUrl;
    video.addEventListener('play', () => prepareLibraryClipPlayback(video));
    video.addEventListener('error', () => {
      setStatus('Kütüphane klibi açılamadı. Dosya silinmiş veya bozulmuş olabilir.', { error: true });
    });
    panel.append(video);
    return panel;
  }

  const statusBox = document.createElement('div');
  statusBox.className = `library-clip-status ${status}`;
  const badge = document.createElement('span');
  badge.className = 'library-clip-badge';

  const title = document.createElement('strong');
  const description = document.createElement('span');

  if (status === 'processing') {
    badge.textContent = 'Hazırlanıyor';
    title.textContent = 'Sahne klibi arka planda hazırlanıyor';
    description.textContent = 'Hazır olduğunda bu ekran otomatik olarak güncellenecek.';
  } else if (status === 'failed') {
    badge.textContent = 'Klip hatası';
    title.textContent = 'Kelime kaydedildi, fakat klip oluşturulamadı';
    description.textContent = 'Aynı kelimeyi sahnede yeniden kaydetmek klibi tekrar deneyecektir.';
  } else if (status === 'ready') {
    badge.textContent = 'Dosya bulunamadı';
    title.textContent = 'Klip kaydı var, ancak medya dosyası açılamıyor';
    description.textContent = 'library-media klasöründeki dosya taşınmış veya silinmiş olabilir.';
  } else {
    badge.textContent = 'Klipsiz';
    title.textContent = 'Bu eski kayda sahne klibi eklenmemiş';
    description.textContent = 'Kelimeyi videoda yeniden kaydederek klip oluşturabilirsin.';
  }

  statusBox.append(badge, title, description);

  if (status === 'failed' && context.clipError) {
    const error = document.createElement('small');
    error.className = 'library-clip-error';
    error.textContent = context.clipError;
    statusBox.append(error);
  }

  panel.append(statusBox);
  return panel;
}

function createLibraryContext(context, item) {
  const section = document.createElement('section');
  section.className = 'library-context';

  const studyColumn = document.createElement('div');
  studyColumn.className = 'library-study-column';

  const studyCard = document.createElement('div');
  studyCard.className = 'library-study-card';

  const studyEyebrow = document.createElement('span');
  studyEyebrow.className = 'library-study-eyebrow';
  studyEyebrow.textContent = 'Study card preview';

  const instruction = document.createElement('p');
  instruction.className = 'library-study-instruction';
  instruction.textContent = 'Sahne klibini oynat ve boşluğu tamamla.';

  const question = document.createElement('p');
  question.className = 'library-study-question';
  question.textContent = context.studyQuestion || createStudyQuestion(
    context.sourceSentence,
    null,
    null,
    context.studyAnswer || item.term || item.lemma
  );

  const definitions = Array.isArray(context.dictionaryDefinitions)
    ? context.dictionaryDefinitions.slice(0, 2)
    : [];
  const storedEnglishHint = context.studyHintLanguage === 'en'
    ? String(context.studyHint || '').trim()
    : '';
  const semanticHint = String(storedEnglishHint || definitions[0] || '').trim();
  const hintBox = document.createElement('div');
  hintBox.className = 'library-study-hint';
  const hintLabel = document.createElement('span');
  hintLabel.className = 'library-study-hint-label';
  hintLabel.textContent = 'Anlam ipucu · İngilizce';
  const hintText = document.createElement('p');
  hintText.textContent = semanticHint || 'Bu eski kayıt için anlam ipucu bulunmuyor.';
  hintBox.classList.toggle('unavailable', !semanticHint);
  hintBox.append(hintLabel, hintText);

  const revealButton = document.createElement('button');
  revealButton.type = 'button';
  revealButton.className = 'library-answer-button';
  revealButton.textContent = 'Cevabı göster';

  const answer = document.createElement('div');
  answer.className = 'library-study-answer';
  answer.hidden = true;

  const answerTerm = document.createElement('strong');
  answerTerm.className = 'library-answer-term';
  answerTerm.textContent = context.studyAnswer || item.term || item.lemma || '';
  answer.append(answerTerm);

  const source = document.createElement('p');
  source.className = 'library-source-sentence';
  source.textContent = context.sourceSentence || 'İngilizce cümle kaydedilmemiş.';
  answer.append(source);

  if (context.translatedSentence) {
    const translation = document.createElement('p');
    translation.className = 'library-translated-sentence';
    translation.textContent = context.translatedSentence;
    answer.append(translation);
  }

  const lexical = document.createElement('div');
  lexical.className = 'library-lexical-info';

  const lexicalFacts = [
    ['Sözcük türü', partOfSpeechLabel(context.partOfSpeech || item.unitType)],
    ['Kelimenin biçimi', context.wordForm || 'Belirlenemedi'],
    ['Temel biçim', context.dictionaryLemma || item.lemma || item.term || 'Belirlenemedi']
  ];

  for (const [label, value] of lexicalFacts) {
    const fact = document.createElement('div');
    fact.className = 'library-lexical-fact';
    const factLabel = document.createElement('span');
    factLabel.textContent = label;
    const factValue = document.createElement('strong');
    factValue.textContent = value;
    fact.append(factLabel, factValue);
    lexical.append(fact);
  }

  answer.append(lexical);

  const definitionSection = document.createElement('div');
  definitionSection.className = 'library-definitions';
  const definitionTitle = document.createElement('span');
  definitionTitle.className = 'library-definition-title';
  definitionTitle.textContent = 'İlk sözlük tanımları';
  definitionSection.append(definitionTitle);

  if (definitions.length > 0) {
    const list = document.createElement('ol');
    definitions.forEach((definition) => {
      const itemElement = document.createElement('li');
      itemElement.textContent = definition;
      list.append(itemElement);
    });
    definitionSection.append(list);
  } else {
    const unavailable = document.createElement('p');
    unavailable.className = 'library-definition-unavailable';
    unavailable.textContent = 'Bu eski kayıt için sözlük tanımı yok. Kelimeyi videoda yeniden kaydedebilirsin.';
    definitionSection.append(unavailable);
  }

  answer.append(definitionSection);

  revealButton.addEventListener('click', () => {
    const willReveal = answer.hidden;
    answer.hidden = !willReveal;
    revealButton.textContent = willReveal ? 'Cevabı gizle' : 'Cevabı göster';
    revealButton.setAttribute('aria-expanded', String(willReveal));
  });

  studyCard.append(studyEyebrow, instruction, question, hintBox, revealButton, answer);
  studyColumn.append(studyCard);

  const meta = document.createElement('div');
  meta.className = 'library-context-meta';
  appendMeta(meta, context.targetLanguage
    ? `Çeviri: ${getLanguageName(context.targetLanguage)}`
    : null);
  appendMeta(meta, cefrEstimateMeta(context));
  appendMeta(meta, context.videoName || null);

  if (Number.isFinite(context.subtitleStartMs) && Number.isFinite(context.subtitleEndMs)) {
    appendMeta(
      meta,
      `${formatMilliseconds(context.subtitleStartMs)}–${formatMilliseconds(context.subtitleEndMs)}`
    );
  }

  appendMeta(meta, context.savedAt ? `Kaydedildi: ${formatSavedDate(context.savedAt)}` : null);
  studyColumn.append(meta);
  section.append(studyColumn, createLibraryClipPanel(context));
  return section;
}

function createLibraryCard(item, visibleContexts = item.contexts || []) {
  const article = document.createElement('article');
  article.className = 'library-card';
  article.dataset.itemId = item.id;

  const header = document.createElement('header');
  header.className = 'library-card-header';

  const contextsId = `library-contexts-${String(item.id || item.term || Math.random())
    .replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  // Keep the library as an accordion: cards start compact and only one
  // item can be expanded at a time. This prevents a long library from
  // compressing every card into the available dialog height.
  let expanded = state.expandedLibraryItemId === item.id;

  const termBlock = document.createElement('div');
  termBlock.className = 'library-term-block';
  const termRow = document.createElement('div');
  termRow.className = 'library-term-row';

  const term = document.createElement('h3');
  term.className = 'library-term';
  term.textContent = item.term || item.lemma || item.normalizedTerm || 'Adsız kayıt';

  const typeBadge = document.createElement('span');
  typeBadge.className = `library-unit-badge ${item.unitType || 'word'}`;
  typeBadge.textContent = libraryTypeLabel(item.unitType || 'word');

  const cefrSummary = cefrSummaryForContexts(visibleContexts);
  const cefrBadge = document.createElement('span');
  cefrBadge.className = `library-cefr-badge ${cefrSummary.className}`;
  cefrBadge.textContent = cefrSummary.text;
  cefrBadge.title = 'Bu seviye, kelime veya ifadenin kaydedildiği cümledeki anlamına göre AI tarafından tahmin edilir.';

  termRow.append(term, typeBadge, cefrBadge);

  const termMeta = document.createElement('p');
  termMeta.className = 'library-term-meta';
  const totalContextCount = (item.contexts || []).length;
  const visibleContextCount = visibleContexts.length;
  const contextText = visibleContextCount === totalContextCount
    ? `${totalContextCount} bağlam`
    : `${visibleContextCount} gösterilen · ${totalContextCount} toplam bağlam`;
  const saveCount = Number(item.timesSaved || 1);
  const lemmaText = item.lemma && item.lemma !== item.term ? ` · Temel biçim: ${item.lemma}` : '';
  termMeta.textContent = `${contextText} · ${saveCount} kez kaydedildi${lemmaText} · Son kayıt: ${formatSavedDate(item.lastSavedAt)}`;

  termBlock.append(termRow, termMeta);

  const cardActions = document.createElement('div');
  cardActions.className = 'library-card-actions';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'library-expand-button';
  toggleButton.setAttribute('aria-controls', contextsId);

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'library-expand-label';

  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'library-expand-icon';
  toggleIcon.setAttribute('aria-hidden', 'true');
  toggleButton.append(toggleLabel, toggleIcon);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'library-delete-button';
  deleteButton.textContent = 'Sil';
  deleteButton.title = 'Kelimeyi, tüm bağlamlarını ve yalnızca ona ait klipleri sil';
  deleteButton.addEventListener('click', async () => {
    const displayTerm = item.term || item.lemma || 'Bu kayıt';
    const confirmed = window.confirm(
      `“${displayTerm}” kütüphaneden silinsin mi?\n\nTüm cümle bağlamları ve başka kayıtta kullanılmayan sahne klipleri de silinecek.`
    );
    if (!confirmed) return;

    deleteButton.disabled = true;
    try {
      const result = await desktopAPI.deleteLibraryItem(item.id);
      elements.libraryCount.textContent = String(result.totalWords);
      if (state.expandedLibraryItemId === item.id) state.expandedLibraryItemId = null;
      showToast(`“${result.deletedTerm || displayTerm}” kütüphaneden silindi.`);
      await refreshLibraryItems();
    } catch (error) {
      setStatus(`Kütüphane kaydı silinemedi: ${error.message}`, { error: true });
      showToast('Kayıt silinemedi.');
      deleteButton.disabled = false;
    }
  });

  cardActions.append(toggleButton, deleteButton);
  header.append(termBlock, cardActions);
  article.append(header);

  const contexts = document.createElement('div');
  contexts.className = 'library-contexts';
  contexts.id = contextsId;
  const sortedContexts = [...visibleContexts]
    .sort((first, second) => String(second.savedAt || '').localeCompare(String(first.savedAt || '')));

  if (sortedContexts.length === 0) {
    const emptyContext = document.createElement('div');
    emptyContext.className = 'library-message';
    emptyContext.textContent = 'Bu kaydın cümle bağlamı bulunmuyor.';
    contexts.append(emptyContext);
  } else {
    sortedContexts.forEach((context) => contexts.append(createLibraryContext(context, item)));
  }

  function applyExpandedState() {
    article.classList.toggle('collapsed', !expanded);
    article.classList.toggle('is-expanded', expanded);
    contexts.classList.toggle('is-visible', expanded);

    // Use both the native hidden state and an inline display fallback. This
    // prevents stale or platform-specific CSS from leaving a card labelled
    // “Gizle” while its sentence and scene clip remain invisible.
    contexts.hidden = !expanded;
    contexts.style.display = expanded ? 'block' : 'none';
    contexts.setAttribute('aria-hidden', String(!expanded));

    toggleButton.setAttribute('aria-expanded', String(expanded));
    toggleLabel.textContent = expanded ? 'Gizle' : 'Detaylar';
    toggleButton.title = expanded ? 'Cümle bağlamlarını daralt' : 'Cümle bağlamlarını genişlet';
    toggleButton.setAttribute('aria-label', expanded
      ? `${term.textContent} bağlamlarını daralt`
      : `${term.textContent} bağlamlarını genişlet`);
  }

  toggleButton.addEventListener('click', () => {
    const willExpand = !expanded;
    state.expandedLibraryItemId = willExpand ? item.id : null;

    // Re-rendering keeps every other card collapsed and rebuilds the media
    // controls in a clean state. The scroll position is restored so opening
    // a card does not throw the user back to the top of the library.
    const libraryScroller = elements.libraryList.parentElement;
    const previousScrollTop = libraryScroller?.scrollTop || 0;
    renderLibraryItems();

    requestAnimationFrame(() => {
      if (libraryScroller) libraryScroller.scrollTop = previousScrollTop;
      const reopenedCard = Array.from(elements.libraryList.querySelectorAll('.library-card'))
        .find((candidate) => candidate.dataset.itemId === String(item.id));
      if (willExpand) reopenedCard?.scrollIntoView({ block: 'nearest' });
      reopenedCard?.querySelector('.library-expand-button')?.focus({ preventScroll: true });
    });
  });

  termBlock.addEventListener('click', () => toggleButton.click());
  termBlock.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleButton.click();
  });
  termBlock.tabIndex = 0;
  termBlock.setAttribute('role', 'button');

  article.append(contexts);
  applyExpandedState();
  return article;
}

function updateLibrarySummaryText(visibleItems = state.libraryItems) {
  const visibleContexts = visibleItems.flatMap((item) => contextsForLibraryFilters(item));
  const readyClipIds = new Set(
    visibleContexts
      .filter((context) => context.clipStatus === 'ready' && context.clipUrl)
      .map((context) => context.clipId)
      .filter(Boolean)
  );
  const contextCount = visibleContexts.length;
  const languageFilter = selectedLibraryLanguage();
  const languageText = languageFilter === 'all'
    ? ''
    : ` · Dil: ${getLanguageName(languageFilter)}`;
  const levelFilter = selectedLibraryLevel();
  const levelText = levelFilter === 'all'
    ? ''
    : ` · Seviye: ${cefrLabel(levelFilter)}`;
  const filteredText = visibleItems.length !== state.libraryItems.length
    ? ` · ${visibleItems.length} sonuç gösteriliyor`
    : '';

  elements.libraryDialogSummary.textContent =
    `${visibleItems.length} kelime/ifade · ${contextCount} cümle bağlamı · ${readyClipIds.size} oynatılabilir sahne klibi${languageText}${levelText}${filteredText}`;
}

function renderLibraryItems() {
  elements.libraryNoResults.querySelector('strong').textContent = 'Aramana uyan kayıt bulunamadı.';
  elements.libraryNoResults.querySelector('span').textContent = 'Arama metnini veya filtreleri değiştirmeyi dene.';

  const filteredItems = state.libraryItems
    .filter(itemMatchesLibraryFilters)
    .sort((first, second) => String(second.lastSavedAt || '').localeCompare(String(first.lastSavedAt || '')));

  elements.libraryList.replaceChildren();
  elements.libraryLoading.hidden = true;
  elements.libraryEmpty.hidden = state.libraryItems.length !== 0;
  elements.libraryNoResults.hidden = state.libraryItems.length === 0 || filteredItems.length !== 0;
  updateLibrarySummaryText(filteredItems);

  filteredItems.forEach((item) =>
    elements.libraryList.append(createLibraryCard(item, contextsForLibraryFilters(item)))
  );
}

async function refreshLibraryItems() {
  if (state.libraryLoading) return;
  state.libraryLoading = true;
  elements.libraryLoading.hidden = false;
  elements.libraryEmpty.hidden = true;
  elements.libraryNoResults.hidden = true;
  elements.libraryList.replaceChildren();

  try {
    const result = await desktopAPI.getLibraryItems();
    state.libraryItems = Array.isArray(result.items) ? result.items : [];
    elements.libraryCount.textContent = String(result.totalWords ?? state.libraryItems.length);
    refreshLibraryLanguageFilterOptions();
    renderLibraryItems();
  } catch (error) {
    elements.libraryLoading.hidden = true;
    elements.libraryDialogSummary.textContent = 'Kütüphane yüklenemedi.';
    elements.libraryNoResults.hidden = false;
    elements.libraryNoResults.querySelector('strong').textContent = 'Kütüphane açılamadı.';
    elements.libraryNoResults.querySelector('span').textContent = error.message;
    setStatus(`Kütüphane açılamadı: ${error.message}`, { error: true });
  } finally {
    state.libraryLoading = false;
  }
}

async function openLibraryDialog() {
  elements.videoPlayer.pause();
  if (!elements.libraryDialog.open) elements.libraryDialog.showModal();
  elements.librarySearchInput.focus();
  await refreshLibraryItems();
}

function closeLibraryDialog() {
  elements.libraryList.querySelectorAll('.library-clip-video').forEach((video) => video.pause());
  if (elements.libraryDialog.open) elements.libraryDialog.close();
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function showDropOverlay() {
  elements.dropOverlay.hidden = false;
  elements.playerStage.classList.add('drag-active');
}

function hideDropOverlay() {
  state.dragDepth = 0;
  elements.dropOverlay.hidden = true;
  elements.playerStage.classList.remove('drag-active');
}

async function handleDroppedFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  let videoLoaded = false;
  let subtitleLoaded = false;
  const errors = [];

  setStatus('Bırakılan dosyalar açılıyor...');

  for (const file of files) {
    try {
      const result = await desktopAPI.openDroppedFile(file);

      if (result.kind === 'video') {
        if (videoLoaded) continue;
        applyVideoSelection(result.selection);
        videoLoaded = true;
      } else if (result.kind === 'subtitle') {
        if (subtitleLoaded) continue;
        applySubtitleSelection(result.selection);
        subtitleLoaded = true;
      }
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }

  if (videoLoaded && subtitleLoaded) {
    setStatus('Video ve altyazı sürükleyerek yüklendi.');
    showToast('Video ve SRT hazır.');
  } else if (videoLoaded) {
    setStatus('Video sürükleyerek yüklendi. SRT dosyasını da bırakabilirsin.');
    showToast('Video açıldı.');
  } else if (subtitleLoaded) {
    setStatus('Altyazı sürükleyerek yüklendi. Videoyu da bırakabilirsin.');
    showToast('SRT altyazı açıldı.');
  }

  if (errors.length > 0) {
    const errorMessage = errors[0];
    setStatus(`Bazı dosyalar açılamadı: ${errorMessage}`, { error: !videoLoaded && !subtitleLoaded });
    showToast(errorMessage);
  }
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable;
}


elements.initialLanguageSelect.addEventListener('change', updateInitialLanguageButton);
elements.customLanguageInput.addEventListener('input', updateInitialLanguageButton);
elements.languageDialog.addEventListener('cancel', (event) => event.preventDefault());

elements.aiSettingsButton.addEventListener('click', showAiDialog);
elements.closeAiDialogButton.addEventListener('click', () => elements.aiDialog.close());
elements.aiDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  elements.aiDialog.close();
});

elements.saveAiKeyButton.addEventListener('click', async () => {
  elements.saveAiKeyButton.disabled = true;
  elements.aiDialogStatus.classList.remove('error');
  elements.aiDialogStatus.textContent = 'Anahtar güvenli biçimde kaydediliyor…';

  try {
    const status = await desktopAPI.saveGeminiApiKey(elements.geminiApiKeyInput.value);
    updateAiStatusDisplay(status);
    state.learningAnalysisCache.clear();
    elements.geminiApiKeyInput.value = '';
    showToast('Gemini AI ifade analizi etkinleştirildi.');
  } catch (error) {
    elements.aiDialogStatus.textContent = error.message;
    elements.aiDialogStatus.classList.add('error');
  } finally {
    elements.saveAiKeyButton.disabled = false;
  }
});

elements.clearAiKeyButton.addEventListener('click', async () => {
  try {
    const status = await desktopAPI.clearGeminiApiKey();
    updateAiStatusDisplay(status);
    state.learningAnalysisCache.clear();
    showToast('Kaydedilmiş Gemini anahtarı kaldırıldı.');
  } catch (error) {
    elements.aiDialogStatus.textContent = error.message;
    elements.aiDialogStatus.classList.add('error');
  }
});

elements.saveInitialLanguageButton.addEventListener('click', async () => {
  elements.saveInitialLanguageButton.disabled = true;
  elements.languageDialogError.hidden = true;

  try {
    await setTargetLanguage(selectedInitialLanguageCode());
    elements.languageDialog.close();
  } catch (error) {
    elements.languageDialogError.textContent = error.message;
    elements.languageDialogError.hidden = false;
    updateInitialLanguageButton();
  }
});

elements.targetLanguageSelect.addEventListener('change', async () => {
  let requestedLanguage = elements.targetLanguageSelect.value;

  if (requestedLanguage === CUSTOM_LANGUAGE_VALUE) {
    requestedLanguage = window.prompt(
      'Çeviri servisinin desteklediği dil kodunu gir (ör. de, ja, pt-BR):',
      ''
    );

    if (!requestedLanguage) {
      syncLanguageControls(state.targetLanguage);
      return;
    }
  }

  elements.targetLanguageSelect.disabled = true;

  try {
    await setTargetLanguage(requestedLanguage);
  } catch (error) {
    syncLanguageControls(state.targetLanguage);
    setStatus(`Çeviri dili değiştirilemedi: ${error.message}`, { error: true });
    showToast(error.message);
  } finally {
    elements.targetLanguageSelect.disabled = false;
  }
});

elements.openVideoButton.addEventListener('click', openVideo);
elements.openSubtitleButton.addEventListener('click', openSubtitle);
elements.convertVideoButton.addEventListener('click', () => convertCurrentVideo());
elements.chooseAudioOutputButton.addEventListener('click', chooseAudioOutput);

elements.audioOutputSelect.addEventListener('change', async () => {
  try {
    await applyAudioOutput(elements.audioOutputSelect.value);
  } catch (error) {
    setStatus(`Ses çıkışı değiştirilemedi: ${error.message}`, { error: true });
  }
});

elements.revealLibraryButton.addEventListener('click', openLibraryDialog);
elements.closeLibraryButton.addEventListener('click', closeLibraryDialog);
elements.libraryDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeLibraryDialog();
});
elements.libraryDialog.addEventListener('close', () => {
  elements.libraryList.querySelectorAll('.library-clip-video').forEach((video) => video.pause());
});
elements.librarySearchInput.addEventListener('input', () => {
  state.expandedLibraryItemId = null;
  renderLibraryItems();
});
elements.libraryLanguageFilter.addEventListener('change', () => {
  state.expandedLibraryItemId = null;
  renderLibraryItems();
});
elements.libraryLevelFilter.addEventListener('change', () => {
  state.expandedLibraryItemId = null;
  renderLibraryItems();
});

elements.exportMobileLibraryButton.addEventListener('click', async () => {
  elements.exportMobileLibraryButton.disabled = true;
  try {
    const result = await desktopAPI.exportLibraryForMobile();
    if (!result) return;
    showToast(`Mobil paket hazır: ${result.itemCount} öğe, ${result.clipCount} klip.`);
    setStatus(`Mobil kütüphane paketi oluşturuldu: ${result.outputPath}`);
  } catch (error) {
    setStatus(`Mobil paket oluşturulamadı: ${error.message}`, { error: true });
    showToast(error.message);
  } finally {
    elements.exportMobileLibraryButton.disabled = false;
  }
});

elements.openLibraryFolderButton.addEventListener('click', async () => {
  try {
    const summary = await desktopAPI.revealLibraryFile();
    showToast(`Kütüphane klasörü açıldı: ${summary.totalWords} kelime/ifade.`);
  } catch (error) {
    setStatus(`Kütüphane klasörü açılamadı: ${error.message}`, { error: true });
  }
});

elements.videoPlayer.addEventListener('play', startSubtitleLoop);
elements.videoPlayer.addEventListener('pause', stopSubtitleLoop);
elements.videoPlayer.addEventListener('seeking', updateSubtitleForCurrentTime);
elements.videoPlayer.addEventListener('seeked', updateSubtitleForCurrentTime);
elements.videoPlayer.addEventListener('timeupdate', updateSubtitleForCurrentTime);
elements.videoPlayer.addEventListener('loadedmetadata', () => {
  updateSubtitleForCurrentTime();
  setStatus(
    `${state.selectedVideo?.fileName || 'Video'} hazır · ${formatMilliseconds(elements.videoPlayer.duration * 1000)}`
  );
});

elements.videoPlayer.addEventListener('error', () => {
  const mediaError = elements.videoPlayer.error;
  if (!mediaError || !state.selectedVideo) return;

  const unsupported = mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
    mediaError.code === MediaError.MEDIA_ERR_DECODE;

  if (unsupported && !state.conversionAttemptedAutomatically) {
    state.conversionAttemptedAutomatically = true;
    setStatus('Dosyanın codec’i doğrudan oynatılamadı; yerel dönüşüm başlatılıyor.');
    convertCurrentVideo({ automatic: true });
    return;
  }

  setStatus(`Video oynatma hatası (kod ${mediaError.code}).`, { error: true });
});

window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  state.dragDepth += 1;
  showDropOverlay();
});

window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  showDropOverlay();
});

window.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) hideDropOverlay();
});

window.addEventListener('drop', async (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  const files = event.dataTransfer.files;
  hideDropOverlay();
  await handleDroppedFiles(files);
});

async function handleGlobalShortcut(event) {
  if (elements.languageDialog.open || elements.aiDialog.open || elements.libraryDialog.open || isTypingTarget(event.target)) return;

  const isSpace = event.code === 'Space';
  const isTranslationShortcut = event.key.toLowerCase() === 't';

  if (!isSpace && !isTranslationShortcut) return;

  // Native Chromium video controls also react to Space when the video has focus.
  // Capture and stop the event before it reaches the <video> element, otherwise
  // both Chromium and our shortcut toggle playback and the video appears to
  // start for a moment and immediately pause again.
  event.preventDefault();
  event.stopImmediatePropagation();

  // Holding a key down generates repeated keydown events. Only act once.
  if (event.repeat) return;

  if (isTranslationShortcut) {
    await toggleCurrentTranslation();
    return;
  }

  if (!state.selectedVideo) return;

  try {
    if (elements.videoPlayer.paused) {
      await elements.videoPlayer.play();
    } else {
      elements.videoPlayer.pause();
    }
  } catch (error) {
    setStatus(`Video oynatılamadı: ${error.message}`, { error: true });
  }
}

window.addEventListener('keydown', handleGlobalShortcut, { capture: true });

// Prevent the keyup event from reaching Chromium's built-in media controls too.
window.addEventListener('keyup', (event) => {
  if (elements.languageDialog.open || elements.aiDialog.open || elements.libraryDialog.open || isTypingTarget(event.target)) return;
  if (event.code !== 'Space') return;

  event.preventDefault();
  event.stopImmediatePropagation();
}, { capture: true });

navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshAudioOutputs());

desktopAPI.onConversionProgress((payload) => {
  if (!state.conversionInProgress) return;
  elements.busyMessage.textContent = payload.message || 'Video dönüştürülüyor...';
});

desktopAPI.onLibraryClipStatus((payload) => {
  if (payload.status === 'ready') {
    showToast(payload.message || 'Sahne klibi hazır.');
    if (elements.libraryDialog.open) refreshLibraryItems();
    return;
  }

  if (payload.status === 'failed') {
    setStatus(
      `${payload.message || 'Sahne klibi hazırlanamadı.'} Kelime ve cümle bağlamı kütüphanede korunuyor.`,
      { error: true }
    );
    showToast(payload.message || 'Sahne klibi hazırlanamadı.');
    if (elements.libraryDialog.open) refreshLibraryItems();
  }
});

appendLanguageOptions(elements.targetLanguageSelect);
appendLanguageOptions(elements.initialLanguageSelect, { includePlaceholder: true });

await Promise.all([
  loadLibrarySummary(),
  refreshAudioOutputs(localStorage.getItem('preferredAudioOutputId') || ''),
  loadTranslationPreference(),
  loadAiStatus()
]);
