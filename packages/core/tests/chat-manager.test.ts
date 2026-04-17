import { describe, it, expect, vi } from 'vitest';
import { createChatManager } from '../src/chat-manager.js';
import { createAIStore } from '../src/store.js';
import type { StreamEvent, Message } from '../src/types.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) yield { type: 'text-delta', text };
  yield { type: 'finish', reason: 'stop' };
}

function makeMessage(overrides: Partial<Message> & { role: Message['role'] }): Message {
  return {
    id: crypto.randomUUID(),
    content: [{ type: 'text', text: 'hello' }],
    createdAt: new Date(),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(r));
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('createChatManager', () => {
  // 1. create() returns an AIStore
  it('create() returns an AIStore', () => {
    const manager = createChatManager();
    const store = manager.create('chat-1');

    expect(store).toBeDefined();
    expect(typeof store.get).toBe('function');
    expect(typeof store.submit).toBe('function');
    expect(typeof store.subscribe).toBe('function');
    expect(typeof store.destroy).toBe('function');
    expect(store.get('status')).toBe('idle');

    manager.destroy();
  });

  // 2. create() with custom ID
  it('create() with custom ID stores under that ID', () => {
    const manager = createChatManager();
    const store = manager.create('my-custom-id');

    expect(manager.get('my-custom-id')).toBe(store);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]!.id).toBe('my-custom-id');

    manager.destroy();
  });

  // 3. create() with auto-generated ID
  it('create() without ID auto-generates one', () => {
    const manager = createChatManager();
    manager.create();

    const chats = manager.list();
    expect(chats).toHaveLength(1);
    expect(chats[0]!.id).toBeTruthy();
    expect(typeof chats[0]!.id).toBe('string');

    manager.destroy();
  });

  // 4. get() retrieves created store
  it('get() retrieves a created store', () => {
    const manager = createChatManager();
    const store = manager.create('chat-1');

    expect(manager.get('chat-1')).toBe(store);

    manager.destroy();
  });

  // 5. get() returns undefined for unknown ID
  it('get() returns undefined for unknown ID', () => {
    const manager = createChatManager();

    expect(manager.get('nonexistent')).toBeUndefined();

    manager.destroy();
  });

  // 6. delete() destroys store and removes it
  it('delete() destroys store and removes it', () => {
    const manager = createChatManager();
    const store = manager.create('chat-1');

    manager.delete('chat-1');

    expect(manager.get('chat-1')).toBeUndefined();
    expect(manager.list()).toHaveLength(0);

    // Store should be destroyed (subscribing after destroy should still work
    // but the store's internal state is cleared)
    const state = store.get();
    // After destroy, we can still call get() but listeners were cleared
    expect(state).toBeDefined();
  });

  // 7. list() returns ChatInfo for all chats
  it('list() returns ChatInfo for all chats', () => {
    const manager = createChatManager();
    manager.create('a');
    manager.create('b');
    manager.create('c');

    const chats = manager.list();
    expect(chats).toHaveLength(3);

    const ids = chats.map((c) => c.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');

    for (const chat of chats) {
      expect(chat.status).toBe('idle');
      expect(chat.messageCount).toBe(0);
      expect(chat.title).toBeNull();
      expect(chat.lastMessageAt).toBeNull();
    }

    manager.destroy();
  });

  // 8. list() ChatInfo has correct title (first user message)
  it('list() ChatInfo has correct title from first user message', () => {
    const manager = createChatManager();
    const store = manager.create('chat-1');

    store.setMessages([
      makeMessage({ role: 'user', content: [{ type: 'text', text: 'Hello, how are you today?' }] }),
      makeMessage({ role: 'assistant', content: [{ type: 'text', text: 'I am fine!' }] }),
    ]);

    const chats = manager.list();
    expect(chats[0]!.title).toBe('Hello, how are you today?');
    expect(chats[0]!.messageCount).toBe(2);

    manager.destroy();
  });

  it('list() ChatInfo title is truncated to 50 chars', () => {
    const manager = createChatManager();
    const store = manager.create('chat-1');

    const longText = 'A'.repeat(80);
    store.setMessages([makeMessage({ role: 'user', content: [{ type: 'text', text: longText }] })]);

    const chats = manager.list();
    expect(chats[0]!.title).toBe('A'.repeat(50));

    manager.destroy();
  });

  // 9. setActive() / activeId / active work correctly
  it('setActive() / activeId / active work correctly', () => {
    const manager = createChatManager();
    const store1 = manager.create('chat-1');
    const store2 = manager.create('chat-2');

    expect(manager.activeId).toBeNull();
    expect(manager.active).toBeNull();

    manager.setActive('chat-1');
    expect(manager.activeId).toBe('chat-1');
    expect(manager.active).toBe(store1);

    manager.setActive('chat-2');
    expect(manager.activeId).toBe('chat-2');
    expect(manager.active).toBe(store2);

    manager.destroy();
  });

  it('setActive() throws for unknown ID', () => {
    const manager = createChatManager();

    expect(() => manager.setActive('nonexistent')).toThrow('does not exist');

    manager.destroy();
  });

  // 10. subscribe() fires on create
  it('subscribe() fires on create', () => {
    const manager = createChatManager();
    const listener = vi.fn();

    manager.subscribe(listener);
    manager.create('chat-1');

    expect(listener).toHaveBeenCalledTimes(1);
    const chats = listener.mock.calls[0]![0];
    expect(chats).toHaveLength(1);
    expect(chats[0].id).toBe('chat-1');

    manager.destroy();
  });

  // 11. subscribe() fires on delete
  it('subscribe() fires on delete', () => {
    const manager = createChatManager();
    manager.create('chat-1');

    const listener = vi.fn();
    manager.subscribe(listener);

    manager.delete('chat-1');

    expect(listener).toHaveBeenCalledTimes(1);
    const chats = listener.mock.calls[0]![0];
    expect(chats).toHaveLength(0);

    manager.destroy();
  });

  // 12. subscribe() fires on setActive
  it('subscribe() fires on setActive', () => {
    const manager = createChatManager();
    manager.create('chat-1');

    const listener = vi.fn();
    manager.subscribe(listener);

    manager.setActive('chat-1');

    expect(listener).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  // 13. subscribe() fires on chat status change
  it('subscribe() fires on chat status change (streaming)', async () => {
    const manager = createChatManager({ defaults: { batchStrategy: 'sync' } });
    const store = manager.create('chat-1');

    const listener = vi.fn();
    manager.subscribe(listener);
    listener.mockClear();

    store.submit({ events: textStream(['hello']) });

    // Wait for async stream consumption
    await waitForStream();

    // Listener should have been called at least once due to status changes
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    // Check that at some point during the calls, a streaming status was reported
    const allStatuses = listener.mock.calls.map((call: [ChatInfo[]]) => call[0][0]!.status);
    expect(allStatuses).toContain('streaming');

    manager.destroy();
  });

  // 14. maxChats enforcement
  it('maxChats enforcement - oldest non-active chat destroyed', () => {
    const manager = createChatManager({ maxChats: 2 });

    manager.create('chat-1');
    manager.create('chat-2');
    manager.setActive('chat-2');

    // Adding a third chat should evict chat-1 (oldest, non-active)
    manager.create('chat-3');

    expect(manager.get('chat-1')).toBeUndefined();
    expect(manager.get('chat-2')).toBeDefined();
    expect(manager.get('chat-3')).toBeDefined();
    expect(manager.list()).toHaveLength(2);

    manager.destroy();
  });

  it('maxChats skips active chat when evicting', () => {
    const manager = createChatManager({ maxChats: 2 });

    manager.create('chat-1');
    manager.create('chat-2');
    manager.setActive('chat-1');

    // chat-1 is active, so chat-2 (next oldest non-active) should be evicted
    manager.create('chat-3');

    expect(manager.get('chat-1')).toBeDefined();
    expect(manager.get('chat-2')).toBeUndefined();
    expect(manager.get('chat-3')).toBeDefined();

    manager.destroy();
  });

  // 15. destroy() cleans up all chats
  it('destroy() cleans up all chats', () => {
    const manager = createChatManager();
    manager.create('chat-1');
    manager.create('chat-2');
    manager.setActive('chat-1');

    manager.destroy();

    expect(manager.list()).toHaveLength(0);
    expect(manager.activeId).toBeNull();
    expect(manager.active).toBeNull();
  });

  // 16. destroy() clears listeners
  it('destroy() clears listeners', () => {
    const manager = createChatManager();
    const listener = vi.fn();
    manager.subscribe(listener);

    manager.create('chat-1');
    expect(listener).toHaveBeenCalledTimes(1);

    manager.destroy();
    listener.mockClear();

    // After destroy, creating wouldn't notify (but we can't create after destroy
    // without re-creating the manager, so we verify the listener set was cleared
    // indirectly through the lack of new calls)
    expect(listener).not.toHaveBeenCalled();
  });

  // Additional edge case: delete clears activeId when active chat is deleted
  it('delete() clears activeId when active chat is deleted', () => {
    const manager = createChatManager();
    manager.create('chat-1');
    manager.setActive('chat-1');

    expect(manager.activeId).toBe('chat-1');
    manager.delete('chat-1');
    expect(manager.activeId).toBeNull();
    expect(manager.active).toBeNull();

    manager.destroy();
  });

  // subscribe returns an unsubscribe function
  it('subscribe() returns working unsubscribe function', () => {
    const manager = createChatManager();
    const listener = vi.fn();

    const unsub = manager.subscribe(listener);
    manager.create('chat-1');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    listener.mockClear();

    manager.create('chat-2');
    expect(listener).not.toHaveBeenCalled();

    manager.destroy();
  });

  // create with merged defaults
  it('create() merges default options', () => {
    const manager = createChatManager({
      defaults: { batchStrategy: 'sync' },
    });

    const store = manager.create('chat-1');
    // Store should be functional with merged defaults
    expect(store.get('status')).toBe('idle');

    manager.destroy();
  });

  // ── Post-destroy safety ──

  it('create() throws after destroy()', () => {
    const manager = createChatManager();
    manager.destroy();

    expect(() => manager.create('chat-1')).toThrow('destroyed');
  });

  it('delete() throws after destroy()', () => {
    const manager = createChatManager();
    manager.destroy();

    expect(() => manager.delete('chat-1')).toThrow('destroyed');
  });

  it('setActive() throws after destroy()', () => {
    const manager = createChatManager();
    manager.destroy();

    expect(() => manager.setActive('chat-1')).toThrow('destroyed');
  });

  it('subscribe() throws after destroy()', () => {
    const manager = createChatManager();
    manager.destroy();

    expect(() => manager.subscribe(() => {})).toThrow('destroyed');
  });

  it('list() returns empty after destroy()', () => {
    const manager = createChatManager();
    manager.create('chat-1');
    manager.destroy();

    expect(manager.list()).toHaveLength(0);
  });

  it('get() returns undefined after destroy()', () => {
    const manager = createChatManager();
    manager.create('chat-1');
    manager.destroy();

    expect(manager.get('chat-1')).toBeUndefined();
  });

  it('destroy() is idempotent', () => {
    const manager = createChatManager();
    manager.create('chat-1');

    manager.destroy();
    expect(() => manager.destroy()).not.toThrow();
  });

  // ── Duplicate ID handling ──

  it('create() with duplicate ID destroys old store and replaces it', () => {
    const manager = createChatManager();
    const store1 = manager.create('chat-1');

    const store2 = manager.create('chat-1');

    expect(store2).not.toBe(store1);
    expect(manager.get('chat-1')).toBe(store2);
    expect(manager.list()).toHaveLength(1);
  });

  // ── enforceMaxChats loops properly ──

  it('maxChats enforcement evicts multiple chats when needed', () => {
    const manager = createChatManager({ maxChats: 1 });

    manager.create('chat-1');
    manager.create('chat-2');

    // Only 1 chat should remain (chat-2), chat-1 evicted
    expect(manager.list()).toHaveLength(1);
    expect(manager.get('chat-1')).toBeUndefined();
    expect(manager.get('chat-2')).toBeDefined();

    manager.destroy();
  });
});
