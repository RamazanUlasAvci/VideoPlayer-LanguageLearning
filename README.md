# VideoPlayer - LanguageLearning

An Electron desktop video player designed for learning English from local videos and subtitles.

The app plays local video files, synchronizes external `.srt` subtitles, translates the currently visible English subtitle on demand, and saves the English word or multiword expression that should be learned together with its full sentence context.

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
- Click any word in the **English subtitle**; the app automatically saves either that single word or the complete expression it belongs to
- Always save the complete English sentence and its translation as context
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
- Full English subtitle sentence
- Full translated sentence
- Translation language used for that context
- Video file name
- Subtitle start and end times
- AI provider, model, and confidence when available
- First and most recent save dates
- Number of saves and all unique contexts

The translation itself is not clickable. It is shown only as meaning support; learning items always come from the English subtitle.

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
- `learning-library.json`
- `gemini-api-key.bin` — encrypted by the operating system

The **Library** button reveals the learning-library file in the file manager.

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
8. The correct word or expression is saved automatically with sentence context.
9. Press `T` again to hide the translation and learning controls.

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
- Persistent English word/expression storage with multilingual sentence contexts

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
- FFmpeg conversion is fully local
- The learning library stays on the user's computer
- Only the active subtitle sentence is sent to the translation provider
- Only the active English sentence and its word tokens are sent to Gemini for phrase analysis
- Gemini Interactions requests are made with `store: false`

## License note

Before redistributing the bundled `ffmpeg-static` binary, review the license terms of the specific FFmpeg build. Commercial distribution should include a proper license review.
