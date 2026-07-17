export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'UNKNOWN';
export interface LibraryContext {
  id: string;
  sourceSentence: string;
  translatedSentence: string;
  targetLanguage: string;
  cefrLevel: CefrLevel;
  dictionaryDefinitions: string[];
  dictionaryLemma?: string | null;
  partOfSpeech?: string | null;
  wordForm?: string | null;
  studyAnswer: string;
  studyQuestion: string;
  studyHint?: string | null;
  clipPath?: string | null;
  clipStatus?: string;
  [key: string]: unknown;
}
export interface LibraryItem {
  id: string;
  term: string;
  lemma: string;
  unitType: string;
  sourceLanguage: string;
  contexts: LibraryContext[];
  [key: string]: unknown;
}
export interface LearningLibrary { version: number; items: LibraryItem[]; }
export function normalizeCefrLevel(value: unknown): CefrLevel;
export function createClozeQuestion(sourceSentence: unknown, answer: unknown, sourceStart?: number | null, sourceEnd?: number | null): string;
export function validatePortableLibrary(value: unknown): LearningLibrary;
export function flattenLibrary(library: LearningLibrary): Array<{item: LibraryItem; context: LibraryContext; key: string}>;
export function languageLabel(code: unknown): string;
export function isSafeBundlePath(value: unknown): boolean;
