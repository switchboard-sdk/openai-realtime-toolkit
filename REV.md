# Review feedback — issues and solutions

Plain-language write-up of the five things that were flagged, what each one
actually means, and how to fix it.

---

## 1. Turn-detection docs are too technical

**What was flagged:** The turn-detection section of the README throws a table of
knobs (`vadThreshold`, `semanticStrategy`, `minSemanticConfidence`, …) at the
reader without ever explaining *how turn detection works*. If you don't already
know that there's a VAD stage feeding a semantic ("is the sentence finished?")
stage, the knobs read as noise — you can't tell which one to touch to get the
behavior you want.

**Why it happens:** The docs were written by someone who knows the internals.
They describe each knob correctly but assume you know the pipeline the knob sits
in. There's no "here's the flow, here's where each knob plugs in" paragraph.

**Solution:** Add a short conceptual intro before the tables that describes the
turn-detection flow in one or two paragraphs, then frame every knob as "this
tunes *this* stage." Concretely:

- **Explain the pipeline first.** Something like: *"Local turn detection decides
  when you've finished speaking so the assistant can reply. It runs in two
  stages. First, **SileroVAD** listens for whether you're speaking at all (voice
  vs. silence). When it hears you go quiet, a second model, **SmartTurn**, looks
  at what you said and judges whether it sounds like a *complete* thought or a
  mid-sentence pause. Only when both agree your turn is over does the toolkit
  commit your turn to the model."*
- **Group the knobs by the question they answer**, which the README already
  starts doing ("when is the user's turn over?" / "how is the AI interrupted?").
  Lead each row with the plain effect, not the component name — e.g.
  `vadThreshold` → *"How loud speech has to be before it counts as talking.
  Raise it in a noisy room so background sound isn't heard as speech."*
- **Add a "which knob do I reach for?" cheat line** per common complaint:
  - *"It cuts me off mid-sentence"* → raise `pauseToleranceMs` and/or use
    `semanticStrategy: 'gate'`.
  - *"It's slow to respond after I stop"* → lower `vadSilenceMs` /
    `pauseToleranceMs`.
  - *"Background noise triggers it"* → raise `vadThreshold`, use the
    `NOISY_CONFIG` preset.
- **Point people at the presets first.** Most users should pick
  `QUIET_CONFIG` / `BALANCED_CONFIG` / `NOISY_CONFIG` and never touch a knob.
  Make that the recommended path and treat the knob table as the advanced
  reference below it.

---

## 2. Not clear you must `npm install` in the repo root first

**What was flagged:** To run the example app you have to run `npm install` in the
**repo root** before running `npm install` inside `example/`. Nothing in the docs
says this, so a first-timer goes straight to the example and hits failures.

**Why it happens:** The example depends on the library via `file:..` (a local
symlink to the repo root). The library's entry point is the compiled
`dist/index.js` (`"main": "dist/index.js"` in [package.json](package.json)), and
`dist/` is produced by the root's build step (`prepare` → `npm run build`), which
only runs when the root's own `npm install` runs. So without a root install:

