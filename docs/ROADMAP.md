# store-ai Roadmap

## Phase 0: Foundation (v0.1.0)

**Goal**: Working vanilla core with one provider. Can consume a stream and produce reactive state. Fully tested.

### Deliverables

- [ ] **Project scaffold** — monorepo (pnpm workspaces + turborepo), tsconfig, vitest, tsup/unbuild bundling, CI (GitHub Actions: lint, test, typecheck)
- [ ] **Type definitions** — `AIState`, `Message`, `MessageContent`, `ToolCallState`, `TokenUsage`, `LatencyInfo`, `StreamEvent`, `StoreAction`
- [ ] **State reducer** — Pure `aiReducer(state, action) → state` function. All state transitions are deterministic and unit-testable in isolation.
- [ ] **AIStore** — `createAIStore()` with `get()`, `set()`, `subscribe()`, `submit()`, `abort()`, `reset()`, `destroy()`. Microtask batching for notifications. Selector-based subscriptions (`subscribe(key, listener)`).
- [ ] **SSE parser** — `TransformStream<Uint8Array, SSEEvent>`. Handles multi-line data, BOM, `[DONE]` sentinel, reconnection IDs.
- [ ] **Anthropic provider adapter** — `TransformStream<SSEEvent, StreamEvent>`. Handles `message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`. Text + thinking + tool calls.
- [ ] **Stream pipeline** — Composition: `response.body → SSE parser → provider → reducer dispatch`.
- [ ] **Abort integration** — `AbortController` propagation through pipeline. Clean reader lock release. Status transitions correctly to `"aborted"`.

### Tests (Phase 0)

- [ ] Reducer: every action type produces correct state transitions
- [ ] Reducer: invalid/duplicate actions are handled gracefully
- [ ] SSE parser: standard frames, multi-line data, empty lines, BOM, malformed input
- [ ] SSE parser: UTF-8 multibyte characters split across chunks
- [ ] Anthropic adapter: text streaming, thinking blocks, tool calls, errors
- [ ] AIStore: subscribe/unsubscribe lifecycle, no leaked listeners
- [ ] AIStore: microtask batching coalesces rapid updates
- [ ] AIStore: abort mid-stream preserves accumulated state
- [ ] AIStore: destroy() cleans up everything
- [ ] Pipeline: end-to-end from raw bytes to final state (using recorded SSE fixtures)
- [ ] Pipeline: error at each stage propagates correctly

### Exit Criteria

`createAIStore({ provider: anthropic() })` works, streams text, handles tool calls, and every behavior is tested. Package publishes as `@store-ai/core`.

---

## Phase 1: Middleware + Second Provider (v0.2.0)

**Goal**: Middleware pipeline works. OpenAI supported. Core is validated against two very different SSE formats.

### Deliverables

- [ ] **Middleware chain** — `MiddlewareFn` and `MiddlewareObject` types. Express-style `next()` execution. `store.use(mw)` for runtime addition with unsubscribe.
- [ ] **`logging` middleware** — Configurable log levels and event filters.
- [ ] **`throttle` middleware** — Debounce state updates to configurable interval.
- [ ] **`mapEvents` middleware** — Transform/filter events inline.
- [ ] **OpenAI Chat Completions provider** — `choices[0].delta.content`, `delta.tool_calls`, `finish_reason`.
- [ ] **OpenAI Responses API provider** — `response.output_text.delta`, `response.function_call_arguments.delta`, reasoning tokens.
- [ ] **NDJSON parser** — For non-SSE transports.

### Tests (Phase 1)

- [ ] Middleware chain: execution order (onion model)
- [ ] Middleware: suppressing events by not calling `next()`
- [ ] Middleware: transforming events
- [ ] Middleware: `onStart`/`onComplete`/`onError`/`onAbort` lifecycle hooks
- [ ] Middleware: runtime add/remove via `store.use()`
- [ ] Middleware: errors in middleware propagate correctly, don't crash pipeline
- [ ] OpenAI adapter: text, tool calls (with partial argument streaming), finish reasons
- [ ] OpenAI Responses adapter: text, reasoning, function calls
- [ ] Cross-provider: same test scenario (simple text stream) produces identical `AIState` regardless of provider

### Exit Criteria

Middleware pipeline is proven. Two providers produce identical state shapes. `logging()` and `throttle()` ship as built-in middleware.

---

## Phase 2: Store Adapters (v0.3.0)

