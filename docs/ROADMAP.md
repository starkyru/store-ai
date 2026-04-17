# store-ai Roadmap

## Phase 0: Foundation (v0.1.0) — COMPLETE

**Goal**: Working vanilla core with one provider. Can consume a stream and produce reactive state. Fully tested.

### Deliverables

- [x] **Project scaffold** — monorepo (pnpm workspaces + turborepo), tsconfig, vitest, tsup/unbuild bundling, CI (GitHub Actions: lint, test, typecheck)
- [x] **Type definitions** — `AIState`, `Message`, `MessageContent`, `ToolCallState`, `TokenUsage`, `LatencyInfo`, `StreamEvent`, `StoreAction`
- [x] **State reducer** — Pure `aiReducer(state, action) → state` function. All state transitions are deterministic and unit-testable in isolation.
- [x] **AIStore** — `createAIStore()` with `get()`, `set()`, `subscribe()`, `submit()`, `abort()`, `reset()`, `destroy()`. Microtask batching for notifications. Selector-based subscriptions (`subscribe(key, listener)`).
- [x] **SSE parser** — `TransformStream<Uint8Array, SSEEvent>`. Handles multi-line data, BOM, `[DONE]` sentinel, reconnection IDs.
- [x] **Anthropic provider adapter** — `TransformStream<SSEEvent, StreamEvent>`. Handles `message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`. Text + thinking + tool calls.
- [x] **Stream pipeline** — Composition: `response.body → SSE parser → provider → reducer dispatch`.
- [x] **Abort integration** — `AbortController` propagation through pipeline. Clean reader lock release. Status transitions correctly to `"aborted"`.

### Tests — 135 passing

- [x] Reducer: every action type produces correct state transitions
- [x] Reducer: invalid/duplicate actions are handled gracefully
- [x] SSE parser: standard frames, multi-line data, empty lines, BOM, malformed input
- [x] SSE parser: UTF-8 multibyte characters split across chunks
- [x] Anthropic adapter: text streaming, thinking blocks, tool calls, errors
- [x] AIStore: subscribe/unsubscribe lifecycle, no leaked listeners
- [x] AIStore: microtask batching coalesces rapid updates
- [x] AIStore: abort mid-stream preserves accumulated state
- [x] AIStore: destroy() cleans up everything
- [x] Pipeline: end-to-end from raw bytes to final state (using recorded SSE fixtures)
- [x] Pipeline: error at each stage propagates correctly

---

## Phase 1: Middleware + Second Provider (v0.2.0) — COMPLETE

**Goal**: Middleware pipeline works. OpenAI supported. Core is validated against two very different SSE formats.

### Deliverables

- [x] **Middleware chain** — `MiddlewareFn` and `MiddlewareObject` types. Express-style `next()` execution. `store.use(mw)` for runtime addition with unsubscribe.
- [x] **`logging` middleware** — Configurable log levels and event filters.
- [x] **`throttle` middleware** — Debounce state updates to configurable interval.
- [x] **`mapEvents` middleware** — Transform/filter events inline.
- [x] **OpenAI Chat Completions provider** — `choices[0].delta.content`, `delta.tool_calls`, `finish_reason`.
- [x] **OpenAI Responses API provider** — `response.output_text.delta`, `response.function_call_arguments.delta`, reasoning tokens.
- [x] **NDJSON parser** — For non-SSE transports.

### Tests — 204 passing

- [x] Middleware chain: execution order (onion model)
- [x] Middleware: suppressing events by not calling `next()`
- [x] Middleware: transforming events
- [x] Middleware: `onStart`/`onComplete`/`onError`/`onAbort` lifecycle hooks
- [x] Middleware: runtime add/remove via `store.use()`
- [x] Middleware: errors in middleware propagate correctly, don't crash pipeline
- [x] OpenAI adapter: text, tool calls (with partial argument streaming), finish reasons
- [x] OpenAI Responses adapter: text, reasoning, function calls
- [x] Cross-provider: same test scenario (simple text stream) produces identical `AIState` regardless of provider

