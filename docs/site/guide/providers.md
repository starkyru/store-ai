# Providers

Provider adapters normalize different AI streaming formats into store-ai's unified `StreamEvent` type. You choose a provider based on which API your backend streams from.

## Built-in Providers

| Adapter             | Format                                                  |
| ------------------- | ------------------------------------------------------- |
| `anthropic()`       | Anthropic SSE (message_start, content_block_delta, ...) |
| `openai()`          | OpenAI Chat Completions SSE                             |
| `openaiResponses()` | OpenAI Responses API SSE                                |
| `aiSdkDataStream()` | Vercel AI SDK Data Stream protocol                      |

### Anthropic

```typescript
import { createAIStore, anthropic } from '@store-ai/core';

const store = createAIStore({ provider: anthropic() });
```

Handles `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, and `message_stop` events. Supports text, thinking blocks, and tool calls.

### OpenAI Chat Completions

```typescript
import { createAIStore, openai } from '@store-ai/core';

const store = createAIStore({ provider: openai() });
```

Handles `choices[0].delta.content`, `delta.tool_calls`, and `finish_reason` fields.

### OpenAI Responses API

```typescript
import { createAIStore, openaiResponses } from '@store-ai/core';

const store = createAIStore({ provider: openaiResponses() });
```

Handles `response.output_text.delta`, function call argument deltas, and reasoning tokens.

### Vercel AI SDK Data Stream

```typescript
import { createAIStore, aiSdkDataStream } from '@store-ai/core';

const store = createAIStore({ provider: aiSdkDataStream() });
```

Consumes the Vercel AI SDK's UI Message Stream protocol. Useful when migrating from a Vercel AI SDK backend without changing the server.

## Custom Streams

You can skip the provider layer entirely by passing a `ReadableStream<StreamEvent>` or `AsyncIterator<StreamEvent>`:

```typescript
const store = createAIStore();

// ReadableStream
store.submit({ events: myCustomEventStream });

// AsyncIterator
store.submit({ events: myAsyncGenerator() });
```

See the [ARCHITECTURE.md](https://github.com/example/store-ai/blob/main/docs/ARCHITECTURE.md) for the full `StreamEvent` type definition and how provider adapters are implemented.
