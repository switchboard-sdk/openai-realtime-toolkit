import type { TurboModule } from 'react-native'
import { TurboModuleRegistry, CodegenTypes } from 'react-native'

/**
 * TurboModule spec consumed by React Native Codegen (new architecture).
 *
 * The native surface is intentionally tiny: everything flows through a single
 * JSON-RPC 2.0 string channel (`processCommand`), plus an event stream. The
 * higher-level API (SwitchboardClient) is built on top of this in TypeScript,
 * so adding new Switchboard actions never requires touching native code.
 */
export interface Spec extends TurboModule {
  /** Execute a JSON-RPC 2.0 command and return the JSON-RPC response string. */
  readonly processCommand: (command: string) => string

  /** Absolute path to the app's documents directory (for recordings/logs). */
  readonly getDocumentsPath: () => string

  /** Write `contents` to `path`, overwriting. Returns whether it succeeded. */
  readonly writeFile: (path: string, contents: string) => boolean

  /** Request microphone permission; resolves to whether it's granted. */
  readonly requestMicrophonePermission: () => Promise<boolean>

  /** Stream of Switchboard events, delivered as JSON strings. */
  readonly onEventReceived: CodegenTypes.EventEmitter<string>
}

export default TurboModuleRegistry.getEnforcing<Spec>('OpenAIRealtimeToolkit')
