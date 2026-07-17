# VideoPlayer - LanguageLearning Mobile

This is the first mobile phase: an offline companion app for the desktop learning library.

## Current scope

- Imports `.vpll.zip` bundles exported by the desktop app.
- Stores the imported library and scene clips in the app's private storage.
- Lists English words and expressions with CEFR, language and sentence context.
- Plays the independent scene clip.
- Shows the cloze question, English meaning hint, answer, translation, word form, part of speech and two dictionary-style definitions.

It does **not yet** open full movies or create clips on the phone. The full Android/iOS player is the next mobile phase.

## Run

From the repository root:

```bash
npm install
npm run start:mobile
```

For Android Studio/emulator:

```bash
npm run android
```

SDK 57 projects require a current development build during the SDK transition. Run `npx expo run:android` from this folder when Expo Go is not compatible.