**Goal**: First wave of store adapters. Proves the `get/subscribe` contract works universally.

### Deliverables

- [ ] **Zustand adapter** (`@store-ai/zustand`) — `toZustand()`. Works with `zustand/vanilla` and React `useStore`.
- [ ] **Jotai adapter** (`@store-ai/jotai`) — `toJotai()`. Individual atoms per state key.
- [ ] **Nanostores adapter** (`@store-ai/nanostores`) — `toNanostores()`. Returns `map()` + derived atoms.
- [ ] **Valtio adapter** (`@store-ai/valtio`) — `toValtio()`. Proxy-based reactive state.

### Tests (Phase 2)

- [ ] Each adapter: state sync is correct (values match core store)
- [ ] Each adapter: updates propagate within one tick
- [ ] Each adapter: `destroy()` removes all subscriptions
- [ ] Each adapter: no memory leaks (subscribe/unsubscribe cycles)
- [ ] Cross-adapter: same scenario produces identical results across all adapters

### Exit Criteria

Four store adapters ship. Each is <50 LOC and passes the same test suite (parameterized tests).

---

## Phase 3: Framework Adapters (v0.4.0)

**Goal**: First-class developer experience for React, Vue, Svelte, Solid.

### Deliverables

- [ ] **React adapter** (`@store-ai/react`) — `useAIStore()`, `useAIText()`, `useAIStatus()`, `useAIMessages()`, `useAIToolCalls()`, `useAIObject()`, `useAIThinking()`. Uses `useSyncExternalStore` for tear-free reads.
- [ ] **Vue adapter** (`@store-ai/vue`) — `useAI()` composable returning reactive `Ref`s + `computed` properties.
- [ ] **Svelte adapter** (`@store-ai/svelte`) — `createAIReadable()` returning typed `Readable` stores + derived stores.
- [ ] **Solid adapter** (`@store-ai/solid`) — `useAI()` returning signals.
- [ ] **Example apps** — One per framework, demonstrating streaming chat with tool calls.

### Tests (Phase 3)

- [ ] React: `useSyncExternalStore` tear-free behavior under concurrent mode
- [ ] React: components re-render only when selected state changes
- [ ] Vue: reactivity triggers correctly on state changes
- [ ] Svelte: `$store` auto-subscription works
- [ ] Solid: fine-grained reactivity updates only affected DOM
- [ ] All: cleanup on unmount / scope disposal

### Exit Criteria

All four framework adapters ship with examples. A developer using React+Zustand, Vue+Nanostores, Svelte native, or Solid signals has a polished experience.

---

## Phase 4: Structured Output + Persistence (v0.5.0)

**Goal**: Incremental JSON parsing with Zod validation. Persistence middleware with pluggable storage.

### Deliverables

- [ ] **Partial JSON parser** — O(n) state machine for incremental JSON repair. Returns `DeepPartial<T>` at any point during streaming.
- [ ] **`validateSchema` middleware** — Accepts `ZodType<T>`. Validates partial results against `schema.deepPartial()` during streaming. Validates final result against full schema. Populates `partialObject` and `object` in state.
- [ ] **Persistence middleware** — `persist(storage)`. Saves messages on `stream/complete`. Restores on store creation.
- [ ] **Storage adapters** — `memoryStorage()`, `localStorageAdapter()`, `indexedDBAdapter()`.
- [ ] **`retryOn` middleware** — Auto-retry with configurable max retries, delay, and error filter.
- [ ] **`trackCost` middleware** — Token usage × pricing table → cost metadata in state.

### Tests (Phase 4)

- [ ] Partial JSON: valid JSON at every possible break point (inside string, inside number, nested object, array, escaped chars, unicode)
- [ ] Partial JSON: O(n) total work (benchmark, not O(n^2) reparse)
- [ ] Zod validation: partial schema matches, mismatches, type coercion
- [ ] Zod validation: final validation pass/fail
- [ ] Persistence: save/restore round-trip
- [ ] Persistence: concurrent stream + persistence (no race conditions)
- [ ] Persistence: storage adapter failures don't crash the stream
- [ ] Retry: retries on matching errors, stops at max retries
- [ ] Retry: doesn't retry on non-matching errors
- [ ] Cost tracking: correct calculations for known provider pricing

### Exit Criteria

Structured output works end-to-end: stream → partial JSON → Zod validation → reactive `partialObject` in any store/framework. Persistence is reliable.

---

## Phase 5: Multi-Chat + AI SDK Data Stream (v0.6.0)

