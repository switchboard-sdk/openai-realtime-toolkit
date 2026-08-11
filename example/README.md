# OpenAIRealtimeToolkit example

A minimal OpenAI Realtime voice assistant built on OpenAIRealtimeToolkit:
**microphone → `OpenAI.Realtime` → speaker**, with on-device turn handling
(Silero VAD + SmartTurn) and barge-in, live tuning, and a tool call. React
Native 0.86, new architecture.

## 1. Credentials

The library ships with default Switchboard credentials, and those have an OpenAI API
key associated with them for testing — so the app passes no `appId`, `appSecret`,
or `openAIApiKey` of its own.

**For production, use your own keys.** The shared OpenAI test key is rate-limited
and **rotated without notice**. For Switchboard, get your own credentials from
[console.switchboard.audio](https://console.switchboard.audio), then uncomment
the `SWITCHBOARD_APP_ID` / `SWITCHBOARD_APP_SECRET` constants in
[`App.tsx`](App.tsx) and the provider props that pass them.

To use **your own OpenAI key**, copy the template and fill it in — the app reads it from
`@env` (via `react-native-dotenv`), so it goes in a `.env` file, not in source:

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

`.env` is gitignored; only the `.env.example` template is committed.

## 2. Install

**Install the repo root first**, then this app:

```sh
cd ..            # the repo root
npm install      # installs deps and builds the library (dist/) via `prepare`

cd example
npm install
```

Or from the repo root: `npm run example:install`, which does both in order.

The example symlinks the library from the repo root (`file:..`), and its `types`
point at the built `dist/` — so skipping the root install leaves TypeScript unable
to resolve `@synervoz/openai-realtime-toolkit`. Don't run
`npm install @synervoz/openai-realtime-toolkit` here either; that replaces the
symlink with the published package.

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

> [!NOTE]
> **`xcodebuild exited with error code '70'` after the app has already launched.**
> If the app is installed and running, the build succeeded — exit 70 comes from the
> RN CLI's *post-build* step (picking, booting, or launching on a target), not from
> compilation, and the CLI reports it as a build failure anyway. Name the target
> explicitly so that step can't miss:
>
> ```sh
> npm run ios -- --simulator "iPhone 17"     # an installed simulator name
> npm run ios -- --device "<Your iPhone>"    # a connected device
> ```
>
> `xcrun simctl list devices available` lists the simulator names you have. If the
> app *didn't* launch, this isn't the same thing — the CLI hides the real message,
> so open the workspace and build there to see it:
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

Tap **Start talking**, grant microphone permission, and talk — audio streams to
the OpenAI Realtime model and its reply plays back. The live **You / Assistant**
transcripts appear under **OpenAI**. Things to try:

- **Local turn handling and Barge-In** — toggle it on to run turn detection
  on-device (Silero VAD + SmartTurn) instead of OpenAI's `server_vad`; talk over
  the assistant to cut it off.
- **Noise presets** — with turn handling on, switch between **quiet / balanced /
  noisy**, and nudge **pause tolerance** live with the stepper.
- **Tool call** — ask it to *change the background color*; the model calls the
  app's `set_background_color` tool and the screen updates.
