import { findActiveCue, formatMilliseconds, parseSrt } from './srt-parser.mjs';

const desktopAPI = window.desktopAPI;

const elements = {
  openVideoButton: document.querySelector('#openVideoButton'),
  openSubtitleButton: document.querySelector('#openSubtitleButton'),
  convertVideoButton: document.querySelector('#convertVideoButton'),
  videoFileName: document.querySelector('#videoFileName'),
  subtitleFileName: document.querySelector('#subtitleFileName'),
  audioOutputSelect: document.querySelector('#audioOutputSelect'),
  chooseAudioOutputButton: document.querySelector('#chooseAudioOutputButton'),
  revealLibraryButton: document.querySelector('#revealLibraryButton'),
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
  toast: document.querySelector('#toast')
};

const state = {
  selectedVideo: null,
  selectedSubtitle: null,
  subtitleCues: [],
  currentCue: null,
  currentCueKey: null,
  visibleTranslationCueKey: null,
  translationCache: new Map(),
  translationRequestToken: 0,
  animationFrameId: null,
  conversionInProgress: false,
  conversionAttemptedAutomatically: false,
  toastTimer: null,
  dragDepth: 0
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

function cueKey(cue) {
  if (!cue) return null;
  return `${cue.startMs}:${cue.endMs}:${cue.text}`;
}

function resetTranslationDisplay() {
  state.visibleTranslationCueKey = null;
  state.translationRequestToken += 1;
  elements.translatedSubtitle.hidden = true;
  elements.translatedSubtitle.replaceChildren();
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

  elements.sourceSubtitle.textContent = cue.text;
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

function segmentTranslation(text) {
  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('tr', { granularity: 'word' });
    return Array.from(segmenter.segment(text), (part) => ({
      text: part.segment,
      isWordLike: Boolean(part.isWordLike)
    }));
  }

  return text.split(/(\s+|[^\p{L}\p{N}'’]+)/gu).filter(Boolean).map((part) => ({
    text: part,
    isWordLike: /[\p{L}\p{N}]/u.test(part)
  }));
}

function renderClickableTranslation(translatedText, cue) {
  elements.translatedSubtitle.replaceChildren();

  for (const segment of segmentTranslation(translatedText)) {
    if (!segment.isWordLike) {
      elements.translatedSubtitle.append(document.createTextNode(segment.text));
      continue;
    }

    const wordButton = document.createElement('button');
    wordButton.type = 'button';
    wordButton.className = 'translation-word';
    wordButton.textContent = segment.text;
    wordButton.title = `“${segment.text}” kelimesini öğrenme kütüphanesine ekle`;

    wordButton.addEventListener('click', async () => {
      wordButton.disabled = true;

      try {
        const result = await desktopAPI.saveLearningWord({
          clickedWord: segment.text,
          sourceSentence: cue.text,
          translatedSentence: translatedText,
          videoName: state.selectedVideo?.fileName || '',
          subtitleStartMs: cue.startMs
        });

        wordButton.classList.add('saved');
        wordButton.disabled = false;
        elements.libraryCount.textContent = String(result.totalWords);
        showToast(
          result.wasExisting
            ? `“${segment.text}” yeniden kaydedildi; kullanım sayısı güncellendi.`
            : `“${segment.text}” öğrenme kütüphanesine eklendi.`
        );
      } catch (error) {
        showToast(`Kelime kaydedilemedi: ${error.message}`);
        wordButton.disabled = false;
      }
    });

    elements.translatedSubtitle.append(wordButton);
  }

  elements.translatedSubtitle.hidden = false;
}

async function toggleCurrentTranslation() {
  const cue = state.currentCue;
  if (!cue) {
    showToast('Bu saniyede çevrilecek bir altyazı yok.');
    return;
  }

  const key = cueKey(cue);

  if (state.visibleTranslationCueKey === key && !elements.translatedSubtitle.hidden) {
    resetTranslationDisplay();
    setStatus('Çeviri gizlendi.');
    return;
  }

  const cachedTranslation = state.translationCache.get(key);
  if (cachedTranslation) {
    state.visibleTranslationCueKey = key;
    renderClickableTranslation(cachedTranslation, cue);
    setStatus('Çeviri yerel önbellekten gösterildi.');
    return;
  }

  const requestToken = ++state.translationRequestToken;
  state.visibleTranslationCueKey = key;
  elements.translatedSubtitle.hidden = false;
  elements.translatedSubtitle.textContent = 'Çevriliyor…';
  setStatus('İngilizce altyazı çevriliyor...');

  try {
    const result = await desktopAPI.translateSubtitle(cue.text);

    if (requestToken !== state.translationRequestToken || cueKey(state.currentCue) !== key) {
      return;
    }

    state.translationCache.set(key, result.translatedText);
    renderClickableTranslation(result.translatedText, cue);
    setStatus(
      result.cached
        ? 'Çeviri kalıcı önbellekten gösterildi.'
        : `Çeviri hazır (${result.provider}).`
    );
  } catch (error) {
    if (requestToken !== state.translationRequestToken) return;
    resetTranslationDisplay();
    setStatus(`Çeviri başarısız: ${error.message}`, { error: true });
    showToast('Çeviri için internet bağlantısını kontrol et.');
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
  if (isTypingTarget(event.target)) return;

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

await Promise.all([
  loadLibrarySummary(),
  refreshAudioOutputs(localStorage.getItem('preferredAudioOutputId') || '')
]);
