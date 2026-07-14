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
  aiStatus: { configured: false, source: 'none' }
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

  for (const token of tokenization.wordTokens) {
    unitsByToken.set(token.index, {
      id: `word-${token.index}`,
      startToken: token.index,
      endToken: token.index,
      term: token.text,
      lemma: token.text.toLocaleLowerCase('en'),
      unitType: 'word',
      confidence: null
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
      term,
      lemma: unit.lemma || term.toLocaleLowerCase('en'),
      unitType: unit.type || 'fixed_expression',
      confidence: Number.isFinite(unit.confidence) ? unit.confidence : null
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
  const result = await desktopAPI.saveLearningUnit({
    term: unit.term,
    lemma: unit.lemma,
    normalizedTerm: unit.lemma,
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
    sourceLanguage: 'en',
    targetLanguage: state.targetLanguage
  });

  elements.libraryCount.textContent = String(result.totalWords);
  setUnitSaved(unit.id);

  if (result.clipStatus === 'ready') {
    showToast(
      result.wasExisting
        ? `“${unit.term}” yeniden kaydedildi; sahne klibi hazır.`
        : `“${unit.term}” sahne klibiyle kütüphaneye eklendi.`
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
    button.title = unit.startToken === unit.endToken
      ? `İngilizce kelimeyi kaydet: ${unit.term}`
      : `İfadeyi birlikte kaydet: ${unit.term}`;

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
    const [translationResult, analysisResult] = await Promise.all([
      cachedTranslation
        ? Promise.resolve({ translatedText: cachedTranslation, cached: true, provider: 'memory-cache' })
        : desktopAPI.translateSubtitle(cue.text),
      cachedAnalysis
        ? Promise.resolve(cachedAnalysis)
        : desktopAPI.analyzeLearningUnits(cue.text, analysisTokensForCue(cue))
    ]);

    if (requestToken !== state.translationRequestToken || translationKey(state.currentCue) !== key) {
      return;
    }

    state.translationCache.set(key, translationResult.translatedText);
    state.learningAnalysisCache.set(cueKey(cue), analysisResult);
    renderTranslation(translationResult.translatedText);
    renderClickableSource(cue, translationResult.translatedText, analysisResult);

    if (analysisResult.warning) {
      setStatus(analysisResult.warning, { error: analysisResult.aiConfigured });
      showToast(
        analysisResult.aiConfigured
          ? 'AI analizi başarısız oldu; yerel ifade algılama kullanıldı.'
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

elements.revealLibraryButton.addEventListener('click', async () => {
  try {
    const summary = await desktopAPI.revealLibraryFile();
    showToast(`Kütüphane dosyası gösterildi: ${summary.totalWords} kelime.`);
  } catch (error) {
    setStatus(`Kütüphane dosyası gösterilemedi: ${error.message}`, { error: true });
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
  if (elements.languageDialog.open || isTypingTarget(event.target)) return;

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
  if (isTypingTarget(event.target)) return;
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
    return;
  }

  if (payload.status === 'failed') {
    setStatus(
      `${payload.message || 'Sahne klibi hazırlanamadı.'} Kelime ve cümle bağlamı kütüphanede korunuyor.`,
      { error: true }
    );
    showToast(payload.message || 'Sahne klibi hazırlanamadı.');
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
