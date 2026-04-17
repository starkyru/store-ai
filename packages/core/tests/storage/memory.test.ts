import { describe, it, expect } from 'vitest';
import { memoryStorage } from '../../src/storage/memory.js';
import type { SerializedChat } from '../../src/types.js';

function makeChat(id: string): SerializedChat {
  return {
    id,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('memoryStorage', () => {
  it('get/set round-trip', async () => {
    const storage = memoryStorage();
    const chat = makeChat('chat-1');

    await storage.set('chat-1', chat);
    const result = await storage.get('chat-1');

    expect(result).toEqual(chat);
  });

  it('get returns null for missing key', async () => {
    const storage = memoryStorage();
    const result = await storage.get('nonexistent');

    expect(result).toBeNull();
  });

  it('list returns all keys', async () => {
    const storage = memoryStorage();
    await storage.set('a', makeChat('a'));
    await storage.set('b', makeChat('b'));
    await storage.set('c', makeChat('c'));

    const keys = await storage.list();
    expect(keys).toHaveLength(3);
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');
  });

  it('delete removes entry', async () => {
    const storage = memoryStorage();
    await storage.set('to-delete', makeChat('to-delete'));

    await storage.delete('to-delete');
    const result = await storage.get('to-delete');

    expect(result).toBeNull();
  });

  it('delete on nonexistent key does not throw', async () => {
    const storage = memoryStorage();
    await expect(storage.delete('nope')).resolves.toBeUndefined();
  });

  it('list returns empty array when no entries', async () => {
    const storage = memoryStorage();
    const keys = await storage.list();

    expect(keys).toEqual([]);
  });

  it('round-trips non-chat unknown values', async () => {
    const storage = memoryStorage();

    // Stream checkpoint shape
    const checkpoint = {
      streamId: 'test',
      events: [{ type: 'text-delta', text: 'hi' }],
      completed: true,
      lastEventAt: new Date().toISOString(),
    };
    await storage.set('stream:test', checkpoint);
    expect(await storage.get('stream:test')).toEqual(checkpoint);

    // Primitive
    await storage.set('primitive', 42 as unknown);
    expect(await storage.get('primitive')).toBe(42);
  });

  it('set overwrites existing entry', async () => {
    const storage = memoryStorage();
    const chat1 = makeChat('overwrite');
    const chat2 = { ...makeChat('overwrite'), updatedAt: 'later' };

    await storage.set('overwrite', chat1);
    await storage.set('overwrite', chat2);

    const result = (await storage.get('overwrite')) as SerializedChat | null;
    expect(result!.updatedAt).toBe('later');
  });
});
