# openai-realtime-toolkit example

A minimal OpenAI Realtime voice agent built on `@synervoz/openai-realtime-toolkit`: microphone to OpenAI Realtime to speaker, with on-device turn handling and barge-in, live tuning, and a tool call. React Native 0.86, New Architecture.

## 1. Credentials

The toolkit ships with default audio-engine credentials, and those have an OpenAI API key associated with them for testing, so the app passes no `appId`, `appSecret`, or `openAIApiKey` of its own.

**For production, use your own keys.** The shared OpenAI test key is rate-limited and rotates without notice. For the audio engine, get your own credentials from [console.switchboard.audio](https://console.switchboard.audio), then uncomment the `appId` and `appSecret` props in [`App.tsx`](App.tsx) and fill them in.

To use **your own OpenAI key**, copy the template and fill it in. The app reads it from `@env` (via `react-native-dotenv`), so it goes in a `.env` file rather than in source:

```sh
cp .env.example .env
# then edit .env and set your key:
# OPENAI_API_KEY=sk-...
```

Then uncomment the two lines in [`App.tsx`](App.tsx) that wire it up:

```tsx
import { OPENAI_API_KEY } from '@env';
// …
<OpenAIRealtimeToolkitProvider openAIApiKey={OPENAI_API_KEY} … >
```

`.env` is gitignored, and only the `.env.example` template is committed.

## 2. Install

**Install the repo root first**, then this app:

```sh
cd ..            # the repo root
npm install      # installs deps and builds the library (dist/) via `prepare`

cd example
npm install
```

Or, from the repo root, run `npm run example:install`, which does both in order.

The example symlinks the library from the repo root (`file:..`), and its `types` point at the built `dist/`, so skipping the root install leaves TypeScript unable to resolve `@synervoz/openai-realtime-toolkit`. Do not run `npm install @synervoz/openai-realtime-toolkit` here either, since that replaces the symlink with the published package.

### How Metro finds the local library ([metro.config.js](metro.config.js))

Because the library is symlinked to the repo root (`..`), its source lives **outside** this app folder, where Metro does not look by default. That is the `FailedToResolveNameError: Module does not exist in the Haste module map` you would otherwise get. [`metro.config.js`](metro.config.js) fixes it:

- `watchFolders: [root]` lets Metro serve the library's `src/` from the repo root.
- `blockList` and `extraNodeModules` force `react` and `react-native` to resolve from **this app's** `node_modules`. The repo root has its own copies (the library's devDependencies), and without this Metro sees two of each and fails with a Haste collision.

Metro caches aggressively, so after changing this, or on the first run, reset it:

```sh
npx react-native start --reset-cache
```

## 3. Run

### iOS

CocoaPods is pinned via this example's [`Gemfile`](Gemfile), so install it with Bundler and run `pod` through `bundle exec`. This avoids the `command not found: pod` you would hit without a global CocoaPods install:

```sh
bundle install                                # one-time: installs the pinned `pod` tool
cd ios && bundle exec pod install && cd ..    # downloads the audio xcframeworks
npm run ios
```

> Prefer a global CocoaPods? Run `gem install cocoapods` (or `brew install cocoapods`), then plain `pod install` works too. The Bundler flow above uses the version this repo is tested with.

`npm run ios` targets the simulator by default. To run on a **physical device** (recommended for real microphone and audio testing), set up code signing first. See React Native's [Running On Device](https://reactnative.dev/docs/running-on-device) guide for background.

> [!NOTE]
> **`xcodebuild exited with error code '70'` after the app has already launched.**
> If the app is installed and running, the build succeeded. Exit 70 comes from the RN CLI's *post-build* step (picking, booting, or launching on a target), not from compilation, and the CLI reports it as a build failure anyway. Name the target explicitly so that step cannot miss:
>
> ```sh
> npm run ios -- --simulator "iPhone 17"     # an installed simulator name
> npm run ios -- --device "<Your iPhone>"    # a connected device
> ```
>
> `xcrun simctl list devices available` lists the simulator names you have. If the app *did not* launch, this is a different problem, and the CLI hides the real message, so open the workspace and build there to see it:
>
> ```sh
> open ios/OpenAIRealtimeToolkitExample.xcworkspace
> ```

#### Set up iOS code signing for your device

1. Open the Xcode workspace:

   ```sh
   open ios/OpenAIRealtimeToolkitExample.xcworkspace
   ```

2. In Xcode, select the **OpenAIRealtimeToolkitExample** project in the navigator, then select the **OpenAIRealtimeToolkitExample** target.
3. Go to the **Signing & Capabilities** tab (keep **Automatically manage signing** checked).
4. Under **Team**, select your Apple Developer account. Xcode automatically registers the app ID and generates a provisioning profile.
   - If you do not see a team, click **Add an Account…** and sign in with your Apple ID. A free Apple ID (without a paid developer membership) is enough to run on a personal device.
   - If Xcode shows a bundle ID conflict, change the **Bundle Identifier** to something unique (for example `com.yourname.openairealtimetoolkitexample`) and try again.
   - Make sure your device is connected and trusted by Xcode (unlock it and tap **Trust** if prompted).
   - Add the device to your provisioning profile if prompted.
5. Close Xcode.

> This step is only needed once. After Xcode creates the profile, all future CLI builds sign without reopening Xcode.

Then build and run on the connected device:

```sh
npm run ios -- --device                       # or: npx react-native run-ios --device "<Your iPhone>"
```

- Choose your connected device from the list if prompted, or just press **Run ▶** in Xcode after selecting the device.
- If macOS prompts "codesign wants to access key '...' in your keychain", enter your macOS login password and click **Always Allow** to let Xcode sign the app.
- Metro starts automatically, and the app connects to it over your local network, so keep the Metro terminal running.

### Android

No Android config is needed. The toolkit's config plugin injects the audio-engine Maven repo and Prefab into the app automatically.

```sh
npm run android
```

## 4. Try it

Tap **Start talking**, grant microphone permission, and talk. Audio streams to the OpenAI Realtime model and its reply plays back. The live **You / Assistant** transcripts appear under **OpenAI**. Things to try:

- **Local turn handling and barge-in.** Toggle it on to run turn detection on-device instead of OpenAI's `server_vad`, then talk over the agent to cut it off.
- **Noise presets.** With turn handling on, switch between **quiet**, **balanced**, and **noisy**, and nudge **pause tolerance** live with the stepper.
- **Tool call.** Ask it to *change the background color*. The model calls the app's `set_background_color` tool and the screen updates.
