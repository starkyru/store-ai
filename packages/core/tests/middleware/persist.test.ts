import { describe, it, expect, vi } from 'vitest';
import { createAIStore } from '../../src/store.js';
import { persist, restoreChat, listChats, deleteChat } from '../../src/middleware/persist.js';
import { memoryStorage } from '../../src/storage/memory.js';
import type { StorageAdapter, StreamEvent } from '../../src/types.js';

// ── Helpers ──

async function* textStream(chunks: string[]): AsyncGenerator<StreamEvent> {
  for (const text of chunks) {
    yield { type: 'text-delta', text };
  }
  yield { type: 'finish', reason: 'stop' };
}

async function waitForStream(delayMs = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));
}

// ── Tests ──

describe('persist middleware', () => {
  it('saves messages on stream complete', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-1')],
    });

    store.submit({ message: 'hello', events: textStream(['world']) });
    await waitForStream();

    const saved = (await storage.get('chat-1')) as {
      id: string;
      messages: unknown[];
      createdAt: string;
      updatedAt: string;
    } | null;
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('chat-1');
    expect(saved!.messages.length).toBeGreaterThanOrEqual(1);
    expect(saved!.createdAt).toBeDefined();
    expect(saved!.updatedAt).toBeDefined();
  });

  it('does NOT save on error', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-err')],
    });

    async function* errorStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('stream failed');
    }

    store.submit({ events: errorStream() });
    await waitForStream();

    const saved = await storage.get('chat-err');
    expect(saved).toBeNull();
  });

  it('does NOT save on abort', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-abort')],
    });

    async function* slowStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'start' };
      await new Promise((r) => setTimeout(r, 200));
      yield { type: 'text-delta', text: 'end' };
      yield { type: 'finish', reason: 'stop' };
    }

    store.submit({ events: slowStream() });
    await new Promise((r) => setTimeout(r, 30));
    store.abort();
    await waitForStream();

    const saved = await storage.get('chat-abort');
    expect(saved).toBeNull();
  });

  it('storage errors do not crash the stream', async () => {
    const failingStorage: StorageAdapter = {
      async get() {
        throw new Error('storage get failed');
      },
      async set() {
        throw new Error('storage set failed');
      },
      async delete() {
        throw new Error('storage delete failed');
      },
      async list() {
        throw new Error('storage list failed');
      },
    };

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(failingStorage, 'chat-fail')],
    });

    // Use a stream without finish so onComplete fires via natural end
    async function* noFinishStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text-delta', text: 'hello' };
    }

    store.submit({ events: noFinishStream() });
    await waitForStream();

    // Stream should complete normally despite storage failure
    expect(store.get('status')).toBe('complete');
    expect(store.get('text')).toBe('hello');
  });

  it('uses custom chatId', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'my-custom-id')],
    });

    store.submit({ events: textStream(['test']) });
    await waitForStream();

    const saved = (await storage.get('my-custom-id')) as { id: string } | null;
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('my-custom-id');
  });

  it('uses generated chatId if none provided', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage)],
    });

    store.submit({ events: textStream(['test']) });
    await waitForStream();

    const keys = await storage.list();
    expect(keys).toHaveLength(1);
    // UUID format check
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('restoreChat returns saved conversation', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'restore-test')],
    });

    store.submit({ message: 'hi', events: textStream(['hello']) });
    await waitForStream();

    const saved = await restoreChat(storage, 'restore-test');
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('restore-test');
    expect(saved!.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('restoreChat returns null for missing chat', async () => {
    const storage = memoryStorage();
    const saved = await restoreChat(storage, 'nonexistent');
    expect(saved).toBeNull();
  });

  it('restoreChat returns null for malformed objects', async () => {
    const storage = memoryStorage();

    // Missing required fields
    await storage.set('bad-1', { id: 'bad-1' });
    expect(await restoreChat(storage, 'bad-1')).toBeNull();

    // Wrong types
    await storage.set('bad-2', { id: 123, messages: 'not-array', createdAt: 0, updatedAt: 0 });
    expect(await restoreChat(storage, 'bad-2')).toBeNull();

    // Stream checkpoint shape (not a chat)
    await storage.set('bad-3', {
      streamId: 'bad-3',
      events: [{ type: 'text-delta', text: 'x' }],
      completed: true,
      lastEventAt: new Date().toISOString(),
    });
    expect(await restoreChat(storage, 'bad-3')).toBeNull();
  });

  it('persist.save uses fresh createdAt when existing value is non-chat', async () => {
    const storage = memoryStorage();

    // Pre-populate key with a non-chat value
    await storage.set('overwrite-test', {
      streamId: 'x',
      events: [],
      completed: true,
      lastEventAt: new Date().toISOString(),
    });

    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'overwrite-test')],
    });

    store.submit({ events: textStream(['hello']) });
    await waitForStream();

    const saved = (await storage.get('overwrite-test')) as {
      id: string;
      createdAt: string;
      updatedAt: string;
    } | null;
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe('overwrite-test');
    // createdAt should be freshly generated, not inherited from the garbage value
    expect(saved!.createdAt).toBe(saved!.updatedAt);
  });

  it('restoreChat handles storage errors gracefully', async () => {
    const failingStorage: StorageAdapter = {
      async get() {
        throw new Error('fail');
      },
      async set() {},
      async delete() {},
      async list() {
        return [];
      },
    };
    const saved = await restoreChat(failingStorage, 'x');
    expect(saved).toBeNull();
  });

  it('listChats returns all chat IDs', async () => {
    const storage = memoryStorage();
    const s1 = createAIStore({ batchStrategy: 'sync', middleware: [persist(storage, 'a')] });
    const s2 = createAIStore({ batchStrategy: 'sync', middleware: [persist(storage, 'b')] });

    s1.submit({ events: textStream(['one']) });
    s2.submit({ events: textStream(['two']) });
    await waitForStream();

    const ids = await listChats(storage);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('listChats excludes non-chat records stored in the same adapter', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-only')],
    });

    store.submit({ events: textStream(['hello']) });
    await waitForStream();

    await storage.set('stream:chat-only:req-1', {
      streamId: 'chat-only:req-1',
      events: [{ type: 'text-delta', text: 'partial' }],
      completed: false,
      lastEventAt: new Date().toISOString(),
    });

    const ids = await listChats(storage);
    expect(ids).toEqual(['chat-only']);
  });

  it('deleteChat removes a conversation', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'to-delete')],
    });

    store.submit({ events: textStream(['bye']) });
    await waitForStream();
    expect(await restoreChat(storage, 'to-delete')).not.toBeNull();

    await deleteChat(storage, 'to-delete');
    expect(await restoreChat(storage, 'to-delete')).toBeNull();
  });

  it('restoreChat + setMessages restores conversation into store', async () => {
    const storage = memoryStorage();
    const store1 = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'full-restore')],
    });

    store1.submit({ message: 'hello', events: textStream(['world']) });
    await waitForStream();

    // New store, restore from storage
    const store2 = createAIStore({ batchStrategy: 'sync' });
    const saved = await restoreChat(storage, 'full-restore');
    expect(saved).not.toBeNull();
    expect(saved!.messages.length).toBeGreaterThanOrEqual(1);
    store2.setMessages(saved!.messages);

    expect(store2.get('messages').length).toBe(saved!.messages.length);
    expect(store2.get('hasMessages')).toBe(true);
  });

  it('preserves createdAt on subsequent saves', async () => {
    const storage = memoryStorage();
    const store = createAIStore({
      batchStrategy: 'sync',
      middleware: [persist(storage, 'chat-multi')],
    });

    store.submit({ events: textStream(['first']) });
    await waitForStream();

    const firstSave = (await storage.get('chat-multi')) as {
      createdAt: string;
      updatedAt: string;
    } | null;
    const originalCreatedAt = firstSave!.createdAt;

    // Second stream
    store.submit({ events: textStream(['second']) });
    await waitForStream();

    const secondSave = (await storage.get('chat-multi')) as {
      createdAt: string;
      updatedAt: string;
    } | null;
    expect(secondSave!.createdAt).toBe(originalCreatedAt);
    expect(secondSave!.updatedAt).not.toBe(secondSave!.createdAt);
  });
});
