# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-08-07

### Changed

- README: rewritten intro; Android setup now states the React Native CLI and Expo
  paths up front instead of noting the Expo shortcut at the end.

## [1.0.0] - 2026-08-07

- OpenAI Realtime voice sessions for React Native, on iOS and Android
- On-device turn detection (Silero VAD + Smart Turn) with barge-in handling
- Tool calling via the `useTool` hook
- `OpenAIRealtimeToolkitProvider` + configurable presets
- C++ TurboModule (New Architecture); works in Expo prebuild and bare RN
