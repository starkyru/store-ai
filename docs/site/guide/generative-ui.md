# Generative UI

Map AI tool calls to UI component descriptors declaratively. When a model calls `get_weather`, your UI renders a `<WeatherCard>` instead of raw JSON.

## Setup

```typescript
import { createUIRegistry } from '@store-ai/core';

const registry = createUIRegistry();
```

## Registering Renderers

```typescript
registry.register('get_weather', (toolCall) => ({
  component: 'WeatherCard',
  props: {
    city: toolCall.input?.['city'],
    forecast: toolCall.output,
  },
  loading: toolCall.status === 'pending' || toolCall.status === 'partial',
  toolCall,
}));

registry.register('search', (toolCall) => ({
  component: 'SearchResults',
  props: { query: toolCall.input?.['query'], results: toolCall.output },
  loading: toolCall.status !== 'complete',
  toolCall,
}));
```

## Fallback Renderer

Handle unregistered tools with a catch-all:

```typescript
registry.setFallback((toolCall) => ({
  component: 'GenericToolCall',
  props: { name: toolCall.name, input: toolCall.input, output: toolCall.output },
  loading: toolCall.status !== 'complete',
  toolCall,
}));
```

## Connecting to a Store

```typescript
import { connectUI } from '@store-ai/core';

const { getElements, destroy } = connectUI(store, registry);

// Reactive — updates when store.toolCalls changes
const elements = getElements();
// → [{ component: 'WeatherCard', props: { city: 'SF' }, loading: true, toolCall: ... }]
```

## Framework Integration

### React

```tsx
function ToolCallRenderer({ store, registry }) {
  const toolCalls = useAIToolCalls(store);
  const elements = registry.renderAll(toolCalls);

  return elements.map((el) => {
    switch (el.component) {
      case 'WeatherCard':
        return <WeatherCard key={el.toolCall.id} {...el.props} loading={el.loading} />;
      case 'SearchResults':
        return <SearchResults key={el.toolCall.id} {...el.props} />;
      default:
        return <pre key={el.toolCall.id}>{JSON.stringify(el.props)}</pre>;
    }
  });
}
```

## UIElement Shape

```typescript
interface UIElement {
  component: string; // component identifier
  props: Record<string, unknown>; // props for the component
  loading: boolean; // true while tool call is in progress
  toolCall: ToolCallState; // raw tool call data
}
```

## API

| Method                              | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| `registry.register(name, renderer)` | Register a renderer for a tool name                     |
| `registry.unregister(name)`         | Remove a renderer                                       |
| `registry.has(name)`                | Check if registered                                     |
| `registry.render(toolCall)`         | Render one tool call (or null)                          |
| `registry.renderAll(toolCalls)`     | Render all, skipping unregistered (unless fallback set) |
| `registry.setFallback(renderer)`    | Set catch-all for unregistered tools                    |
| `registry.list()`                   | List registered tool names                              |
| `connectUI(store, registry)`        | Reactive connection, returns `{ getElements, destroy }` |
