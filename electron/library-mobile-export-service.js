'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function buildPortableLibrary(library, mediaDirectory) {
  const portable = clone(library);
  const clipFiles = new Map();

  for (const item of portable.items || []) {
    for (const context of item.contexts || []) {
      if (context.clipStatus !== 'ready' || !context.clipPath) {
        context.clipPath = null;
        continue;
      }

      const sourcePath = path.resolve(mediaDirectory, path.basename(String(context.clipPath)));
      try {
        const stats = await fsp.stat(sourcePath);
        if (!stats.isFile() || stats.size <= 0) throw new Error('empty');
        const archivePath = `library-media/${path.basename(sourcePath)}`;
        context.clipPath = archivePath;
        clipFiles.set(archivePath, sourcePath);
      } catch {
        context.clipPath = null;
        context.clipStatus = 'failed';
        context.clipError = 'The clip file was missing when this mobile bundle was exported.';
      }
    }
  }

  return { portable, clipFiles };
}

class LibraryMobileExportService {
  constructor({ libraryStore, mediaDirectory }) {
    this.libraryStore = libraryStore;
    this.mediaDirectory = mediaDirectory;
  }

  async exportToZip(outputPath) {
    const archiver = require('archiver');
    const library = await this.libraryStore.getItems();
    const { portable, clipFiles } = await buildPortableLibrary(library, this.mediaDirectory);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    const manifest = {
      format: 'vpll-mobile-library',
      version: 1,
      createdAt: new Date().toISOString(),
      libraryVersion: portable.version,
      itemCount: portable.items.length,
      clipCount: clipFiles.size
    };

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('warning', (error) => error.code === 'ENOENT' ? undefined : reject(error));
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' });
      archive.append(`${JSON.stringify(portable, null, 2)}\n`, { name: 'learning-library.json' });
      for (const [archivePath, sourcePath] of clipFiles) archive.file(sourcePath, { name: archivePath });
      archive.finalize();
    });

    return { outputPath, itemCount: portable.items.length, clipCount: clipFiles.size };
  }
}

module.exports = { LibraryMobileExportService, buildPortableLibrary };