**Goal**: Multi-conversation support. Vercel AI SDK interop.

### Deliverables

- [ ] **ChatManager** — `createChatManager()`. Create, delete, list, switch chats. Global subscribe. Each chat is an independent `AIStore`.
- [ ] **AI SDK Data Stream provider** — Consumes Vercel AI SDK's UI Message Stream protocol. Enables drop-in use with existing AI SDK backends.
- [ ] **Redux adapter** (`@store-ai/redux`) — `toRedux()`. Slice + sync.
- [ ] **@tanstack/store adapter** (`@store-ai/tanstack`) — `toTanstack()`.

### Tests (Phase 5)

- [ ] ChatManager: create/delete/list lifecycle
- [ ] ChatManager: switching active chat doesn't affect others
- [ ] ChatManager: global subscribe fires on any chat change
- [ ] ChatManager: `maxChats` limit enforced
- [ ] ChatManager: destroy cleans up all chats
- [ ] AI SDK Data Stream: protocol parsing matches Vercel's spec
- [ ] Redux adapter: dispatches sync correctly, selector reads work
- [ ] TanStack adapter: Store/Derived reactivity works

### Exit Criteria

Multi-chat works. Vercel AI SDK backends can be consumed without changes. All six store adapters ship.

---

## Phase 6: Polish + v1.0.0

**Goal**: Stable API. Comprehensive docs. Battle-tested.

### Deliverables

- [ ] **API stabilization** — Review every public type and function. Lock down the API contract. Semantic versioning from this point.
- [ ] **Documentation site** — VitePress or Starlight. Getting started, guides, API reference, examples, migration guide from Vercel AI SDK.
- [ ] **Bundle size audit** — Tree-shaking verification. Each package should be minimal:
  - `@store-ai/core`: target <8KB min+gzip
  - Store adapters: target <1KB each
  - Framework adapters: target <2KB each
- [ ] **Performance benchmarks** — Streaming throughput (events/sec), memory usage during long streams, subscriber notification latency.
- [ ] **AG-UI protocol provider** — Consume AG-UI event streams (16 event types → StreamEvent).
- [ ] **Migration guide** — Step-by-step migration from `@ai-sdk/react`'s `useChat` and from `@ai-sdk-tools/store`.
- [ ] **Security audit** — XSS prevention in message content rendering guidance. No `eval` or `Function()` anywhere in the codebase.

### Tests (Phase 6)

- [ ] Full integration tests: real API calls (behind feature flag, not in CI by default)
- [ ] Memory leak detection: 1000-message conversation, 100 subscribe/unsubscribe cycles
- [ ] Bundle size snapshot tests (fail CI if size increases beyond threshold)
- [ ] Performance regression tests

### Exit Criteria

Stable, documented, tested v1.0.0 release. Clear upgrade path from competitors.

---

## Future (Post v1.0)

Ideas for future exploration, not committed:

- **Server-side streaming** — Node.js/Deno adapters for server-to-server AI stream consumption
- **Resumable streams** — Persist stream position, resume after disconnect (similar to Vercel AI SDK's Redis-backed resumable streams)
- **Message branching** — Tree-based message history with branch switching (similar to assistant-ui's MessageRepository)
- **Generative UI mapping** — Map tool calls to UI components declaratively
- **WebSocket transport** — Alternative to SSE for bidirectional communication
- **Worker offloading** — Run stream parsing in a Web Worker, send state updates to main thread
- **DevTools** — Browser extension for inspecting store state, stream events, middleware pipeline
- **@store-ai/preact** — Preact adapter
- **@store-ai/angular** — Angular adapter (signals-based)
- **@store-ai/lit** — Lit adapter (ReactiveController)

---

## Principles Guiding the Roadmap

1. **Test-first, always** — No phase ships without comprehensive tests. This is our primary differentiator over every competitor.
2. **Core before periphery** — The vanilla core must be solid before store/framework adapters. Adapters are thin; the core is where bugs hide.
3. **Two providers before many** — Phase 1 validates the StreamEvent abstraction with two very different formats (Anthropic vs OpenAI). If the abstraction holds for those two, it'll hold for anything.
4. **Ship what's tested, not what's built** — If a feature works but isn't tested, it doesn't ship in that phase.
5. **Bundle size is a feature** — Every dependency is scrutinized. The core has zero runtime deps. Store adapters peer-depend on their target store. Nothing is bundled unnecessarily.
