# Providers API

Full API reference for built-in provider adapters.

## `anthropic()`

Normalizes Anthropic SSE events (`message_start`, `content_block_delta`, etc.) into `StreamEvent`.

```typescript
import { anthropic } from '@store-ai/core';

const store = createAIStore({ provider: anthropic() });
```

Handles text blocks, thinking blocks, tool use blocks, token usage (`message_delta.usage`), and stop reasons.

## `openai()`

Normalizes OpenAI Chat Completions SSE events into `StreamEvent`.

```typescript
import { openai } from '@store-ai/core';

const store = createAIStore({ provider: openai() });
```

Handles `choices[0].delta.content`, `delta.tool_calls` (with partial argument streaming), and `finish_reason`.

## `openaiResponses()`

Normalizes OpenAI Responses API SSE events into `StreamEvent`.

```typescript
import { openaiResponses } from '@store-ai/core';

const store = createAIStore({ provider: openaiResponses() });
```

Handles `response.output_text.delta`, function call argument deltas, and reasoning tokens.

## `aiSdkDataStream()`

Consumes the Vercel AI SDK Data Stream protocol (UI Message Stream).

```typescript
import { aiSdkDataStream } from '@store-ai/core';

const store = createAIStore({ provider: aiSdkDataStream() });
```

Useful for consuming streams from a Vercel AI SDK backend without modifying the server.

## Provider Adapter Interface

All providers implement:

```typescript
interface ProviderAdapter {
  name: string;
  createTransform(): TransformStream<SSEEvent, StreamEvent>;
}
```

You can implement this interface to support any custom SSE format.
