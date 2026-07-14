'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  openVideo: () => ipcRenderer.invoke('video:open'),
  openSubtitle: () => ipcRenderer.invoke('subtitle:open'),
  openDroppedFile: (file) => {
    const filePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('file:open-dropped', { filePath });
  },
  convertVideo: (filePath) => ipcRenderer.invoke('video:convert', { filePath }),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setTargetLanguage: (targetLanguage) =>
    ipcRenderer.invoke('preferences:set-target-language', { targetLanguage }),
  translateSubtitle: (text) => ipcRenderer.invoke('translation:translate', { text }),
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  saveGeminiApiKey: (apiKey) => ipcRenderer.invoke('ai:save-key', { apiKey }),
  clearGeminiApiKey: () => ipcRenderer.invoke('ai:clear-key'),
  analyzeLearningUnits: (sentence, tokens) =>
    ipcRenderer.invoke('learning:analyze-units', { sentence, tokens }),
  saveLearningUnit: (item) => ipcRenderer.invoke('library:save-unit', item),
  saveLearningWord: (item) => ipcRenderer.invoke('library:save-word', item),
  getLibrarySummary: () => ipcRenderer.invoke('library:summary'),
  getLibraryItems: () => ipcRenderer.invoke('library:list'),
  deleteLibraryItem: (itemId) => ipcRenderer.invoke('library:delete-item', { itemId }),
  revealLibraryFile: () => ipcRenderer.invoke('library:reveal'),
  onConversionProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('video:conversion-progress', listener);
    return () => ipcRenderer.removeListener('video:conversion-progress', listener);
  },
  onLibraryClipStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('library:clip-status', listener);
    return () => ipcRenderer.removeListener('library:clip-status', listener);
  }
});
