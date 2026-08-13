# Turn detection

Turn-taking is what separates a talking agent from a voice product. It decides when your user has actually finished a thought, and it gets the agent out of the way the moment they cut in. The [landing README](../README.md) covers the idea. This is the depth behind it: the two stages, barge-in, the presets, tuning by symptom, and the full knob reference.

## Why the built-in modes only get you so far

Out of the box, OpenAI decides when you have stopped talking. It either chunks your audio on silence, or scores your words and waits longer when you sound unfinished. The second mode is genuinely good. But both decide on OpenAI's servers, a network round trip away from the microphone, and both give you a single dial to turn. Interruption arrives as one fixed behaviour rather than as timing you control, a duck then a pause then a cancel, each on its own clock. And neither lets you say: in a café, require a full second of speech and a confident completeness score, but in a quiet room reply the moment I stop.

Moving the decision onto the phone fixes both. It is instant, and it is tunable for the environment your users are actually in.

## Turning it on

One flag:

```tsx
const { localTurnHandling } = useOpenAIRealtimeToolkit()

localTurnHandling.setEnabled(true)
// or seed it on the provider:
// <OpenAIRealtimeToolkitProvider localTurnHandling={{ enabled: true }} … />
```

Now turn detection runs locally, in two stages, with a separate instant path for interruptions.

## Stage 1: is anyone speaking?

Voice-activity detection. It answers one question continuously: is someone speaking right now? Sound above `vadThreshold` counts as speech, and after `vadSilenceMs` of quiet it reports that speech ended.

This is the same job OpenAI's own detection does, with two advantages. It runs on the device, so the answer is immediate, and `vadThreshold` is yours. Raise it and the conversation two tables over stops registering as speech at all.

## Stage 2: did they finish?

When stage 1 says you went quiet, semantic analysis looks at what you said and scores from 0 to 1 how likely it is to be a complete thought rather than a mid-sentence pause. The same silence reads as unfinished after a trailing "so what I need is" and as finished after a full request, and that score is what tells the two apart.

The toolkit then combines the two signals. It holds `pauseToleranceMs` longer, so if you start talking again inside that window your turn simply continues. It checks that you spoke long enough to be a real turn (`minInputLengthMs`), and it weighs that against the score according to `semanticStrategy`. By default both have to agree, so a low score vetoes a mid-sentence pause. If they never agree, `semanticFailTimeoutMs` commits anyway rather than leaving you talking to a wall.

## Barge-in: interrupting the agent

Barge-in is separate, and it runs off stage 1 alone, because interrupting has to be instant. Waiting to understand what you said would defeat the point.

The moment stage 1 detects speech, the agent's in-flight reply is ducked to `duckGain` immediately, paused after `pauseTimeMs`, and cancelled outright after `cancelTimeMs` (off by default). Ducking ahead of the pause is what keeps the interruption from landing abruptly.

## Echo cancellation underneath it all

Stage 1 only works if it hears your user and not the loudspeaker six inches from the mic. On speakerphone, the agent's own reply would otherwise register as speech, and it would interrupt and answer itself. That is what acoustic echo cancellation is for, and the toolkit owns the audio I/O on both platforms specifically so it can set it up for you. On iOS the audio unit runs with voice processing enabled, and on Android the mic opens with the `VoiceCommunication` preset in communication mode. The cancellation is the platform's. Making sure it is switched on and the route is right is the toolkit's. There is no knob and no setup.

## Pick a preset for the room

The knobs exist because rooms differ, and you rarely need to turn them yourself. The toolkit exports three ready-made knob sets, and picking one is a single line. Most apps do not need more than this:

| Preset | Use it for | How it differs |
| --- | --- | --- |
| `QUIET_CONFIG` | Quiet room, phone at your face | Lower `vadThreshold` (`0.4`), short `minInputLengthMs` (`300`), semantic thresholds at `0` so the check always passes, and a fast, strong duck for the snappiest replies |
| `BALANCED_CONFIG` | The default; every knob at its default | Baseline |
| `NOISY_CONFIG` | Café, background chatter, speakerphone | Higher `vadThreshold` (`0.6`), `minInputLengthMs` at `1000`, real semantic confidence required (`0.5`), and a slower, softer duck so far fewer turns are triggered by noise |

`localTurnHandling.config` holds the tuning, and it applies only while `enabled`. Read a knob as a value, and write with `setConfig`. A partial patch tweaks, and a full knob set selects:

```tsx
import { QUIET_CONFIG, NOISY_CONFIG, DEFAULT_CONFIG } from '@synervoz/openai-realtime-toolkit'

const { config, setConfig } = localTurnHandling

config.pauseToleranceMs                                 // read one knob (hover shows the doc)
setConfig(NOISY_CONFIG)                                 // select a preset (overwrites all)
setConfig({ pauseToleranceMs: 3000 })                   // tweak one knob, keep the rest
setConfig({ ...QUIET_CONFIG, pauseToleranceMs: 3000 })  // preset plus a tweak
setConfig({ ...DEFAULT_CONFIG, ...tweaks })             // reset from scratch, then tweak
```

Everything applies live, with no session drop and no reconnect, so you can put a preset switcher in your own settings screen and let users fix their own room. You can also seed it on the provider: `localTurnHandling={{ enabled: true, config: QUIET_CONFIG }}`.

`BALANCED_CONFIG` and `DEFAULT_CONFIG` hold the same values. They exist for different intents: reach for `BALANCED_CONFIG` when you want to select the default preset alongside `QUIET_CONFIG` and `NOISY_CONFIG`, and for `DEFAULT_CONFIG` when you want a clean base to spread your own tweaks over.

## Tuning by symptom

