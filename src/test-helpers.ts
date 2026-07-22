// Test-only helpers shared across suites. Excluded from the published tarball
// (see package.json `files`) and from the production build (tsconfig.build).

import type { RPCResponse, SwitchboardClient } from './SwitchboardClient'

/** Build the JSON string a mocked `processCommand` returns for one RPC call. */
export function makeRpcResponse(result?: unknown, error?: RPCResponse['error']): string {
  const body: RPCResponse = { jsonrpc: '2.0', id: 1 }
  if (error !== undefined) {
    body.error = error
  } else {
    body.result = result ?? null
  }
  return JSON.stringify(body)
}

/**
 * A hand-rolled {@link SwitchboardClient} double whose object-model methods are
 * `jest.fn()`s, so {@link LocalTurnController} / other consumers can be driven
 * without going through JSON-RPC serialization.
 *
 * `callAction` returns `{ result: null }` by default; override per-test (e.g.
 * `client.callAction.mockReturnValue({ result: { probability: 0.9 } })`) to
 * feed a SmartTurn `infer` verdict.
 */
export interface MockSwitchboardClient {
  getValue: jest.Mock
  setValue: jest.Mock
  callAction: jest.Mock
  addEventListener: jest.Mock
  removeEventListener: jest.Mock
  setEventReceivedCallback: jest.Mock
}

export function mockSwitchboardClient(): MockSwitchboardClient & SwitchboardClient {
  const client: MockSwitchboardClient = {
    getValue: jest.fn(() => ({ result: null })),
    setValue: jest.fn(() => ({ result: null })),
    callAction: jest.fn(() => ({ result: null })),
    addEventListener: jest.fn(() => ({ result: null })),
    removeEventListener: jest.fn(() => ({ result: null })),
    setEventReceivedCallback: jest.fn(),
  }
  return client as unknown as MockSwitchboardClient & SwitchboardClient
}

/** Make `client.callAction('...', 'infer')` report a SmartTurn probability. */
export function stubInferProbability(client: MockSwitchboardClient, probability: number): void {
  client.callAction.mockImplementation((_uri: unknown, action: unknown) => {
    if (action === 'infer') {
      return { result: { probability } }
    }
    return { result: null }
  })
}
