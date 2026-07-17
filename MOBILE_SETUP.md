# Mobile setup on Windows 11

The first mobile milestone is an Android/iOS companion for the desktop learning library. It imports the desktop ZIP bundle and provides offline study cards with scene clips. It is not yet the full movie player.

## Android prerequisites

1. Install Android Studio.
2. In Android Studio, install an Android SDK and create an emulator in Device Manager, or enable USB debugging on an Android phone.
3. Open PowerShell in the repository root.

```powershell
npm install
npm run android
```

The first Android build can take several minutes. Later JavaScript-only changes can be started with:

```powershell
npm run start:mobile
```

## Transfer the library

1. Start the desktop app with `npm start`.
2. Open **Kütüphane**.
3. Select **Mobile aktar** and save the generated `.vpll.zip` file.
4. Copy that file to the Android device.
5. Open the mobile app and select **Import desktop bundle**.

A small test bundle is available at `samples/sample-mobile-library.vpll.zip`.

## iOS

iOS source is included, but compiling and signing an iPhone app requires macOS with Xcode or an EAS cloud build.