- the root `dist/` may be missing/stale, and
- Metro resolves `react` / `react-native` against the root `node_modules` (see
  the example's [metro.config.js](example/metro.config.js) `extraNodeModules`),
  which doesn't exist until the root is installed.

The example's own [README](example/README.md) jumps straight to "1. Credentials
→ 2. Install (`npm install` inside `example/`)" with no mention of the root.

**Solution:** Make the root install an explicit **step 0**. In both the top-level
[README](README.md) (a "Running the example" section) and
[example/README.md](example/README.md), add before the credentials step:

```sh
# from the repo root — installs deps and builds the library (dist/)
npm install

# then set up and run the example
cd example
npm install
```

One line of prose is enough: *"The example consumes the library from the repo
root via `file:..`, so install and build the root first — `npm install` at the
root runs the build automatically."* Optionally add a root `example` convenience
script (e.g. `"example:install": "npm install && cd example && npm install"`) so
the ordering can't be gotten wrong.

---

## 3. iOS example: `xcodebuild exited with error code '70'` (but app runs fine)

**What was flagged:** Running the iOS example prints:

```
error Failed to build ios project. "xcodebuild" exited with error code '70'.
To debug build logs further, consider building your app with Xcode.app,
by opening 'OpenAIRealtimeToolkitExample.xcworkspace'.
```

…yet the app builds, installs, and runs fine.

**Why it happens:** Exit code `70` from `xcodebuild` is almost always **not** a
compile failure — the build clearly succeeds since the app runs. It's the RN CLI
failing at a *post-build* step: most commonly it couldn't pick/boot the target
device or simulator, or code signing/launch returned non-zero. The binary is
already built and installed, so you see a running app plus a red error line.

Common concrete causes:

- No simulator specified / the default one wasn't booted, so the launch step
  fails after the build.
- On a physical device, a signing or install hiccup (the build artifact exists,
  the install/launch returns 70).
- The CLI's log parser treats a non-zero exit from the launch phase as a build
  failure even though compilation passed.

**Solution:**

- **Confirm it's benign** (it is, if the app is on the device/simulator) and stop
  it from looking like a real failure. Tell the CLI exactly what to run on so the
  post-build launch step can't miss:

  ```sh
  npm run ios -- --simulator "iPhone 15"     # or your installed sim name
  # physical device:
  npm run ios -- --device "<Your iPhone>"
  ```

- **Get the real reason** once, by building the workspace directly — the RN CLI
  hides the underlying message, Xcode shows it:

  ```sh
  open example/ios/OpenAIRealtimeToolkitExample.xcworkspace
  ```

  (This is already what the CLI's own message suggests.)

- **Document it.** Add a short "Known issue" note to
  [example/README.md](example/README.md): *"`npm run ios` may print
  `xcodebuild exited with error code 70` after the app has already launched.
  This is a post-build launch/device-selection error, not a build failure — pass
  `--simulator "<name>"` or `--device "<name>"` to select a target explicitly."*

- **Reproduce it properly before shipping a real fix.** If it turns out to be
  signing on device, the fix belongs in the signing steps the README already has
  (section 3 → "Set up iOS code signing").

---

## 4. Android: reconnect flips state to "error" a few seconds after "connected"

**What was flagged:** On Android — Start talking → converse → Stop talking →
Start talking again → status shows **connected**, then flips to **error** after
2–3 seconds. The agent still works.

**Why it happens:** The provider maps the raw OpenAI event stream straight to the
public status, and treats **any** `error` event as terminal:

[OpenAIRealtimeToolkitProvider.tsx](src/OpenAIRealtimeToolkitProvider.tsx#L156-L167)

```tsx
case 'sessionStarting':
case 'sessionDisconnected':
  setConnectionStatus('connecting')
  break
case 'sessionCreated':
  setConnectionStatus('connected')
  break
case 'error':
  setConnectionStatus('error')     // <- any error, even a benign/transient one
  break
```

On a **second** `start()` the previous WebSocket session is torn down and a new
one opened. During that reconnect the server (or the teardown of the old socket)
emits an `error`-type event — a stale/transient one that doesn't actually break
the new session. Because the handler flips to `'error'` on any error and nothing
ever moves it back, the UI shows `connected` (from the fresh `sessionCreated`)
and then `error` a couple of seconds later when the late event from the old
session lands. The audio path is unaffected, which is why "the agent works."

**Solution:** Stop treating every `error` event as a terminal connection state.
Options, best first:

- **Only surface errors that actually end the session.** Inspect the error
  payload and ignore transient ones; keep `connected` unless the session is
  really gone. e.g.

  ```tsx
  case 'error': {
    const fatal = (e.data as { fatal?: boolean })?.fatal ?? false
    if (fatal) setConnectionStatus('error')
    // else: log it, keep current status
    break
  }
  ```

- **Recover from error.** When a fresh `sessionCreated` arrives, it should always
  win — a late `error` from the *old* session must not override a *new* live one.
  Tag events with a session id (or ignore `error` events that arrive after a
  newer `sessionCreated`) so stale events from the torn-down session are dropped.

- **Clean teardown on `stop()`.** Ensure `stop()` fully closes the old session
  and its listeners before the next `start()` opens a new one, so the old socket
  can't emit into the new session's state. (`stop()` already resets status to
  `'none'`; the issue is the old session's async error landing afterward.)

Whichever we pick, the fix lives in the `error` branch of the event handler in
[OpenAIRealtimeToolkitProvider.tsx](src/OpenAIRealtimeToolkitProvider.tsx#L165);
the goal is that a reconnect settles on `connected` and only genuine failures
show `error`.

---

## 5. Hallucinations from background noise (people talking in another room)

**What was flagged:** With background noise present (including people talking in
another room), the model produces hallucinated input/responses. Reporter notes
it's *probably out of scope*, but worth mentioning.

**Why it happens:** This is expected behavior for an open-mic streaming setup,
not a bug in the toolkit. Everything the microphone picks up — including other
people's speech — is streamed to OpenAI, which transcribes and responds to it.
The turn detector decides *when* a turn ends, but it doesn't decide *whose* voice
counts; there's no speaker separation. So background speech becomes input.

**Solution:** Agree it's largely out of scope for what this library does, but
there are practical mitigations, so document them rather than leave it unhandled:

- **Tune turn detection for noise.** This is exactly what `NOISY_CONFIG` and a
  higher `vadThreshold` are for — they make the VAD demand louder, closer speech
  before it counts as a turn, which cuts down on distant chatter triggering the
  model. Cross-reference this from issue #1's docs.
- **Lean on the hardware.** The graph already uses VPIO (hardware echo
  cancellation); note that a headset/close-talking mic dramatically reduces
  pickup of room noise.
- **Set expectations in the README.** Add a one-line "Limitations" note: *"The
  toolkit streams all microphone audio to the model and does not do speaker
  separation, so loud background speech can be transcribed as input. Use
  `NOISY_CONFIG` / raise `vadThreshold`, or a close-talking mic, in noisy
  environments."*
- **Out of scope (call out explicitly):** true noise suppression / speaker
  diarization / wake-word gating would be a separate feature, not part of turn
  detection. Worth a backlog note if it's a recurring ask.
