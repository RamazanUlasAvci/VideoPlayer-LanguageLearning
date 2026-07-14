'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

const DEFAULT_PADDING_MS = 400;

function seconds(milliseconds) {
  return (milliseconds / 1000).toFixed(3);
}

function safeSend(sender, channel, payload) {
  if (!sender || sender.isDestroyed?.()) return;
  sender.send(channel, payload);
}

class LibraryClipService {
  constructor({ mediaDirectory, libraryStore, getFfmpegPath }) {
    this.mediaDirectory = mediaDirectory;
    this.libraryStore = libraryStore;
    this.getFfmpegPath = getFfmpegPath;
    this.runningJobs = new Map();
  }

  async ensureDirectory() {
    await fs.mkdir(this.mediaDirectory, { recursive: true });
  }

  async createDescriptor({ videoPath, subtitleStartMs, subtitleEndMs, paddingMs = DEFAULT_PADDING_MS }) {
    const inputPath = path.resolve(String(videoPath || ''));
    const startMs = Number(subtitleStartMs);
    const endMs = Number(subtitleEndMs);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error('Altyazının klip zaman aralığı geçerli değil.');
    }

    const stats = await fs.stat(inputPath);
    if (!stats.isFile()) throw new Error('Klip oluşturulacak video bulunamadı.');

    const clipStartMs = Math.max(0, Math.round(startMs - paddingMs));
    const clipEndMs = Math.max(clipStartMs + 200, Math.round(endMs + paddingMs));
    const fingerprint = [
      inputPath,
      stats.size,
      Math.round(stats.mtimeMs),
      clipStartMs,
      clipEndMs
    ].join('|');
    const clipId = createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
    const fileName = `${clipId}.mp4`;

    return {
      clipId,
      inputPath,
      outputPath: path.join(this.mediaDirectory, fileName),
      relativePath: path.posix.join('library-media', fileName),
      clipStartMs,
      clipEndMs,
      durationMs: clipEndMs - clipStartMs
    };
  }

  async outputExists(descriptor) {
    try {
      const stats = await fs.stat(descriptor.outputPath);
      return stats.isFile() && stats.size > 0;
    } catch {
      return false;
    }
  }

  async queueClip(descriptor, { sender, term } = {}) {
    await this.ensureDirectory();

    if (await this.outputExists(descriptor)) {
      await this.libraryStore.updateClipStatus(descriptor.clipId, {
        status: 'ready',
        clipPath: descriptor.relativePath,
        clipStartMs: descriptor.clipStartMs,
        clipEndMs: descriptor.clipEndMs,
        error: null
      });
      return { status: 'ready', clipPath: descriptor.relativePath };
    }

    if (this.runningJobs.has(descriptor.clipId)) {
      return { status: 'processing', clipPath: descriptor.relativePath };
    }

    await this.libraryStore.updateClipStatus(descriptor.clipId, {
      status: 'processing',
      clipPath: descriptor.relativePath,
      clipStartMs: descriptor.clipStartMs,
      clipEndMs: descriptor.clipEndMs,
      error: null
    });

    const job = this.generateClip(descriptor, { sender, term })
      .finally(() => this.runningJobs.delete(descriptor.clipId));

    this.runningJobs.set(descriptor.clipId, job);
    return { status: 'processing', clipPath: descriptor.relativePath };
  }

  async generateClip(descriptor, { sender, term } = {}) {
    const ffmpegPath = this.getFfmpegPath();
    const temporaryPath = path.join(
      this.mediaDirectory,
      `${descriptor.clipId}.${process.pid}.${Date.now()}.tmp.mp4`
    );

    safeSend(sender, 'library:clip-status', {
      clipId: descriptor.clipId,
      status: 'processing',
      term,
      message: 'Sahne klibi hazırlanıyor…'
    });

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', seconds(descriptor.clipStartMs),
      '-i', descriptor.inputPath,
      '-t', seconds(descriptor.durationMs),
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      temporaryPath
    ];

    try {
      await new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe']
        });

        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
          stderr = `${stderr}${chunk}`.slice(-12000);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(stderr.trim() || `FFmpeg ${code} koduyla kapandı.`));
          }
        });
      });

      const outputStats = await fs.stat(temporaryPath);
      if (!outputStats.isFile() || outputStats.size === 0) {
        throw new Error('FFmpeg boş bir klip oluşturdu.');
      }

      await fs.rm(descriptor.outputPath, { force: true });
      await fs.rename(temporaryPath, descriptor.outputPath);
      await this.libraryStore.updateClipStatus(descriptor.clipId, {
        status: 'ready',
        clipPath: descriptor.relativePath,
        clipStartMs: descriptor.clipStartMs,
        clipEndMs: descriptor.clipEndMs,
        error: null
      });

      safeSend(sender, 'library:clip-status', {
        clipId: descriptor.clipId,
        status: 'ready',
        term,
        message: term
          ? `“${term}” için sahne klibi hazır.`
          : 'Sahne klibi hazır.'
      });
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      const message = String(error?.message || error).slice(-2500);
      await this.libraryStore.updateClipStatus(descriptor.clipId, {
        status: 'failed',
        clipPath: descriptor.relativePath,
        clipStartMs: descriptor.clipStartMs,
        clipEndMs: descriptor.clipEndMs,
        error: message
      });

      safeSend(sender, 'library:clip-status', {
        clipId: descriptor.clipId,
        status: 'failed',
        term,
        message: term
          ? `“${term}” kaydedildi ancak sahne klibi hazırlanamadı.`
          : 'Sahne klibi hazırlanamadı.',
        error: message
      });
    }
  }
}

module.exports = { LibraryClipService, DEFAULT_PADDING_MS };