When a preset is not enough, work backwards from the complaint rather than forwards from the config reference:

| It feels like… | Reach for |
| --- | --- |
| "It cuts me off mid-sentence" | Raise `pauseToleranceMs` (try `1500`) so a thinking pause is not the end of your turn, and consider raising `vadSilenceMs`. Raise `minSemanticConfidence` so the semantic check has to be surer you are done. |
| "It's slow to reply after I stop" | Lower `vadSilenceMs` (try `300`) and `pauseToleranceMs`. Lower the semantic confidences, or set `semanticStrategy: 'off'` to skip stage 2 entirely. |
| "Background noise triggers it" | Apply `setConfig(NOISY_CONFIG)`. Raise `vadThreshold` (`0.6` to `0.7`) so distant speech does not register, and raise `minInputLengthMs` so short bursts do not count. |
| "Short answers get ignored" | Lower `minInputLengthMs`, or set `semanticStrategy: 'rescue'` so a confident score commits an otherwise-too-short utterance. |
| "My turn never got answered" | Set `semanticFailTimeoutMs` (try `4000`) so a semantically-rejected turn still commits after that much silence. |
| "The agent keeps talking over me" | Lower `pauseTimeMs`, lower `duckGain` (`0` mutes), and set a finite `cancelTimeMs` to drop the reply outright. |
| "Its answer restarts after I interrupt" | Set `commitBehavior: 'finish'` to keep the in-flight response instead of cancelling it. |

## Knob reference

Every knob carries its own doc comment, so hovering it in your editor shows the same explanation. `KNOB_SPECS` exposes `min`, `max` and `options` at runtime if you want to build sliders instead of hard-coding values.

**Turn detection: when is the user's turn over?**

Disable-able duration knobs use `Infinity` to mean "off" (`semanticFailTimeoutMs`, `pauseTimeMs`, `cancelTimeMs`), for example `setConfig({ cancelTimeMs: Infinity })`.

| Knob | What it does | Default | Range |
| --- | --- | --- | --- |
| `vadThreshold` | How loud speech has to be before it counts as talking. Raise it in a noisy room so background sound is not heard as speech. | `0.5` | `0.0` to `1.0` |
| `vadSilenceMs` | How long you have to go quiet before voice detection calls your speech over. Lower it for snappier replies, at the cost of clipping a pause more often. | `500` | `100` to `6000` |
| `minInputLengthMs` | Minimum time you must speak for it to count as a turn at all. Filters out coughs and short noise bursts. | `600` | `200` to `6000` |
| `pauseToleranceMs` | Extra silence held after voice detection's own hold before ending the turn. Your grace period for thinking mid-sentence. | `0` | `0` to `6000` |
| `semanticStrategy` | Whether the "did that sound finished?" check is required, optional, or ignored (see below). | `'gate'` | `off`, `rescue`, `gate` |
| `minSemanticConfidence` | Score required for **short** utterances (under `thresholdBreakpointMs`). Short speech gives the check less to go on, so this is usually lower. | `0.01` | `0` to `0.9` |
| `maxSemanticConfidence` | Score required for **long** utterances. Raise both to be cut off less, and lower both to reply sooner. | `0.5` | `0` to `0.9` |
| `thresholdBreakpointMs` | Where "short" ends and "long" begins, which is to say which of the two confidences applies. | `2000` | `1000` to `6000` |
| `semanticFailTimeoutMs` | Safety net: if semantic analysis rejected a real-length turn and you stay quiet this long, commit anyway so the agent still answers. | `Infinity` (off) | `3000` to `6000` |

`semanticStrategy` is how the length check and the semantic score are combined:

| Value | Meaning |
| --- | --- |
| `'off'` | Semantic analysis is skipped, and long enough (`minInputLengthMs`) is all it takes. Fastest, and most likely to cut you off. |
| `'rescue'` | Long enough **or** sounds finished. A high score rescues an utterance that was too short. |
| `'gate'` (default) | Long enough **and** sounds finished. A low score vetoes a mid-sentence pause. |

**Barge-in: how the in-flight agent response is interrupted.**

| Knob | What it does | Default | Range |
| --- | --- | --- | --- |
| `pauseTimeMs` | How long you have to be talking before the agent stops speaking. Lower it if it talks over you. | `800` | `400` to `6000` |
| `cancelTimeMs` | How long before the agent's current answer is thrown away rather than just paused. Off by default, so it resumes. | `Infinity` (off) | `2000` to `16000` |
| `duckGain` | How far the agent's volume drops the moment you start talking (`0` is silent, `1` is unchanged). | `0.3` | `0` to `1` |
| `duckTimeMs` | How quickly that volume drop fades in and out. Too fast can click, and too slow feels laggy. | `100` | `0` to `1000` |
| `commitBehavior` | When your turn commits: `cancel` drops the agent's unfinished answer, and `finish` lets it play out. | `'cancel'` | `cancel`, `finish` |

## What false turns actually cost

Local turn handling does not reduce what you upload, and it never throws audio away. The microphone streams as before, and a rejected turn just stays buffered until the next commit takes it along.

Streaming is not what you pay for. The meter starts when the agent responds. At that moment OpenAI counts the input tokens, meaning everything committed to the conversation so far, plus the output tokens it generates in reply.

So the unit you are saving is a response, and it is an expensive one, because the whole conversation is re-sent as input every time ("turns later in the session will be more expensive," as OpenAI's docs put it). The real cost of a false turn is not the two seconds of café noise. It is the reply that noise triggers, and the weight that reply adds to every turn after it.

## Related

- [API reference](api-reference.md) has the `localTurnHandling` shape on the hook, and the config-related exports.
- [Tools](tools.md) covers what the agent does once the turn is yours to give it.
