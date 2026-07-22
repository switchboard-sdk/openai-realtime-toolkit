# OpenAIRealtimeToolkit example

A minimal OpenAI Realtime voice assistant built on OpenAIRealtimeToolkit:
**microphone → `OpenAI.Realtime` → speaker**, with a `Silero.VAD` tap for
voice-activity events. React Native 0.86, new architecture.

## 1. Credentials

Edit [`App.tsx`](App.tsx) and set:

```ts
const SWITCHBOARD_APP_ID = 'YOUR_APP_ID';      // console.switchboard.audio
const SWITCHBOARD_APP_SECRET = 'YOUR_APP_SECRET';
const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY';
```

## 2. Install

```sh
npm install
```

This symlinks the OpenAIRealtimeToolkit library from the repo root (`file:..`). Do **not**
run `npm install @synervoz/openai-realtime-toolkit` — that would try to fetch
the (unpublished) package from npm. The plain `npm install` uses the local copy.

### How Metro finds the local library ([metro.config.js](metro.config.js))

Because the library is symlinked to the repo root (`..`), its source lives
**outside** this app folder, where Metro doesn't look by default — hence the
`FailedToResolveNameError: Module does not exist in the Haste module map` you'd
otherwise get. [`metro.config.js`](metro.config.js) fixes it:

- `watchFolders: [root]` — lets Metro serve the library's `src/` from the repo root.
- `blockList` + `extraNodeModules` — force `react` / `react-native` to resolve
  from **this app's** `node_modules`. The repo root has its own copies (the
  library's devDependencies), and without this Metro sees two of each and fails
  with a Haste collision.

Metro caches aggressively, so after changing this (or on the first run) reset it:

```sh
npx react-native start --reset-cache
```

## 3. Run

### iOS

CocoaPods is pinned via this example's [`Gemfile`](Gemfile), so install it with
Bundler and run `pod` through `bundle exec` (avoids the `command not found: pod`
you'd hit without a global CocoaPods install):

```sh
bundle install                                # one-time: installs the pinned `pod` tool
cd ios && bundle exec pod install && cd ..    # downloads the Switchboard xcframeworks
npm run ios
```

> Prefer a global CocoaPods? `gem install cocoapods` (or `brew install
> cocoapods`), then plain `pod install` works too — but the Bundler flow above
> uses the version this repo is tested with.

`npm run ios` targets the simulator by default. To run on a **physical device**
(recommended for real microphone/audio testing), set up code signing first — see
React Native's [Running On Device](https://reactnative.dev/docs/running-on-device)
guide for background.

#### Set up iOS code signing for your device

1. Open the Xcode workspace:

   ```sh
   open ios/OpenAIRealtimeToolkitExample.xcworkspace
   ```

2. In Xcode, select the **OpenAIRealtimeToolkitExample** project in the navigator, then select the **OpenAIRealtimeToolkitExample** target.
3. Go to the **Signing & Capabilities** tab (keep **Automatically manage signing** checked).
4. Under **Team**, select your Apple Developer account. Xcode automatically registers the app ID and generates a provisioning profile.
   - If you don't see a team, click **Add an Account…** and sign in with your Apple ID. A free Apple ID (without a paid developer membership) is sufficient to run on a personal device.
   - If Xcode shows a bundle ID conflict, change the **Bundle Identifier** to something unique (e.g. `com.yourname.openairealtimetoolkitexample`) and try again.
   - Ensure your device is connected and trusted by Xcode (unlock it and tap **Trust** if prompted).
   - Add the device to your provisioning profile if prompted.
5. Close Xcode.

> This step is only needed once. After Xcode creates the profile, all future CLI builds sign without reopening Xcode.

Then build and run on the connected device:

```sh
npm run ios -- --device                       # or: npx react-native run-ios --device "<Your iPhone>"
```

- Choose your connected device from the list if prompted (or just press **Run ▶** in Xcode after selecting the device).
- If macOS prompts "codesign wants to access key '...' in your keychain", enter your macOS login password and click **Always Allow** to let Xcode sign the app.
- Metro starts automatically; the app connects to it over your local network — keep the Metro terminal running.

### Android
No Android config needed — the OpenAIRealtimeToolkit library injects the Switchboard Maven
repo + Prefab into the app automatically.

```sh
npm run android
```

## 4. Try it

Tap **Start**, grant microphone permission, and talk — audio streams to the
OpenAI Realtime model and its reply plays back. The **Events** log shows
Switchboard events (VAD activity, etc.) arriving over the JSON-RPC channel.
