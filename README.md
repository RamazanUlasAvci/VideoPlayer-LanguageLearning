# VideoPlayer - LanguageLearning

An Electron desktop video player designed for learning English from local videos and subtitles.

The app plays local video files, synchronizes external `.srt` subtitles, translates the currently visible English subtitle on demand, and saves the English word or multiword expression that should be learned together with its full sentence context.

## Learning library screen

The in-app library lists every saved English word or multi-word expression together with its full sentence context, translation, contextual CEFR estimate, two concise dictionary-style definitions, part of speech, grammatical form, video name, timestamp, and independent scene clip. It supports search, filtering by translation language and CEFR level, direct clip playback, and deletion. Deleting an entry also removes scene clips that are no longer referenced by another saved item.

## Features

- Open `.mp4`, `.mkv`, `.mov`, `.m4v`, and `.webm` video files
- Drag and drop a video, an `.srt` subtitle, or both at the same time
- Parse UTF-8, UTF-16 LE/BE, and common Windows Turkish subtitle encodings
- Keep subtitles synchronized with video playback
- Press `Space` to play or pause without triggering the video control twice
- Press `T` to translate only the subtitle currently visible on screen
- Choose the target translation language on first launch and remember it permanently
- Change the target language later from the toolbar
- Use Gemini to identify English phrasal verbs, idioms, fixed expressions, collocations, compound terms, and proper names
- Estimate A1–C2 vocabulary difficulty for the word or expression as it is used in the current sentence
- Enrich each clicked learning item with its base form, part of speech, grammatical surface form, and up to two concise English dictionary-style definitions
- Create a cloze study prompt from the exact subtitle sentence, such as `At that time I [...] the information.`
- Show a concise semantic hint in the selected translation language before revealing the answer
- Filter the learning library by contextual CEFR level, including an `Undetermined` category for older or low-confidence records
- Click any word in the **English subtitle**; the app automatically saves either that single word or the complete expression it belongs to
- Always save the complete English sentence and its translation as context
- Automatically cut an independent, audible MP4 scene clip for every saved subtitle context
- Reuse one scene clip when several learning units are saved from the same subtitle
- Store the learning library permanently as JSON
- Cache sentence translations and successful Gemini analyses locally
- Select an audio output device such as headphones, speakers, or a DAC
- Convert unsupported codec combinations locally to H.264/AAC MP4 with FFmpeg
- Build Windows installer and portable `.exe` packages

## How contextual saving works

The user never has to decide whether something is a single word or an expression.

When `T` is pressed, the app performs two tasks once for the current subtitle:

1. It translates the full English subtitle into the selected language.
2. It analyzes the indexed English words and identifies only the spans that should be learned together.

For example, in:

```text
I am looking forward to seeing you.
```

clicking `looking`, `forward`, or `to` saves the learning unit:

```text
look forward to
```

Clicking a word that is not part of a detected multiword expression saves only that word.

Every item is stored with:

- English term or expression
- Normalized/base form when available
- Unit type, such as `word`, `phrasal_verb`, `idiom`, or `fixed_expression`
- Contextual CEFR estimate (`A1`–`C2` or `UNKNOWN`) and confidence
- Dictionary/base lemma, part of speech, and the grammatical form used in the subtitle
- Up to two concise English dictionary-style definitions, with the contextual sense first
- A deterministic cloze question, a target-language semantic hint, and its answer
- Full English subtitle sentence
- Full translated sentence
- Translation language used for that context
- Video file name
- Subtitle start and end times
- A local scene-clip reference and clip generation status
- AI provider, model, and confidence when available
- First and most recent save dates
- Number of saves and all unique contexts

The translation itself is not clickable. It is shown only as meaning support; learning items always come from the English subtitle.


## Contextual CEFR estimates

CEFR is stored on each sentence context rather than as a permanent property of a spelling. This matters because the same English word can have an easier literal meaning and a more advanced figurative or domain-specific meaning.

