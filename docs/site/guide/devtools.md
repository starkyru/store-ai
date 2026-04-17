# DevTools

The `devtools()` middleware records all stream events with timestamps and state snapshots, providing an inspection API for debugging.

## Setup

```typescript
import { createAIStore, devtools } from '@store-ai/core';

const { middleware, inspector } = devtools({
  maxEvents: 500, // default: 1000
  name: 'main-chat', // label for multi-store debugging
});

const store = createAIStore({
  middleware: [middleware],
});
```

## Inspector API

After a stream completes:

```typescript
// All events with timestamps
inspector.getEvents();
// → [{ index: 0, timestamp: '...', event: { type: 'text-delta', ... }, stateAfter: {...}, elapsed: 42 }]

// Filter by type
inspector.getEventsByType('text-delta');

// Single event
inspector.getEvent(5);

// Metrics
inspector.getEventCount(); // number of events
inspector.getDuration(); // stream duration in ms
inspector.getEventsPerSecond(); // throughput

// Export for sharing
const json = inspector.export(); // JSON string

// Clear the log
inspector.clear();
```

## DevToolsEvent Shape

```typescript
interface DevToolsEvent {
  index: number; // auto-incrementing
  timestamp: string; // ISO
  event: StreamEvent; // the stream event
  stateAfter: Readonly<AIState>; // state snapshot after this event
  elapsed: number; // ms since stream start
}
```

## Global Exposure

For external tooling (browser extensions, custom panels):

```typescript
const { middleware, inspector } = devtools({
  exposeGlobal: true,
  name: 'chat',
});

// Accessible from console:
// window.__STORE_AI_DEVTOOLS__.getEvents()
// window.__STORE_AI_DEVTOOLS__.getEventCount()
```

Multiple stores register as an array:

```typescript
// window.__STORE_AI_DEVTOOLS__ → [inspector1, inspector2]
```

## Options

| Option         | Default     | Description                                             |
| -------------- | ----------- | ------------------------------------------------------- |
| `maxEvents`    | `1000`      | Maximum events to retain. Oldest dropped when exceeded. |
| `exposeGlobal` | `false`     | Expose inspector on `window.__STORE_AI_DEVTOOLS__`      |
| `name`         | `undefined` | Label for identifying this store instance               |

## Tips

- Use in development only. The state snapshots add memory overhead.
- Combine with `logging()` for console output + devtools inspection.
- `export()` serializes Error objects to `{ name, message, stack }` for portability.
