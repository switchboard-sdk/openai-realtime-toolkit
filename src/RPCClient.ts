/**
 * Transport contract for talking to the Switchboard SDK over JSON-RPC 2.0.
 *
 * Decouples the high-level {@link SwitchboardClient} API from the concrete
 * transport, so the same client can run over the React Native TurboModule
 * bridge (see {@link NativeModuleRPCClient}) or, in tests, a mock.
 */
export interface RPCClient {
  /**
   * Send an RPC command and return the JSON-RPC response as a string.
   * @param method - RPC method name (e.g. 'getValue', 'callAction').
   * @param params - Parameters object for the method.
   */
  sendCommand(method: string, params: object): string

  /**
   * Register a callback for events pushed by the SDK. Only one callback is
   * active at a time; setting a new one replaces the previous.
   * @param callback - Receives each event as a JSON string.
   */
  setEventReceivedCallback(callback: (data: string) => void): void
}
