import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';
import {
  isSafeBundlePath,
  validatePortableLibrary,
  type LearningLibrary,
  type LibraryContext,
} from '@vpll/core';

const STORAGE_KEY = 'vpll.mobile.library.v1';
const ROOT_NAME = 'vpll-library';

function rootDirectory() {
  return new Directory(Paths.document, ROOT_NAME);
}

/**
 * Uses expo-file-system's own native picker instead of expo-document-picker.
 * The returned File object keeps the Android Storage Access Framework read
 * permission attached to the native file handle, avoiding Expo Go cache URI
 * permission failures.
 */
async function pickBundleFile(): Promise<File | null> {
  const picked = await File.pickFileAsync({
    multipleFiles: false,
    mimeTypes: [
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
      '*/*',
    ],
  });

  if (picked.canceled) return null;
  return picked.result;
}

export async function loadLibrary(): Promise<LearningLibrary | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  return validatePortableLibrary(JSON.parse(stored));
}

export async function clearLibrary(): Promise<void> {
  const root = rootDirectory();
  if (root.exists) root.delete();
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export function resolveClipUri(context: LibraryContext): string | null {
  if (!context.clipPath || !isSafeBundlePath(context.clipPath)) return null;
  const file = new File(rootDirectory(), ...context.clipPath.split('/'));
  return file.exists ? file.uri : null;
}

export async function importDesktopBundle(): Promise<LearningLibrary | null> {
  const selected = await pickBundleFile();
  if (!selected) return null;

  let archive: Record<string, Uint8Array>;
  try {
    const bytes = await selected.bytes();
    archive = unzipSync(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The selected bundle could not be read or extracted: ${message}`);
  }

  const manifestBytes = archive['manifest.json'];
  const libraryBytes = archive['learning-library.json'];
  if (!manifestBytes || !libraryBytes) {
    throw new Error('This ZIP is not a VideoPlayer mobile library bundle.');
  }

  const manifest = JSON.parse(strFromU8(manifestBytes));
  if (manifest.format !== 'vpll-mobile-library' || manifest.version !== 1) {
    throw new Error('Unsupported mobile library bundle version.');
  }

  const library = validatePortableLibrary(JSON.parse(strFromU8(libraryBytes)));

  const root = rootDirectory();
  if (root.exists) root.delete();
  root.create({ intermediates: true, idempotent: true });

  for (const [entryPath, bytes] of Object.entries(archive)) {
    if (!entryPath.startsWith('library-media/') || !isSafeBundlePath(entryPath)) continue;
    const target = new File(root, ...entryPath.split('/'));
    target.create({ intermediates: true, overwrite: true });
    target.write(bytes);
  }

  const portableLibraryFile = new File(root, 'learning-library.json');
  portableLibraryFile.create({ intermediates: true, overwrite: true });
  portableLibraryFile.write(`${JSON.stringify(library, null, 2)}\n`);

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  return library;
}