---

## Phase 2: Store Adapters (v0.3.0) — COMPLETE

**Goal**: First wave of store adapters. Proves the `get/subscribe` contract works universally.

### Deliverables

- [x] **Zustand adapter** (`@store-ai/zustand`) — `toZustand()`. Works with `zustand/vanilla` and React `useStore`.
- [x] **Jotai adapter** (`@store-ai/jotai`) — `toJotai()`. Individual atoms per state key.
- [x] **Nanostores adapter** (`@store-ai/nanostores`) — `toNanostores()`. Returns `map()` + derived atoms.
- [x] **Valtio adapter** (`@store-ai/valtio`) — `toValtio()`. Proxy-based reactive state.

### Tests — 260 passing

- [x] Each adapter: state sync is correct (values match core store)
- [x] Each adapter: updates propagate within one tick
- [x] Each adapter: `destroy()` removes all subscriptions
- [x] Each adapter: no memory leaks (subscribe/unsubscribe cycles)
- [x] Cross-adapter: same scenario produces identical results across all adapters

---

## Phase 3: Framework Adapters (v0.4.0) — COMPLETE

**Goal**: First-class developer experience for React, Vue, Svelte, Solid.

### Deliverables

- [x] **React adapter** (`@store-ai/react`) — `useAIStore()`, `useAIText()`, `useAIStatus()`, `useAIMessages()`, `useAIToolCalls()`, `useAIObject()`, `useAIThinking()`. Uses `useSyncExternalStore` for tear-free reads.
- [x] **Vue adapter** (`@store-ai/vue`) — `useAI()` composable returning reactive `Ref`s + `computed` properties.
- [x] **Svelte adapter** (`@store-ai/svelte`) — `createAIReadable()` returning typed `Readable` stores + derived stores.
- [x] **Solid adapter** (`@store-ai/solid`) — `useAI()` returning signals.
- [x] **Example apps** — React+Zustand, Vue, vanilla+Zustand.

### Tests — 288 passing

- [x] React: `useSyncExternalStore` tear-free behavior
- [x] React: components re-render only when selected state changes
- [x] Vue: reactivity triggers correctly on state changes
- [x] Svelte: `$store` auto-subscription works
- [x] Solid: fine-grained reactivity updates only affected DOM
- [x] All: cleanup on unmount / scope disposal

---

## Phase 4: Structured Output + Persistence (v0.5.0) — COMPLETE

**Goal**: Incremental JSON parsing with Zod validation. Persistence middleware with pluggable storage.

### Deliverables

- [x] **Partial JSON parser** — O(n) state machine for incremental JSON repair. Returns `DeepPartial<T>` at any point during streaming.
- [x] **`validateSchema` middleware** — Accepts `ZodType<T>`. Validates partial results during streaming. Validates final result against full schema. Populates `partialObject` and `object` in state.
- [x] **Persistence middleware** — `persist(storage)`. Saves messages on `stream/complete`. Restores via `restoreChat()`.
- [x] **Storage adapters** — `memoryStorage()`, `localStorageAdapter()`, `indexedDBAdapter()`.
- [x] **`retryOn` middleware** — Auto-retry with configurable max retries, delay, and error filter.
- [x] **`trackCost` middleware** — Token usage × pricing table → cost metadata in state.

### Tests — 343 passing

- [x] Partial JSON: valid JSON at every possible break point (inside string, inside number, nested object, array, escaped chars, unicode)
- [x] Partial JSON: O(n) total work (incremental scanning, not O(n^2) reparse)
- [x] Zod validation: partial schema matches, mismatches, type coercion
- [x] Zod validation: final validation pass/fail
- [x] Persistence: save/restore round-trip
- [x] Persistence: concurrent stream + persistence (no race conditions)
- [x] Persistence: storage adapter failures don't crash the stream
- [x] Retry: retries on matching errors, stops at max retries
- [x] Retry: doesn't retry on non-matching errors
- [x] Cost tracking: correct calculations for known provider pricing

