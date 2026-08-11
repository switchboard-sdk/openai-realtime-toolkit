/**
 * OpenAIRealtimeToolkit example — a minimal OpenAI Realtime voice assistant.
 *
 * All orchestration lives in the OpenAIRealtimeToolkit library. This app wraps itself in
 * <OpenAIRealtimeToolkitProvider> with credentials, and the screen drives it with a single
 * useOpenAIRealtimeToolkit() hook — lifecycle, transcripts, and turn-detection knobs.
 *
 *
 * @format
 */

import React, { useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  OpenAIRealtimeToolkitProvider,
  useOpenAIRealtimeToolkit,
  useTool,
  QUIET_CONFIG,
  BALANCED_CONFIG,
  NOISY_CONFIG,
} from '@synervoz/openai-realtime-toolkit';
import { colors } from './colors';

// ── Credentials ──────────────────────────────────────────────────────────────
// The library ships with default Switchboard credentials, so this demo passes
// none. For production, get your own (free) at https://console.switchboard.audio
// and pass them to the provider below.

// No `openAIApiKey` is passed below either, so the demo runs on a shared test key that's
// rate-limited and rotated without notice — fine for trying the toolkit out,
// never for an app you ship. To use your own key: copy `.env.example` to `.env`,
// set OPENAI_API_KEY there, then uncomment the import and the provider prop.
// import { OPENAI_API_KEY } from '@env';

// System prompt for the OpenAI Realtime model.
const INSTRUCTIONS =
  'You are a terse, friendly voice assistant. Keep answers to one sentence.';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      {/* On-device turn handling starts off; toggle it at runtime via the hook.
          `config` seeds its tuning for when it's enabled. */}
      <OpenAIRealtimeToolkitProvider
        // appId="YOUR_SWITCHBOARD_APP_ID"
        // appSecret="YOUR_SWITCHBOARD_APP_SECRET"
        // openAIApiKey={OPENAI_API_KEY}
        instructions={INSTRUCTIONS}
        localTurnHandling={{
          enabled: false,
          config: { ...QUIET_CONFIG, pauseToleranceMs: 3000, pauseTimeMs: 1000 },
        }}>
        <Screen />
      </OpenAIRealtimeToolkitProvider>
    </SafeAreaProvider>
  );
}

function Screen(): React.JSX.Element {
  const {
    isRunning,
    error,
    connectionStatus,
    inputTranscription,
    outputTranscription,
    start,
    stop,
    localTurnHandling,
  } = useOpenAIRealtimeToolkit();

  const [backgroundColor, setBackgroundColor] = useState(colors.bg);
  const [selectedPreset, setSelectedPreset] = useState<string | null>('quiet');

  // Give the model a tool to call to change the app's background color.
  useTool({
    name: 'set_background_color',
    description:
      "Changes the application's background color. Call only when the user " +
      'asks to change the background color of the app.',
    parameters: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'A CSS color name.',
        },
      },
      required: ['color'],
    },
    handler: async ({ color }: { color: string }) => {
      setBackgroundColor(color);
      return { success: true, color };
    },
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      <StatusBar barStyle="light-content" backgroundColor={backgroundColor} />
      <Text style={styles.title}>OpenAIRealtimeToolkit</Text>

      {error ? <Text style={styles.error}>{error.message}</Text> : null}

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>On-device</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Local turn handling and Barge-In</Text>
          <Switch
            value={localTurnHandling.enabled}
            onValueChange={localTurnHandling.setEnabled}
          />
        </View>

        {/* Fixed-height slot so hiding the presets doesn't shift the layout.
            Each preset is a full knob set, so tapping one is setConfig(WHOLE_SET) —
            it overwrites every knob. */}
        <View style={styles.presetSlot}>
          {localTurnHandling.enabled && (
            <View style={styles.segmented}>
              {(
                [
                  ['quiet', QUIET_CONFIG],
                  ['balanced', BALANCED_CONFIG],
                  ['noisy', NOISY_CONFIG],
                ] as const
              ).map(([label, presetConfig]) => (
                <TouchableOpacity
                  key={label}
                  style={[
                    styles.segment,
                    selectedPreset === label && styles.segmentSelected,
                  ]}
                  onPress={() => {
                    localTurnHandling.setConfig(presetConfig);
                    setSelectedPreset(label);
                  }}>
                  <Text
                    style={[
                      styles.segmentText,
                      selectedPreset === label && styles.segmentTextSelected,
                    ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

      </View>

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>OpenAI</Text>
        <Text style={styles.status}>Connection: {connectionStatus}</Text>
        <Text style={styles.transcript}>
          <Text style={styles.speaker}>You: </Text>
          {inputTranscription || '—'}
          {'\n\n'}
          <Text style={styles.speaker}>Assistant: </Text>
          {outputTranscription || '—'}
        </Text>
      </View>

      <Text style={styles.hint}>
        Hint: ask the assistant to change the background color
      </Text>

      <TouchableOpacity
        style={[styles.talkButton, isRunning && styles.talkButtonActive]}
        onPress={isRunning ? stop : start}>
        <Text style={styles.buttonText}>
          {isRunning ? 'Stop talking' : 'Start talking'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24, backgroundColor: colors.bg },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  talkButton: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  talkButtonActive: { backgroundColor: colors.danger },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13 },
  section: {
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  status: { fontSize: 14, fontWeight: '500', color: colors.body },
  hint: {
    marginTop: 'auto',
    textAlign: 'center',
    fontSize: 13,
    color: colors.dim,
  },
  transcript: { fontSize: 14, color: colors.body },
  speaker: { fontWeight: '600', color: colors.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { fontSize: 14, color: colors.body },
  presetSlot: { height: 48 },
  segmented: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: colors.accent },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.muted,
    textTransform: 'capitalize',
  },
  segmentTextSelected: { color: colors.white },
});
