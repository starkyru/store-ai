import { describe, it, expect, vi } from 'vitest';
import { createUIRegistry, connectUI } from '../src/generative-ui.js';
import type { UIElement, ToolRenderer } from '../src/generative-ui.js';
import type { ToolCallState, StreamEvent } from '../src/types.js';
import { createAIStore } from '../src/store.js';

// ── Helpers ──

function makeToolCall(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    id: 'tc-1',
    name: 'get_weather',
    status: 'complete',
    input: { city: 'SF' },
    inputText: '{"city":"SF"}',
    output: null,
    error: null,
    startedAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

function weatherRenderer(toolCall: ToolCallState): UIElement {
  return {
    component: toolCall.name,
    props: (toolCall.input as Record<string, unknown>) ?? {},
    loading: toolCall.status === 'pending' || toolCall.status === 'partial',
    toolCall,
  };
}

async function* toolStream(
  tools: Array<{ id: string; name: string; input: unknown }>,
): AsyncGenerator<StreamEvent> {
  for (const tool of tools) {
    yield { type: 'tool-call-start', id: tool.id, name: tool.name };
    yield {
      type: 'tool-call-delta',
      id: tool.id,
      inputDelta: JSON.stringify(tool.input),
    };
    yield { type: 'tool-call-end', id: tool.id, input: tool.input };
  }
  yield { type: 'finish', reason: 'tool-calls' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('createUIRegistry', () => {
  // 1. Register a renderer and render a tool call
  it('renders a tool call with a registered renderer', () => {
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    const tc = makeToolCall();
    const element = registry.render(tc);

    expect(element).not.toBeNull();
    expect(element!.component).toBe('get_weather');
    expect(element!.props).toEqual({ city: 'SF' });
    expect(element!.loading).toBe(false);
    expect(element!.toolCall).toBe(tc);
  });

  // 2. Unregistered tool returns null
  it('returns null for an unregistered tool', () => {
    const registry = createUIRegistry();

    const tc = makeToolCall({ name: 'unknown_tool' });
    const element = registry.render(tc);

    expect(element).toBeNull();
  });

  // 3. renderAll filters to registered tools only
  it('renderAll returns elements only for registered tools', () => {
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    const calls = [
      makeToolCall({ id: 'tc-1', name: 'get_weather' }),
      makeToolCall({ id: 'tc-2', name: 'search_web' }),
    ];

    const elements = registry.renderAll(calls);

    expect(elements).toHaveLength(1);
    expect(elements[0]!.component).toBe('get_weather');
  });

  // 4. Unregister removes renderer
  it('unregister removes a previously registered renderer', () => {
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    expect(registry.has('get_weather')).toBe(true);
    registry.unregister('get_weather');
    expect(registry.has('get_weather')).toBe(false);

    const tc = makeToolCall();
    expect(registry.render(tc)).toBeNull();
  });

  // 5. has() checks registration
  it('has() correctly reports registration status', () => {
    const registry = createUIRegistry();

    expect(registry.has('get_weather')).toBe(false);
    registry.register('get_weather', weatherRenderer);
    expect(registry.has('get_weather')).toBe(true);
  });

  // 6. Fallback renderer handles unregistered tools
  it('fallback renderer is used for unregistered tools', () => {
    const registry = createUIRegistry();

    const fallback: ToolRenderer = (tc) => ({
      component: 'GenericTool',
      props: { name: tc.name },
      loading: tc.status === 'pending' || tc.status === 'partial',
      toolCall: tc,
    });

    registry.setFallback(fallback);

    const tc = makeToolCall({ name: 'unknown_tool' });
    const element = registry.render(tc);

    expect(element).not.toBeNull();
    expect(element!.component).toBe('GenericTool');
    expect(element!.props).toEqual({ name: 'unknown_tool' });
  });

  // 7. Loading state: pending/partial → loading: true, complete → loading: false
  it('loading state reflects tool call status', () => {
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    const pending = makeToolCall({ status: 'pending', completedAt: null });
    const partial = makeToolCall({ status: 'partial', completedAt: null });
    const complete = makeToolCall({ status: 'complete' });
    const error = makeToolCall({ status: 'error' });

    expect(registry.render(pending)!.loading).toBe(true);
    expect(registry.render(partial)!.loading).toBe(true);
    expect(registry.render(complete)!.loading).toBe(false);
    expect(registry.render(error)!.loading).toBe(false);
  });

  // 8. renderAll with mixed registered/unregistered
  it('renderAll handles mix of registered, unregistered, and fallback tools', () => {
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    const fallback: ToolRenderer = (tc) => ({
      component: 'Fallback',
      props: {},
      loading: false,
      toolCall: tc,
    });
    registry.setFallback(fallback);

    const calls = [
      makeToolCall({ id: 'tc-1', name: 'get_weather' }),
      makeToolCall({ id: 'tc-2', name: 'search_web' }),
      makeToolCall({ id: 'tc-3', name: 'run_code' }),
    ];

    const elements = registry.renderAll(calls);

    expect(elements).toHaveLength(3);
    expect(elements[0]!.component).toBe('get_weather');
    expect(elements[1]!.component).toBe('Fallback');
    expect(elements[2]!.component).toBe('Fallback');
  });

  // 9. list() returns all registered tool names
  it('list() returns all registered tool names', () => {
    const registry = createUIRegistry();

    expect(registry.list()).toEqual([]);

    registry.register('get_weather', weatherRenderer);
    registry.register('search_web', weatherRenderer);
    registry.register('run_code', weatherRenderer);

    const names = registry.list();
    expect(names).toHaveLength(3);
    expect(names).toContain('get_weather');
    expect(names).toContain('search_web');
    expect(names).toContain('run_code');
  });

  // Fallback can be cleared
  it('setFallback(null) clears the fallback renderer', () => {
    const registry = createUIRegistry();

    registry.setFallback((tc) => ({
      component: 'Fallback',
      props: {},
      loading: false,
      toolCall: tc,
    }));

    const tc = makeToolCall({ name: 'unknown' });
    expect(registry.render(tc)).not.toBeNull();

    registry.setFallback(null);
    expect(registry.render(tc)).toBeNull();
  });

  // Registered renderer takes priority over fallback
  it('registered renderer takes priority over fallback', () => {
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    registry.setFallback((tc) => ({
      component: 'Fallback',
      props: {},
      loading: false,
      toolCall: tc,
    }));

    const tc = makeToolCall({ name: 'get_weather' });
    const element = registry.render(tc);

    expect(element!.component).toBe('get_weather');
  });
});

describe('connectUI', () => {
  // 10. connectUI returns correct UIElements from store state
  it('returns correct UIElements from current store state', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    store.submit({
      events: toolStream([{ id: 'tc-1', name: 'get_weather', input: { city: 'SF' } }]),
    });
    await waitForStream();

    const { getElements, destroy } = connectUI(store, registry);
    const elements = getElements();

    expect(elements).toHaveLength(1);
    expect(elements[0]!.component).toBe('get_weather');
    expect(elements[0]!.props).toEqual({ city: 'SF' });

    destroy();
  });

  // 11. connectUI updates when store tool calls change
  it('updates elements when store tool calls change', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);
    registry.register('search_web', (tc) => ({
      component: tc.name,
      props: (tc.input as Record<string, unknown>) ?? {},
      loading: tc.status === 'pending' || tc.status === 'partial',
      toolCall: tc,
    }));

    const { getElements, destroy } = connectUI(store, registry);

    // Initially no tool calls
    expect(getElements()).toEqual([]);

    // Stream with one tool
    store.submit({
      events: toolStream([{ id: 'tc-1', name: 'get_weather', input: { city: 'SF' } }]),
    });
    await waitForStream();

    const afterFirst = getElements();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.component).toBe('get_weather');

    // Stream with two tools
    store.submit({
      events: toolStream([
        { id: 'tc-2', name: 'get_weather', input: { city: 'NYC' } },
        { id: 'tc-3', name: 'search_web', input: { query: 'hello' } },
      ]),
    });
    await waitForStream();

    const afterSecond = getElements();
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond[0]!.component).toBe('get_weather');
    expect(afterSecond[1]!.component).toBe('search_web');

    destroy();
  });

  // 12. connectUI destroy stops updates
  it('destroy stops receiving updates from the store', async () => {
    const store = createAIStore({ batchStrategy: 'sync' });
    const registry = createUIRegistry();
    registry.register('get_weather', weatherRenderer);

    const { getElements, destroy } = connectUI(store, registry);

    store.submit({
      events: toolStream([{ id: 'tc-1', name: 'get_weather', input: { city: 'SF' } }]),
    });
    await waitForStream();

    expect(getElements()).toHaveLength(1);

    destroy();

    // After destroy, submit new tool calls — getElements should still return the old cached value
    store.submit({
      events: toolStream([
        { id: 'tc-2', name: 'get_weather', input: { city: 'NYC' } },
        { id: 'tc-3', name: 'get_weather', input: { city: 'LA' } },
      ]),
    });
    await waitForStream();

    // Still returns the old cached result (1 element, not 2)
    expect(getElements()).toHaveLength(1);
    expect(getElements()[0]!.props).toEqual({ city: 'SF' });
  });
});