For example, `run` in `run quickly`, `run a company`, and `run out of time` may receive different learning-unit and CEFR results. Gemini estimates the level in the same request that detects single-word and multiword learning units, so no second AI call is needed.

The library displays the estimate as an AI-generated label and supports filtering by `A1`, `A2`, `B1`, `B2`, `C1`, `C2`, or `Undetermined`. Existing records created before this feature are migrated safely as `UNKNOWN`; they are not assigned a fabricated level.

CEFR labels are content-difficulty metadata only. They do not replace future spaced-repetition scheduling, which should be based on the individual learner's review performance.

## Dictionary enrichment and study-card preview

When a learning item is clicked, Gemini performs one cached lexical-enrichment request for that term in its sentence. It returns the dictionary lemma, contextual part of speech, grammatical form of the surface word, and up to two concise English dictionary-style definitions. The first definition is required to match the sense used in the subtitle; the second is another common distinct sense when useful.

The cloze prompt is not invented by AI. The application masks the exact clicked token span in the original subtitle, which preserves the authentic sentence and avoids hallucinated study questions. For example:

```text
Scene clip
At that time I [...] the information.
```

The library initially shows the question, clip, and a short meaning hint in the selected translation language. The hint describes the contextual sense without containing the English answer. **Show answer** reveals the saved term, the complete source sentence, translation, part of speech, word form, base form, and dictionary definitions. Older records remain compatible and display a notice until they are saved again with the new metadata.

Dictionary definitions are AI-generated dictionary-style explanations, not quotations from a licensed commercial dictionary. Successful lexical enrichments are cached in `lexical-enrichment-cache.json`. The cache key includes the target language because the same English item can require different hints for Turkish, Japanese, Norwegian, or another selected language.

## Automatic scene clips

When an English word or expression is saved, the app also creates a standalone MP4 clip from that subtitle's time range. It adds 400 ms before and after the subtitle so that speech is less likely to be cut off.

Clip generation runs in the Electron main process with the bundled FFmpeg binary. The learning item is saved immediately, while the clip is prepared in the background. If clip generation fails, the English term, sentence, translation, and timestamps remain safely stored in the library. Saving the item again retries the clip.

Several words or expressions saved from the same video and subtitle range share the same clip file instead of creating duplicates. The resulting clip is independent of the original video, so it remains usable even if the source video is later moved or deleted.

## Gemini AI setup

Smart phrase detection uses the Gemini API. The application currently uses the `gemini-3.5-flash` model through the Gemini Interactions API.

1. Create a Gemini API key in Google AI Studio.
2. Start the application.
3. Click **AI Settings** in the toolbar.
4. Paste the API key and click **Save Key**.

The key is not written to the source code, repository, or renderer process. It is encrypted with Electron `safeStorage`, which uses the operating system's secure storage mechanism.

You may alternatively define the environment variable before starting the application:

```powershell
$env:GEMINI_API_KEY="your-key"
npm start
```

If no Gemini key is configured, the player remains usable and applies a small, conservative local expression list. The toolbar clearly shows that AI is disabled. This fallback is less capable than Gemini and is intended only to keep the player functional.

## Translation system

The current prototype uses the online **MyMemory Translation API**. No local translation dictionary is required.

Only the currently visible English subtitle sentence is sent for translation. Videos, complete subtitle files, and the learning library are never uploaded.

Translations are stored in `translation-cache.json`, separated by source text and target language.

## Local data

Electron stores application data in its standard user-data directory:

