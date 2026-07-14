import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LearningLibraryStore } = require('../electron/library-store.js');
const { LibraryClipService } = require('../electron/library-clip-service.js');

test('scene clip descriptors are stable and include subtitle padding', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'language-player-clip-test-'));
  const videoPath = path.join(directory, 'episode.mkv');
  await fs.writeFile(videoPath, 'fake-video-content');

  const service = new LibraryClipService({
    mediaDirectory: path.join(directory, 'library-media'),
    libraryStore: {},
    getFfmpegPath: () => 'ffmpeg'
  });

  const first = await service.createDescriptor({
    videoPath,
    subtitleStartMs: 1000,
    subtitleEndMs: 2500
  });
  const second = await service.createDescriptor({
    videoPath,
    subtitleStartMs: 1000,
    subtitleEndMs: 2500
  });

  assert.equal(first.clipId, second.clipId);
  assert.equal(first.clipStartMs, 600);
  assert.equal(first.clipEndMs, 2900);
  assert.equal(first.durationMs, 2300);
  assert.equal(first.relativePath, `library-media/${first.clipId}.mp4`);

  await fs.rm(directory, { recursive: true, force: true });
});

test('one ready scene clip updates every library context that shares the clip id', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'language-player-clip-test-'));
  const filePath = path.join(directory, 'learning-library.json');
  const store = new LearningLibraryStore(filePath);
  const sharedClip = {
    clipId: 'shared-scene',
    clipPath: 'library-media/shared-scene.mp4',
    clipStatus: 'processing',
    clipStartMs: 600,
    clipEndMs: 2900
  };

  await store.saveLearningUnit({
    term: 'give up',
    sourceSentence: 'Do not give up now.',
    translatedSentence: 'Şimdi vazgeçme.',
    videoName: 'episode.mkv',
    subtitleStartMs: 1000,
    subtitleEndMs: 2500,
    sourceLanguage: 'en',
    targetLanguage: 'tr',
    ...sharedClip
  });

  await store.saveLearningUnit({
    term: 'now',
    sourceSentence: 'Do not give up now.',
    translatedSentence: 'Şimdi vazgeçme.',
    videoName: 'episode.mkv',
    subtitleStartMs: 1000,
    subtitleEndMs: 2500,
    sourceLanguage: 'en',
    targetLanguage: 'tr',
    ...sharedClip
  });

  const update = await store.updateClipStatus('shared-scene', {
    status: 'ready',
    clipPath: 'library-media/shared-scene.mp4',
    error: null
  });

  assert.equal(update.affectedContexts, 2);
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(data.version, 3);
  assert.deepEqual(
    data.items.map((item) => item.contexts[0].clipStatus),
    ['ready', 'ready']
  );

  await fs.rm(directory, { recursive: true, force: true });
});

test('library clip service exposes only valid media files and deletes them', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'language-player-clip-test-'));
  const mediaDirectory = path.join(directory, 'library-media');
  await fs.mkdir(mediaDirectory, { recursive: true });
  const clipId = 'clip-for-library-ui';
  const clipPath = path.join(mediaDirectory, `${clipId}.mp4`);
  await fs.writeFile(clipPath, 'video-data');

  const service = new LibraryClipService({
    mediaDirectory,
    libraryStore: {},
    getFfmpegPath: () => 'ffmpeg'
  });

  const playableUrl = await service.getPlayableUrl(`library-media/${clipId}.mp4`);
  assert.match(playableUrl, /^file:/);
  assert.equal(await service.getPlayableUrl('../outside.mp4'), null);

  const deletion = await service.deleteClips([clipId]);
  assert.deepEqual(deletion.deletedClipIds, [clipId]);
  await assert.rejects(fs.stat(clipPath));

  await fs.rm(directory, { recursive: true, force: true });
});
