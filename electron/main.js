'use strict';

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  safeStorage
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ffmpegStaticPath = require('ffmpeg-static');
const { LearningLibraryStore } = require('./library-store');
const { TranslationService } = require('./translation-service');
const { SettingsStore } = require('./settings-store');
const { GeminiCredentialStore } = require('./credential-store');
const { LearningUnitAnalysisService } = require('./ai-learning-service');
const { LibraryClipService } = require('./library-clip-service');

let mainWindow = null;
let libraryStore = null;
let translationService = null;
let settingsStore = null;
let credentialStore = null;
let learningUnitAnalysisService = null;
let libraryClipService = null;
const allowedVideoPaths = new Set();
const runningConversions = new Map();
const supportedVideoExtensions = new Set(['.mp4', '.mkv', '.mov', '.webm', '.m4v']);
const supportedSubtitleExtensions = new Set(['.srt', '.txt']);

function getUsableFfmpegPath() {
  if (!ffmpegStaticPath) {
    throw new Error('FFmpeg yürütülebilir dosyası bulunamadı.');
  }

  return app.isPackaged
    ? ffmpegStaticPath.replace('app.asar', 'app.asar.unpacked')
    : ffmpegStaticPath;
}

function decodeSubtitleBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString('utf16le');
  }

  const utf8Text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const replacementCount = (utf8Text.match(/\uFFFD/g) || []).length;

  if (replacementCount > Math.max(2, utf8Text.length * 0.01)) {
    try {
      return new TextDecoder('windows-1254').decode(buffer);
    } catch {
      return utf8Text;
    }
  }

  return utf8Text;
}

async function createVideoSelection(inputPath) {
  const filePath = path.resolve(String(inputPath || ''));
  const extension = path.extname(filePath).toLowerCase();

  if (!supportedVideoExtensions.has(extension)) {
    throw new Error('Desteklenmeyen video biçimi. MP4, MKV, MOV, WebM veya M4V kullan.');
  }

  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error('Seçilen video geçerli bir dosya değil.');

  allowedVideoPaths.add(filePath);
  return {
    filePath,
    fileUrl: pathToFileURL(filePath).href,
    fileName: path.basename(filePath),
    extension
  };
}

