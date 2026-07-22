import React from 'react'
import { render } from '@testing-library/react-native'
import { Text } from 'react-native'

// The hook's contract is subtle and easy to regress: it must register the tool
// once, let the *handler* change between renders WITHOUT re-registering
// (identity-stable via a ref), re-register when the model-visible parts change
// (name / description / parameters) so the model sees the update, and unregister
// on unmount. Getting this wrong drops updates, thrashes the tool list, leaks
// tools past unmount, or (the ref part) leaves handlers seeing stale state.
//
// We exercise the REAL hook through a REAL OpenAIRealtimeToolkitProvider (so the
// useTool → useOpenAIRealtimeToolkit → registerTool/unregisterTool path is
// genuine) and observe the mocked engine singleton.
jest.mock('./OpenAIRealtimeToolkit', () => ({
  openAIRealtimeToolkit: {
    initialize: jest.fn(),
    stop: jest.fn(),
    registerTool: jest.fn(),
    unregisterTool: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}))

import { OpenAIRealtimeToolkitProvider, useTool } from './OpenAIRealtimeToolkitProvider'

const { openAIRealtimeToolkit } = jest.requireMock('./OpenAIRealtimeToolkit') as {
  openAIRealtimeToolkit: { registerTool: jest.Mock; unregisterTool: jest.Mock }
}
const registerTool = openAIRealtimeToolkit.registerTool
const unregisterTool = openAIRealtimeToolkit.unregisterTool

const CREDS = { appId: 'app-1', appSecret: 'secret-1', openAIApiKey: 'sk-1' }

function ToolHost({ tool }: { tool: Parameters<typeof useTool>[0] }) {
  useTool(tool)
  return <Text>host</Text>
}

function renderHost(tool: Parameters<typeof useTool>[0]) {
  return render(
    <OpenAIRealtimeToolkitProvider {...CREDS}>
      <ToolHost tool={tool} />
    </OpenAIRealtimeToolkitProvider>
  )
}

function rerenderHost(
  rerender: (ui: React.ReactElement) => void,
  tool: Parameters<typeof useTool>[0]
) {
  rerender(
    <OpenAIRealtimeToolkitProvider {...CREDS}>
      <ToolHost tool={tool} />
    </OpenAIRealtimeToolkitProvider>
  )
}

beforeEach(() => {
  registerTool.mockClear()
  unregisterTool.mockClear()
})

describe('useTool', () => {
  it('registers the tool once on mount', () => {
    renderHost({ name: 'a', description: 'd', parameters: {}, handler: () => 1 })
    expect(registerTool).toHaveBeenCalledTimes(1)
    expect(registerTool.mock.calls[0]![0].name).toBe('a')
  })

  it('does not re-register when only the handler changes', () => {
    const { rerender } = renderHost({ name: 'a', description: 'd', parameters: {}, handler: () => 1 })
    expect(registerTool).toHaveBeenCalledTimes(1)
    rerenderHost(rerender, { name: 'a', description: 'd', parameters: {}, handler: () => 2 })
    // Handler flows through a ref, so a new handler alone doesn't re-register.
    expect(registerTool).toHaveBeenCalledTimes(1)
  })

  it('re-registers when the description or parameters change (so the model sees it)', () => {
    const { rerender } = renderHost({ name: 'a', description: 'first', parameters: { type: 'object' }, handler: () => 1 })
    expect(registerTool).toHaveBeenCalledTimes(1)
    rerenderHost(rerender, { name: 'a', description: 'second', parameters: { type: 'object' }, handler: () => 1 })
    expect(registerTool).toHaveBeenCalledTimes(2)
    rerenderHost(rerender, { name: 'a', description: 'second', parameters: { type: 'object', properties: {} }, handler: () => 1 })
    expect(registerTool).toHaveBeenCalledTimes(3)
  })

  it('routes calls to the latest handler even after a re-render', () => {
    const first = jest.fn(() => 1)
    const second = jest.fn(() => 2)
    const { rerender } = renderHost({ name: 'a', description: 'd', parameters: {}, handler: first })
    rerenderHost(rerender, { name: 'a', description: 'd', parameters: {}, handler: second })
    // The registered wrapper delegates through the ref, so it calls the newest handler.
    const registered = registerTool.mock.calls[0]![0]
    registered.handler({ x: 1 })
    expect(second).toHaveBeenCalledWith({ x: 1 })
    expect(first).not.toHaveBeenCalled()
  })

  it('unregisters the tool on unmount', () => {
    const { unmount } = renderHost({ name: 'a', description: 'd', parameters: {}, handler: () => 1 })
    expect(unregisterTool).not.toHaveBeenCalled()
    unmount()
    expect(unregisterTool).toHaveBeenCalledWith('a')
  })

  it('re-registers when the tool name changes, unregistering the old name first', () => {
    const { rerender } = renderHost({ name: 'a', description: 'd', parameters: {}, handler: () => 1 })
    rerenderHost(rerender, { name: 'b', description: 'd', parameters: {}, handler: () => 1 })
    expect(registerTool).toHaveBeenCalledTimes(2)
    expect(registerTool.mock.calls[1]![0].name).toBe('b')
    expect(unregisterTool).toHaveBeenCalledWith('a') // old 'a' removed before 'b' registers
  })
})
