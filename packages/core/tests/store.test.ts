import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '../src/store.js';
import type {
  AIFullState,
  Message,
  StreamEvent,
  Middleware,
  MiddlewareContext,
} from '../src/types.js';

// ── Helpers ──

function makeMessage(overrides: Partial<Message> & { role: Message['role'] }): Message {
  return {
    id: crypto.randomUUID(),
    content: [{ type: 'text', text: 'hello' }],
    createdAt: new Date(),
    ...overrides,
  };
}

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

async function* delayedTextStream(chunks: string[], delayMs = 10): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    await new Promise((r) => setTimeout(r, delayMs));
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

/** Flush the microtask queue (default batch strategy). */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(r));
}

/** Wait for an async stream to be fully consumed. */
async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('createAIStore', () => {
  // 1. Creation
  describe('creation', () => {
    it('returns store with correct initial state', () => {
      const store = createAIStore();
      const state = store.get();

      expect(state.status).toBe('idle');
      expect(state.text).toBe('');
      expect(state.textDelta).toBe('');
      expect(state.messages).toEqual([]);
      expect(state.lastMessage).toBeNull();
      expect(state.error).toBeNull();
      expect(state.toolCalls).toEqual([]);
      expect(state.thinking).toBe('');
      expect(state.thinkingDelta).toBe('');
      expect(state.usage).toBeNull();
      expect(state.latency).toBeNull();
      expect(state.partialObject).toBeNull();
      expect(state.object).toBeNull();
      expect(state.model).toBeNull();
      expect(state.provider).toBeNull();
    });

    it('has correct computed/derived fields on initial state', () => {
      const store = createAIStore();
      const state = store.get();

      expect(state.isIdle).toBe(true);
      expect(state.isStreaming).toBe(false);
      expect(state.isError).toBe(false);
      expect(state.hasMessages).toBe(false);
      expect(state.pendingToolCalls).toEqual([]);
      expect(state.completedToolCalls).toEqual([]);
    });
  });

  // 2. get()
  describe('get()', () => {
    it('returns full state when called without arguments', () => {
      const store = createAIStore();
      const state = store.get();

      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('text');
      expect(state).toHaveProperty('messages');
      expect(state).toHaveProperty('isStreaming');
      expect(state).toHaveProperty('isIdle');
    });

    it('returns specific key value when called with a key', () => {
      const store = createAIStore();

      expect(store.get('status')).toBe('idle');
      expect(store.get('text')).toBe('');
      expect(store.get('messages')).toEqual([]);
      expect(store.get('isIdle')).toBe(true);
      expect(store.get('isStreaming')).toBe(false);
    });
  });

  // 3. subscribe/unsubscribe lifecycle
  describe('subscribe/unsubscribe lifecycle', () => {
    it('subscribe receives state updates', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const listener = vi.fn();

      store.subscribe(listener);
      store.submit({ events: textStream(['hi']) });

      // stream/start fires synchronously with sync strategy
      expect(listener).toHaveBeenCalled();

      const [current, prev] = listener.mock.calls[0]!;
      expect(current.status).toBe('streaming');
      expect(prev.status).toBe('idle');
    });

    it('unsubscribe stops receiving updates', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const listener = vi.fn();

      const unsub = store.subscribe(listener);
      store.submit({ events: textStream(['a']) });
      const callCount = listener.mock.calls.length;

      unsub();
      store.reset();

      expect(listener.mock.calls.length).toBe(callCount);
    });

    it('multiple subscribers all receive updates', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      store.subscribe(listener1);
      store.subscribe(listener2);
      store.subscribe(listener3);

      store.submit({ events: textStream(['hi']) });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(listener3).toHaveBeenCalled();
    });

    it('no leaked listeners after unsubscribe', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const listener = vi.fn();

      const unsub = store.subscribe(listener);
      unsub();

      store.submit({ events: textStream(['hi']) });
      await waitForStream();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // 4. Key-specific subscribe
  describe('key-specific subscribe', () => {
    it('only fires when the subscribed key changes', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const textListener = vi.fn();
      const statusListener = vi.fn();

      store.subscribe('text', textListener);
      store.subscribe('status', statusListener);

      // stream/start changes status but not text (text resets to '' which it already is)
      store.submit({ events: textStream(['hello']) });

      // status should have changed from idle -> streaming
      expect(statusListener).toHaveBeenCalled();
    });

    it('does not fire on unrelated state changes', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const thinkingListener = vi.fn();

      store.subscribe('thinking', thinkingListener);

      // Submit only produces text-delta events, no thinking changes
      store.submit({ events: textStream(['hi']) });
      await waitForStream();

      // thinking never changed from '' -> it should not have been called
      expect(thinkingListener).not.toHaveBeenCalled();
    });
  });

  // 5. Microtask batching
  describe('microtask batching', () => {
    it('coalesces multiple rapid dispatches into one notification', async () => {
      const store = createAIStore(); // default 'microtask' strategy
      const listener = vi.fn();

      store.subscribe(listener);

      // setMessages dispatches synchronously but notification is batched
      store.setMessages([makeMessage({ role: 'user' })]);
      store.setMessages([makeMessage({ role: 'user' }), makeMessage({ role: 'assistant' })]);

      // Before microtask flush, no notifications yet
      expect(listener).not.toHaveBeenCalled();

      await flushMicrotasks();

      // Both dispatches coalesced into a single notification
      expect(listener).toHaveBeenCalledTimes(1);

      const [current] = listener.mock.calls[0]!;
      expect(current.messages).toHaveLength(2);
    });
  });

  // 6. Batch strategies
  describe('batch strategies', () => {
    it('sync strategy fires immediately', () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const listener = vi.fn();

      store.subscribe(listener);
      store.setMessages([makeMessage({ role: 'user' })]);

      // With sync strategy, notification fires immediately (no microtask needed)
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('microtask strategy defers notification', async () => {
      const store = createAIStore({ batchStrategy: 'microtask' });
      const listener = vi.fn();

      store.subscribe(listener);
      store.setMessages([makeMessage({ role: 'user' })]);

      expect(listener).not.toHaveBeenCalled();

      await flushMicrotasks();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('custom batch strategy is used', () => {
      const customBatch = vi.fn((notify: () => void) => notify());
      const store = createAIStore({ batchStrategy: customBatch });
      const listener = vi.fn();

      store.subscribe(listener);
      store.setMessages([makeMessage({ role: 'user' })]);

      expect(customBatch).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('abort handling', () => {
    it('pre-aborted signal causes immediate abort', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const controller = new AbortController();
      controller.abort();

      store.submit({
        signal: controller.signal,
        events: textStream(['should', 'not', 'appear']),
      });
      await waitForStream();

      expect(store.get('status')).toBe('aborted');
      expect(store.get('text')).toBe('');
    });

    it('does not apply raw stream chunks that arrive after abort', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            try {
              controller.enqueue(encoder.encode('late'));
            } catch {
              // The store cancels the stream on abort; ignore late producer writes.
            }
          }, 20);
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // Ignore close after cancellation.
            }
          }, 40);
        },
      });

      store.submit({ stream });
      setTimeout(() => {
        store.abort();
      }, 5);

      await waitForStream(80);

      expect(store.get('status')).toBe('aborted');
      expect(store.get('text')).toBe('');
    });
  });

  // 7. submit() with events
  describe('submit() with events', () => {
    it('transitions idle -> streaming -> text accumulates -> complete', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const states: string[] = [];

      store.subscribe((state) => {
        states.push(state.status);
      });

      store.submit({ events: textStream(['Hello', ' ', 'world']) });
      await waitForStream();

      expect(states).toContain('streaming');
      expect(states).toContain('complete');
      expect(store.get('status')).toBe('complete');
      expect(store.get('text')).toBe('Hello world');
    });

    it('appends user message when message shorthand is used', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ message: 'hi there', events: textStream(['reply']) });

      // User message should be appended
      const messages = store.get('messages');
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0]!.role).toBe('user');

      const userContent = messages[0]!.content[0]!;
      expect(userContent.type).toBe('text');
      if (userContent.type === 'text') {
        expect(userContent.text).toBe('hi there');
      }
    });

    it('builds assistant message on complete with text content', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: textStream(['Hello world']) });
      await waitForStream();

      const messages = store.get('messages');
      const assistant = messages.find((m) => m.role === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant!.content).toContainEqual({ type: 'text', text: 'Hello world' });
    });

    it('accumulates text through multiple deltas', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const textSnapshots: string[] = [];

      store.subscribe((state) => {
        if (state.text) textSnapshots.push(state.text);
      });

      store.submit({ events: textStream(['a', 'b', 'c']) });
      await waitForStream();

      expect(textSnapshots).toContain('a');
      expect(textSnapshots).toContain('ab');
      expect(textSnapshots).toContain('abc');
    });
  });

  // 8. submit() with raw stream (Anthropic provider)
  describe('submit() with raw stream through provider', () => {
    it('parses SSE data through the Anthropic provider', async () => {
      const { anthropic } = await import('../src/providers/anthropic.js');
      const store = createAIStore({ batchStrategy: 'sync', provider: anthropic() });

      const encoder = new TextEncoder();
      const ssePayload = [
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-3","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join('');

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(ssePayload));
          controller.close();
        },
      });

      store.submit({ stream });
      await waitForStream();

      expect(store.get('text')).toBe('Hi there');
      expect(store.get('status')).toBe('complete');
    });
  });

  // 9. abort()
  describe('abort()', () => {
    it('aborts mid-stream and preserves accumulated text', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: delayedTextStream(['Hello', ' world', '!'], 30) });

      // Wait long enough for at least the first chunk to arrive
      await new Promise((r) => setTimeout(r, 80));
      store.abort();

      await waitForStream();

      expect(store.get('status')).toBe('aborted');
      // At least some text was accumulated before abort
      expect(store.get('text').length).toBeGreaterThan(0);
    });

    it('abort via StreamHandle also works', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      const handle = store.submit({
        events: delayedTextStream(['a', 'b', 'c', 'd'], 50),
      });

      await new Promise((r) => setTimeout(r, 30));
      handle.abort();

      await waitForStream();

      expect(store.get('status')).toBe('aborted');
    });
  });

  // 10. reset()
  describe('reset()', () => {
    it('clears lastInput so retry throws after reset', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: textStream(['data']) });
      await waitForStream();

      store.reset();
      expect(() => store.retry()).toThrow('No previous submission to retry');
    });

    it('returns to initial state after streaming', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: textStream(['data']) });
      await waitForStream();

      expect(store.get('status')).toBe('complete');
      expect(store.get('text')).toBe('data');

      store.reset();

      expect(store.get('status')).toBe('idle');
      expect(store.get('text')).toBe('');
      expect(store.get('messages')).toEqual([]);
      expect(store.get('isIdle')).toBe(true);
      expect(store.get('isStreaming')).toBe(false);
    });

    it('aborts active stream on reset', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: delayedTextStream(['a', 'b', 'c'], 50) });

      await new Promise((r) => setTimeout(r, 30));
      store.reset();

      // After reset, state should be idle (not aborted)
      expect(store.get('status')).toBe('idle');
    });
  });

  // 11. destroy()
  describe('destroy()', () => {
    it('clears lastInput so retry throws after destroy', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: textStream(['data']) });
      await waitForStream();

      store.destroy();
      expect(() => store.retry()).toThrow('No previous submission to retry');
    });

    it('no more notifications fire after destroy', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const listener = vi.fn();

      store.subscribe(listener);

      store.destroy();
      listener.mockClear();

      store.setMessages([makeMessage({ role: 'user' })]);
      store.reset();

      expect(listener).not.toHaveBeenCalled();
    });

    it('aborts active stream on destroy', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ events: delayedTextStream(['a', 'b', 'c'], 100) });
      store.destroy();

      // No errors thrown, stream is silently aborted
      await waitForStream();
    });
  });

  // 12. retry()
  describe('retry()', () => {
    it('throws if no previous submission exists', () => {
      const store = createAIStore();
      expect(() => store.retry()).toThrow('No previous submission to retry');
    });

    it('resubmits the last input after a completed stream', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      let callCount = 0;

      async function* countedStream(): AsyncGenerator<StreamEvent> {
        callCount++;
        yield { type: 'text-delta', text: `run-${callCount}` };
        yield { type: 'finish', reason: 'stop' };
      }

      store.submit({ events: countedStream() });
      await waitForStream();

      expect(store.get('text')).toBe('run-1');
      expect(store.get('status')).toBe('complete');

      // retry() resubmits — but uses the same input object which has the
      // exhausted generator. The important thing is that it goes through
      // the submit path and transitions to streaming.
      const handle = store.retry();
      expect(handle).toHaveProperty('abort');
      expect(handle).toHaveProperty('signal');
      expect(store.get('status')).toBe('streaming');
    });
  });

  // 13. setMessages()
  describe('setMessages()', () => {
    it('directly sets the messages array', () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const msgs: Message[] = [makeMessage({ role: 'user' }), makeMessage({ role: 'assistant' })];

      store.setMessages(msgs);

      expect(store.get('messages')).toEqual(msgs);
      expect(store.get('lastMessage')).toBe(msgs[1]);
      expect(store.get('hasMessages')).toBe(true);
    });

    it('setting empty array clears messages', () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.setMessages([makeMessage({ role: 'user' })]);
      expect(store.get('hasMessages')).toBe(true);

      store.setMessages([]);
      expect(store.get('messages')).toEqual([]);
      expect(store.get('hasMessages')).toBe(false);
      expect(store.get('lastMessage')).toBeNull();
    });
  });

  // 14. addToolResult()
  describe('addToolResult()', () => {
    it('adds result to a pending tool call', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      async function* toolStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'tool-call-start', id: 'tc-1', name: 'get_weather' };
        yield { type: 'tool-call-delta', id: 'tc-1', inputDelta: '{"city":"SF"}' };
        yield { type: 'tool-call-end', id: 'tc-1', input: { city: 'SF' } };
        yield { type: 'finish', reason: 'tool-calls' };
      }

      store.submit({ events: toolStream() });
      await waitForStream();

      expect(store.get('toolCalls')).toHaveLength(1);
      expect(store.get('toolCalls')[0]!.status).toBe('complete');

      store.addToolResult('tc-1', { temperature: 72, unit: 'F' });

      expect(store.get('toolCalls')[0]!.output).toEqual({
        temperature: 72,
        unit: 'F',
      });
    });
  });

  // 15. use() middleware at runtime
  describe('use() middleware', () => {
    it('middleware function intercepts events', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const intercepted: StreamEvent[] = [];

      const unsub = store.use(async (ctx: MiddlewareContext, next: () => Promise<void>) => {
        intercepted.push({ ...ctx.event });
        await next();
      });

      store.submit({ events: textStream(['hello']) });
      await waitForStream();

      expect(intercepted.length).toBeGreaterThan(0);
      expect(intercepted.some((e) => e.type === 'text-delta')).toBe(true);
      expect(intercepted.some((e) => e.type === 'finish')).toBe(true);

      unsub();
    });

    it('removing middleware stops interception', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const intercepted: StreamEvent[] = [];

      const unsub = store.use(async (ctx: MiddlewareContext, next: () => Promise<void>) => {
        intercepted.push({ ...ctx.event });
        await next();
      });

      store.submit({ events: textStream(['first']) });
      await waitForStream();

      const countAfterFirst = intercepted.length;
      unsub();

      store.submit({ events: textStream(['second']) });
      await waitForStream();

      // No new events intercepted after removal
      expect(intercepted.length).toBe(countAfterFirst);
    });

    it('middleware can modify events before they reach the reducer', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.use(async (ctx: MiddlewareContext, next: () => Promise<void>) => {
        if (ctx.event.type === 'text-delta') {
          ctx.event = { type: 'text-delta', text: ctx.event.text.toUpperCase() };
        }
        await next();
      });

      store.submit({ events: textStream(['hello']) });
      await waitForStream();

      expect(store.get('text')).toBe('HELLO');
    });

    it('middleware object lifecycle hooks are called', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const hooks = {
        onStart: vi.fn(),
        onEvent: vi.fn(async (_ctx: MiddlewareContext, next: () => Promise<void>) => {
          await next();
        }),
        onComplete: vi.fn(),
      };

      // Use a stream that ends naturally without a 'finish' event
      // so that the consumeStream path for natural completion fires onComplete.
      async function* noFinishStream(): AsyncGenerator<StreamEvent> {
        yield { type: 'text-delta', text: 'hi' };
      }

      store.use(hooks as Middleware);
      store.submit({ events: noFinishStream() });
      await waitForStream();

      expect(hooks.onStart).toHaveBeenCalled();
      expect(hooks.onEvent).toHaveBeenCalled();
      expect(hooks.onComplete).toHaveBeenCalled();
    });
  });

  // 16. initialMessages option
  describe('initialMessages option', () => {
    it('populates state with initial messages', () => {
      const msgs: Message[] = [makeMessage({ role: 'user' }), makeMessage({ role: 'assistant' })];

      const store = createAIStore({ initialMessages: msgs });

      expect(store.get('messages')).toEqual(msgs);
      expect(store.get('lastMessage')).toBe(msgs[1]);
      expect(store.get('hasMessages')).toBe(true);
    });

    it('empty initialMessages leaves state unchanged', () => {
      const store = createAIStore({ initialMessages: [] });

      expect(store.get('messages')).toEqual([]);
      expect(store.get('hasMessages')).toBe(false);
    });
  });

  // 17. submit() with complete (non-streaming) response
  describe('submit() with response (non-streaming)', () => {
    it('completes with text from a complete response', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({
        message: 'hello',
        response: { text: 'Hi there!' },
      });
      await waitForStream();

      expect(store.get('status')).toBe('complete');
      expect(store.get('text')).toBe('Hi there!');
      expect(store.get('messages').length).toBeGreaterThanOrEqual(2);
    });

    it('populates usage from a complete response', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({
        response: {
          text: 'result',
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      });
      await waitForStream();

      expect(store.get('usage')).not.toBeNull();
      expect(store.get('usage')!.inputTokens).toBe(100);
      expect(store.get('usage')!.outputTokens).toBe(50);
    });

    it('handles tool calls in a complete response', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({
        response: {
          toolCalls: [{ id: 'tc-1', name: 'search', input: { query: 'cats' } }],
          finishReason: 'tool-calls',
        },
      });
      await waitForStream();

      expect(store.get('status')).toBe('complete');
      expect(store.get('toolCalls')).toHaveLength(1);
      expect(store.get('toolCalls')[0]!.name).toBe('search');
      expect(store.get('toolCalls')[0]!.input).toEqual({ query: 'cats' });
      expect(store.get('toolCalls')[0]!.status).toBe('complete');
    });

    it('handles structured object output', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({
        response: {
          text: 'Here are results',
          object: { items: [{ name: 'cat', url: 'cat.jpg' }] },
        },
      });
      await waitForStream();

      expect(store.get('status')).toBe('complete');
      expect(store.get('object')).toEqual({ items: [{ name: 'cat', url: 'cat.jpg' }] });
    });

    it('handles thinking content', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({
        response: {
          thinking: 'Let me reason about this...',
          text: 'The answer is 42',
        },
      });
      await waitForStream();

      expect(store.get('thinking')).toBe('Let me reason about this...');
      expect(store.get('text')).toBe('The answer is 42');
    });

    it('middleware intercepts response events', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });
      const intercepted: StreamEvent[] = [];

      store.use(async (ctx: MiddlewareContext, next: () => Promise<void>) => {
        intercepted.push({ ...ctx.event });
        await next();
      });

      store.submit({ response: { text: 'hello' } });
      await waitForStream();

      expect(intercepted.some((e) => e.type === 'text-delta')).toBe(true);
      expect(intercepted.some((e) => e.type === 'finish')).toBe(true);
    });

    it('empty response still completes', async () => {
      const store = createAIStore({ batchStrategy: 'sync' });

      store.submit({ response: {} });
      await waitForStream();

      expect(store.get('status')).toBe('complete');
      expect(store.get('text')).toBe('');
    });
  });
});