- Windows: `%APPDATA%\video-player-language-learning\`
- macOS: `~/Library/Application Support/video-player-language-learning/`
- Linux: `~/.config/video-player-language-learning/`

The directory can contain:

- `preferences.json`
- `translation-cache.json`
- `learning-unit-analysis-cache.json`
- `lexical-enrichment-cache.json`
- `learning-library.json`
- `library-media/` — independent MP4 scene clips linked to learning contexts
- `gemini-api-key.bin` — encrypted by the operating system

The **Library** button opens the in-app learning library. The **Open file folder** action inside that screen reveals the JSON file and scene clips in the file manager.

## Requirements

- Windows 10/11, macOS, or a recent Linux distribution
- A current Node.js LTS release
- Internet access for `npm install`
- Internet access for uncached translations
- A Gemini API key for AI-based phrase analysis

## Installation

Open a terminal in the project directory and run:

```bash
npm install
npm start
```

On Windows, `KURULUM-VE-BASLAT.bat` can also be used.

## Usage

1. Start the application.
2. Select the target translation language on first launch.
3. Configure Gemini under **AI Settings**.
4. Open or drag in a video file.
5. Open or drag in an English `.srt` subtitle file.
6. Pause on a subtitle and press `T`.
7. Click a word in the English subtitle.
8. The correct word or expression is saved immediately with sentence context.
9. A short audible scene clip is prepared in the background and linked to that context.
10. Press `T` again to hide the translation and learning controls.

## Audio output

The **Choose Device** button uses Chromium audio-output selection. Available speakers, headphones, and DACs appear after permission is granted.

The chosen device is applied to the video element and remembered locally. Operating-system and driver support may affect device availability.

## MKV and MOV compatibility

MKV and MOV are container formats and may contain codecs Electron cannot decode directly.

When direct playback fails, the app can create a local compatible copy using:

- H.264 video
- AAC audio
- MP4 container

The original file is not modified or uploaded. Converted files are stored in the operating system's temporary directory.

## Build for Windows

```bash
npm run dist:win
```

Build output is written to `dist/` and includes an NSIS installer and a portable `.exe`.

## Tests

```bash
npm test
```

The automated tests cover:

- SRT parsing and subtitle lookup
- Language preference persistence
- Translation cache separation by language
- English tokenization and source offsets
- Local expression fallback behavior
- Validation of non-overlapping AI spans
- Contextual CEFR normalization for single words and multiword units
- Lexical metadata sanitization, answer-safe semantic hints, and two-definition limits
- Deterministic cloze-question generation using exact subtitle spans
- Persistent English word/expression storage with multilingual sentence contexts
- Stable scene-clip IDs, subtitle padding, and shared clip status updates

## Security design

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- The renderer receives only a limited IPC API from the preload script
- The Gemini key never enters the renderer process
- The Gemini key is encrypted with Electron `safeStorage`
- `.env` files and local generated data are ignored by Git
- The renderer cannot send arbitrary file paths to FFmpeg
- External pages cannot navigate inside the application

## Privacy

- Videos stay on the user's computer
- Subtitle files stay on the user's computer
- FFmpeg conversion and scene clipping are fully local
- The learning library and generated scene clips stay on the user's computer
- Only the active subtitle sentence is sent to the translation provider
- Only the active English sentence and its word tokens are sent to Gemini for phrase analysis and contextual CEFR estimation
- When a learning item is clicked, only that term and its active sentence are sent to Gemini for dictionary-style lexical enrichment
- Gemini Interactions requests are made with `store: false`

## License note

Before redistributing the bundled `ffmpeg-static` binary, review the license terms of the specific FFmpeg build. Commercial distribution should include a proper license review.


### Library layout

The in-app library uses a single-open accordion and an independently scrollable content area, so expanding a saved item reveals its sentence, translation, metadata, and scene clip without compressing the other cards.


## Mobile companion app

The repository now includes an Expo/React Native mobile companion in `mobile/` and shared library helpers in `packages/core/`.

1. In the desktop app, open **Library** and select **Mobile aktar**.
2. Move the generated `.vpll.zip` bundle to the phone.
3. Start the mobile app and import the bundle.
4. Study cards and independent scene clips work offline after import.

```bash
npm install
npm run start:mobile
```

The current mobile milestone is intentionally a companion app. Full local movie playback, SRT selection and native clip extraction will be added after the shared study/library workflow is stable.
