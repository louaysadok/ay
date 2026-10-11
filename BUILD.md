# Building Port Ops Simulator as apps

The game is plain HTML/JS/CSS (about 0.6 MB). Both wrappers just ship `dist/www`
(created by `npm run bundle`). Nothing needs the internet at runtime.

## Run in a browser (development)
    npm start            # http://localhost:4173

## Windows desktop app (Electron)
On a Windows PC with Node 18+:

    npm install
    npm run electron           # run it as a desktop app
    npm run electron:build     # -> release/*.exe (installer + portable)

`desktop/main.cjs` serves the game from a private `app://` scheme (ES modules and
`fetch()` do not work over `file://`), has no menu, and F11 / Alt+Enter toggles full screen.
Saves live in the app's own storage under `%APPDATA%/Port Ops Simulator`.

## Android app (Capacitor)
Needs Android Studio (or JDK 17 + Android SDK):

    npm install
    npm run cap:sync           # bundle + copy into android/
    npm run cap:open:android   # open in Android Studio -> Run / Build APK
    # or from the command line:
    npm run android:debug      # -> android/app/build/outputs/apk/debug/app-debug.apk

The Android project (`android/`) is landscape-locked, immersive, keeps the screen
on, requests no permissions (not even INTERNET) and disables cloud backup.

## No local tools? Build in the cloud
`.github/workflows/build.yml` builds the Windows .exe and the Android debug .apk on
GitHub. Push the repo, open Actions -> "Build desktop + Android apps" -> Run workflow,
then download the artifacts. (Release-signed APKs / store listings need your own keystore.)

## What has and has not been verified
* Bundle step, browser run of the bundled `dist/www`, and `desktop/main.cjs` syntax: verified.
* The Electron window and the Android build were NOT run in the authoring
  environment (no Electron binary download and no Android SDK there). Expect to fix
  small things on the first real build.