---

## Phase 5: Multi-Chat + AI SDK Data Stream (v0.6.0) — COMPLETE

**Goal**: Multi-conversation support. Vercel AI SDK interop.

### Deliverables

- [x] **ChatManager** — `createChatManager()`. Create, delete, list, switch chats. Global subscribe. Each chat is an independent `AIStore`.
- [x] **AI SDK Data Stream provider** — Consumes Vercel AI SDK's UI Message Stream protocol. Enables drop-in use with existing AI SDK backends.
- [x] **Redux adapter** (`@store-ai/redux`) — `toRedux()`. Slice + sync.
- [x] **@tanstack/store adapter** (`@store-ai/tanstack`) — `toTanstack()`.

### Tests — 425 passing

- [x] ChatManager: create/delete/list lifecycle
- [x] ChatManager: switching active chat doesn't affect others
- [x] ChatManager: global subscribe fires on any chat change
- [x] ChatManager: `maxChats` limit enforced
- [x] ChatManager: destroy cleans up all chats
- [x] AI SDK Data Stream: protocol parsing matches Vercel's spec
- [x] Redux adapter: dispatches sync correctly, selector reads work
- [x] TanStack adapter: Store/Derived reactivity works

---

## Phase 6: Polish + v1.0.0 — COMPLETE

**Goal**: Stable API. Comprehensive docs. Battle-tested.

### Deliverables

- [x] **API stabilization** — All packages at v1.0.0. Public types and functions locked.
- [x] **Documentation site** — VitePress with 16 pages: guides, API reference, migration.
- [x] **Bundle size audit** — Core: 10.5KB gzipped. Adapters: 313-515B gzipped. Snapshot tests enforce thresholds.
- [x] **Performance benchmarks** — 10k events in <9ms, sub-0.1ms notification latency, 1000-message memory test.
- [x] **Migration guide** — From Vercel AI SDK `useChat` and from `@ai-sdk-tools/store`.
- [x] **Security audit** — 7 audits total, 19 fixes. Zero eval/Function/innerHTML. Prototype pollution sanitization. DoS buffer limits. Post-destroy guards.

### Tests — 432 passing

- [x] Memory leak detection: 1000-message conversation, 100 subscribe/unsubscribe cycles
- [x] Bundle size snapshot tests (20KB gzip threshold, CI-enforceable)
- [x] Performance regression tests (throughput, latency)

---

## Post v1.0 — COMPLETE

- [x] **WebSocket transport** — `createWebSocketTransport()` + `submitViaWebSocket()` with json/text formats, abort propagation
- [x] **Resumable streams** — `resumable()` middleware persists stream events, `getStreamCheckpoint()` / `deleteStreamCheckpoint()` for restore
- [x] **Message branching** — `createMessageTree()` with branch switching, sibling navigation, export/import
- [x] **Worker offloading** — `createWorkerStream()` + `setupWorkerHandler()` for main-thread/worker split
- [x] **@store-ai/preact** — Hooks via `preact/hooks` (no `preact/compat`)
- [x] **@store-ai/angular** — Signals-based `useAI()` + `toObservable()` with `DestroyRef` cleanup
- [x] **@store-ai/lit** — `AIController` implementing `ReactiveController`
- [x] **AG-UI protocol provider** — `agUI()` mapping all 16 event types to StreamEvent

## Additional Features — COMPLETE

- [x] **Generative UI mapping** — `createUIRegistry()` + `connectUI()` for declarative tool-call-to-component mapping
- [x] **DevTools middleware** — `devtools()` records events with timestamps + state snapshots, `inspector` API for querying

## Future Ideas

- [ ] **Server adapters** — Node.js/Deno adapters for server-to-server AI stream consumption