async function createSubtitleSelection(inputPath) {
  const filePath = path.resolve(String(inputPath || ''));
  const extension = path.extname(filePath).toLowerCase();

  if (!supportedSubtitleExtensions.has(extension)) {
    throw new Error('Desteklenmeyen altyazı biçimi. SRT dosyası kullan.');
  }

  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new Error('Seçilen altyazı geçerli bir dosya değil.');

  const buffer = await fs.readFile(filePath);
  return {
    fileName: path.basename(filePath),
    content: decodeSubtitleBuffer(buffer)
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: 'VideoPlayer - LanguageLearning',
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (navigationUrl !== currentUrl) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function configurePermissions() {
  const allowedPermissions = new Set(['speaker-selection', 'media']);

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
}

async function ensureStores() {
  const userDataDirectory = app.getPath('userData');
  libraryStore = new LearningLibraryStore(
    path.join(userDataDirectory, 'learning-library.json')
  );
  translationService = new TranslationService(
    path.join(userDataDirectory, 'translation-cache.json')
  );
  settingsStore = new SettingsStore(
    path.join(userDataDirectory, 'preferences.json')
  );
  credentialStore = new GeminiCredentialStore(
    path.join(userDataDirectory, 'gemini-api-key.bin'),
    safeStorage
  );
  learningUnitAnalysisService = new LearningUnitAnalysisService(
    path.join(userDataDirectory, 'learning-unit-analysis-cache.json'),
    credentialStore
  );
  libraryClipService = new LibraryClipService({
    mediaDirectory: path.join(userDataDirectory, 'library-media'),
    libraryStore,
    getFfmpegPath: getUsableFfmpegPath
  });
  await Promise.all([
    libraryStore.ensureFile(),
    settingsStore.ensureFile(),
    libraryClipService.ensureDirectory()
  ]);
  await libraryStore.markInterruptedClipJobs();
}

function registerIpcHandlers() {
  ipcMain.handle('video:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Video seç',
      properties: ['openFile'],
      filters: [
        { name: 'Video dosyaları', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v'] },
        { name: 'Tüm dosyalar', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths[0]) return null;

    return createVideoSelection(result.filePaths[0]);
  });

  ipcMain.handle('subtitle:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'SRT altyazı seç',
      properties: ['openFile'],
      filters: [
        { name: 'SubRip altyazı', extensions: ['srt'] },
        { name: 'Metin dosyaları', extensions: ['txt'] }
      ]
    });

    if (result.canceled || !result.filePaths[0]) return null;

    return createSubtitleSelection(result.filePaths[0]);
  });

  ipcMain.handle('file:open-dropped', async (_event, payload) => {
    const filePath = path.resolve(String(payload?.filePath || ''));
    const extension = path.extname(filePath).toLowerCase();

    if (supportedVideoExtensions.has(extension)) {
      return { kind: 'video', selection: await createVideoSelection(filePath) };
    }

    if (supportedSubtitleExtensions.has(extension)) {
      return { kind: 'subtitle', selection: await createSubtitleSelection(filePath) };
    }

    throw new Error('Bu dosya desteklenmiyor. Video veya .srt dosyası bırak.');
  });

  ipcMain.handle('preferences:get', async () => {
    return settingsStore.getPreferences();
  });

  ipcMain.handle('preferences:set-target-language', async (_event, payload) => {
    return settingsStore.setTargetLanguage(payload?.targetLanguage);
  });

  ipcMain.handle('translation:translate', async (_event, payload) => {
    const preferences = await settingsStore.getPreferences();

    if (!preferences.targetLanguage) {
      throw new Error('Önce bir çeviri dili seçmelisin.');
    }

    return translationService.translate(payload?.text, {
      sourceLanguage: 'en',
      targetLanguage: preferences.targetLanguage
    });
  });

  ipcMain.handle('ai:status', async () => credentialStore.getStatus());

  ipcMain.handle('ai:save-key', async (_event, payload) => {
    const status = await credentialStore.saveApiKey(payload?.apiKey);
    learningUnitAnalysisService.clearRuntimeClients();
    return status;
  });

  ipcMain.handle('ai:clear-key', async () => {
    const status = await credentialStore.clearApiKey();
    learningUnitAnalysisService.clearRuntimeClients();
    return status;
  });

  ipcMain.handle('learning:analyze-units', async (_event, payload) => {
    return learningUnitAnalysisService.analyze({
      sentence: payload?.sentence,
      tokens: payload?.tokens
    });
  });

  ipcMain.handle('library:save-unit', async (event, payload) => {
    const preferences = await settingsStore.getPreferences();

    if (!preferences.targetLanguage) {
      throw new Error('Önce bir çeviri dili seçmelisin.');
    }

    const videoPath = path.resolve(String(payload?.videoPath || ''));
    if (!allowedVideoPaths.has(videoPath)) {
      throw new Error('Klip oluşturulacak video uygulama tarafından seçilmedi.');
    }

    const descriptor = await libraryClipService.createDescriptor({
      videoPath,
      subtitleStartMs: payload?.subtitleStartMs,
      subtitleEndMs: payload?.subtitleEndMs
    });

    const saveResult = await libraryStore.saveLearningUnit({
      ...(payload || {}),
      sourceLanguage: 'en',
      targetLanguage: preferences.targetLanguage,
      clipId: descriptor.clipId,
      clipPath: descriptor.relativePath,
      clipStatus: 'processing',
      clipStartMs: descriptor.clipStartMs,
      clipEndMs: descriptor.clipEndMs
    });

    const clipResult = await libraryClipService.queueClip(descriptor, {
      sender: event.sender,
      term: saveResult.savedTerm
    });

    return {
      ...saveResult,
      clipStatus: clipResult.status,
      clipPath: clipResult.clipPath
    };
  });

  ipcMain.handle('library:save-word', async (_event, payload) => {
    const preferences = await settingsStore.getPreferences();

    if (!preferences.targetLanguage) {
      throw new Error('Önce bir çeviri dili seçmelisin.');
    }

    return libraryStore.saveWord({
      ...(payload || {}),
      sourceLanguage: 'en',
      targetLanguage: preferences.targetLanguage
    });
  });

  ipcMain.handle('library:summary', async () => {
    return libraryStore.getSummary();
  });

  ipcMain.handle('library:list', async () => {
    const library = await libraryStore.getItems();
    const items = await Promise.all(library.items.map(async (item) => ({
      ...item,
      contexts: await Promise.all((item.contexts || []).map(async (context) => ({
        ...context,
        clipUrl: context.clipStatus === 'ready'
          ? await libraryClipService.getPlayableUrl(context.clipPath)
          : null
      })))
    })));

    return {
      version: library.version,
      totalWords: items.length,
      items
    };
  });

  ipcMain.handle('library:delete-item', async (_event, payload) => {
    const result = await libraryStore.deleteItem(payload?.itemId);
    await libraryClipService.deleteClips(result.orphanClipIds);
    return result;
  });

  ipcMain.handle('library:reveal', async () => {
    const summary = await libraryStore.getSummary();
    shell.showItemInFolder(summary.filePath);
    return summary;
  });

  ipcMain.handle('video:convert', async (event, payload) => {
    const inputPath = path.resolve(String(payload?.filePath || ''));

    if (!allowedVideoPaths.has(inputPath)) {
      throw new Error('Bu video yolu uygulama tarafından seçilmedi.');
    }

    if (runningConversions.has(inputPath)) {
      return runningConversions.get(inputPath);
    }

    const conversionPromise = convertToCompatibleMp4(inputPath, event.sender)
      .finally(() => runningConversions.delete(inputPath));

    runningConversions.set(inputPath, conversionPromise);
    return conversionPromise;
  });
}

