# Tools

Local turn handling keeps the conversation alive in a real room. Tools are how the agent acts on it. The model calls a function you registered, and your code runs while it talks.

## `useTool`

Register a tool with the `useTool` hook. The handler runs when the model calls the tool, and its return value is sent back to the model automatically:

```tsx
import { useTool } from '@synervoz/openai-realtime-toolkit'

useTool({
  name: 'set_background_color',
  description: "Changes the application's background color.",
  parameters: {
    type: 'object',
    properties: { color: { type: 'string' } },
    required: ['color'],
  },
  handler: async ({ color }) => {
    setBackgroundColor(color)
    return { success: true, color }
  },
})
```

Say "make the background dark blue" and it happens. The hook scopes the tool to the component: it registers on mount, unregisters on unmount, and re-registers when `name`, `description`, or `parameters` change. It also keeps `handler` live across renders, so there are no stale closures and the handler always sees current state. `parameters` (JSON Schema) is optional, so omit it for a no-arg tool. Names must be unique, and re-registering a name replaces the tool.

## Dynamic tool sets

`useTool` follows the rules of hooks, so no loops and no conditionals. For tools sourced from config, or registered outside render, use the imperative `registerTool(tool)` and `unregisterTool(name)` from `useOpenAIRealtimeToolkit()`. You own the lifetime and the handler's closure:

```tsx
const { registerTool, unregisterTool } = useOpenAIRealtimeToolkit()

registerTool({ name: 'apply_coupon', description: '…', parameters: {…}, handler })
unregisterTool('apply_coupon') // later
```

Adding a tool with an existing name replaces it. Prefer `useTool` whenever the tool set is known at render time.

## When a handler throws

A handler that throws is reported to the model as a tool error, so the conversation continues and the model answers without the result rather than stalling.

Nothing about a tool call reaches the hook's `error` state. The model is the one that has to recover, and there would be nothing to clear the state afterwards. To watch tool failures anyway, pass `onError` to the provider and filter on `code`:

- `TOOL_HANDLER_FAILED` means a handler threw. It is already reported to the model.
- `TOOL_RESULT_UNDELIVERED` means the result could not reach OpenAI at all, from a dead session or a stale call id.
- `RESPONSE_FAILED` means the model could not be resumed after the tool call.

See [API reference: Errors](api-reference.md#errors) for the full model.

## Related

- [API reference](api-reference.md) has `OpenAIRealtimeToolkitTool`, `registerTool` and `unregisterTool`, and the error codes.
- [Example app](../example/README.md) wires tools to React state in a full screen.
