Mobile import fix v3
====================

This patch replaces expo-document-picker with expo-file-system's native
File.pickFileAsync() picker. On Android, the returned File object keeps the
Storage Access Framework read permission, so the app no longer tries to read
an inaccessible Expo Go DocumentPicker cache URI.

Copy this file over the existing project file:

mobile/src/services/libraryStorage.ts

Then stop Metro and restart it with a cleared cache:

cd "C:\Masaüstü\VideoPlayer - LanguageLearning\mobile"
npx expo start -c --tunnel

Open the new QR code in Expo Go and import the .vpll.zip file again.