async function convertToCompatibleMp4(inputPath, sender) {
  const ffmpegPath = getUsableFfmpegPath();
  const stats = await fs.stat(inputPath);
  const hash = createHash('sha256')
    .update(`${inputPath}|${stats.size}|${stats.mtimeMs}`)
    .digest('hex')
    .slice(0, 18);
  const outputDirectory = path.join(app.getPath('temp'), 'video-player-language-learning');
  const outputPath = path.join(outputDirectory, `${hash}-uyumlu.mp4`);

  await fs.mkdir(outputDirectory, { recursive: true });

  try {
    const outputStats = await fs.stat(outputPath);
    if (outputStats.size > 0) {
      allowedVideoPaths.add(outputPath);
      return {
        filePath: outputPath,
        fileUrl: pathToFileURL(outputPath).href,
        cached: true
      };
    }
  } catch {
    // Daha önce dönüştürülmüş çıktı yok.
  }

  sender.send('video:conversion-progress', {
    phase: 'starting',
    message: 'Video yerel olarak uyumlu MP4 biçimine dönüştürülüyor.'
  });

  const args = [
    '-hide_banner',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath
  ];

  await new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    let stdoutBuffer = '';

    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const [key, value] = line.split('=', 2);
        if (key === 'out_time') {
          sender.send('video:conversion-progress', {
            phase: 'converting',
            processedTime: value,
            message: `Dönüştürülen video süresi: ${value}`
          });
        }
      }
    });

    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12000);
    });

    process.on('error', (error) => reject(error));
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg dönüşümü başarısız oldu.\n${stderr.slice(-2500)}`));
      }
    });
  });

  allowedVideoPaths.add(outputPath);
  sender.send('video:conversion-progress', {
    phase: 'complete',
    message: 'Uyumlu video hazır.'
  });

  return {
    filePath: outputPath,
    fileUrl: pathToFileURL(outputPath).href,
    cached: false
  };
}

app.whenReady().then(async () => {
  configurePermissions();
  await ensureStores();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
