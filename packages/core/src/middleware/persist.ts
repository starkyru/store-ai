import type {
  AIState,
  MiddlewareContext,
  MiddlewareObject,
  SerializedChat,
  StorageAdapter,
} from '../types.js';

/**
 * Persistence middleware that saves messages to storage on stream completion
 * and can restore previously saved conversations.
 *
 * @param storage - A {@link StorageAdapter} implementation (memoryStorage, localStorageAdapter, indexedDBAdapter, or custom).
 * @param chatId  - Optional stable chat ID. If omitted a random UUID is generated.
 *                  Pass a stable ID to enable restore across page reloads.
 *
 * @example
 * ```ts
 * const storage = localStorageAdapter('my-app');
 * const store = createAIStore({
 *   middleware: [persist(storage, 'chat-1')],
 * });
 *
 * // Restore a previous conversation
 * const saved = await persist.restore(storage, 'chat-1');
 * if (saved) store.setMessages(saved.messages);
 * ```
 */
export function persist(storage: StorageAdapter, chatId?: string): MiddlewareObject {
  const id = chatId ?? crypto.randomUUID();
  let saved = false;

  async function save(state: Readonly<AIState>): Promise<void> {
    if (saved) return;
    saved = true;
    try {
      const existing = await storage.get(id);
      const now = new Date().toISOString();

      await storage.set(id, {
        id,
        messages: state.messages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    } catch {
      // Storage failures must never crash the stream
    }
  }

  return {
    name: 'persist',

    onStart() {
      saved = false;
    },

    async onEvent(ctx: MiddlewareContext, next: () => Promise<void>) {
      await next();
      // Save after the finish event has been dispatched to the reducer,
      // so state.messages includes the final assistant message.
      if (ctx.event.type === 'finish') {
        await save(ctx.state);
      }
    },

    async onComplete(ctx: { state: Readonly<AIState> }) {
      // Also handle streams that end naturally without a finish event
      await save(ctx.state);
    },
  };
}

/**
 * Restore a previously persisted conversation from storage.
 * Returns the serialized chat (including messages) or null if not found.
 *
 * @param storage - The same StorageAdapter used with the persist middleware.
 * @param chatId  - The chat ID to restore.
 *
 * @example
 * ```ts
 * const saved = await restoreChat(storage, 'chat-1');
 * if (saved) {
 *   store.setMessages(saved.messages);
 * }
 * ```
 */
export async function restoreChat(
  storage: StorageAdapter,
  chatId: string,
): Promise<SerializedChat | null> {
  try {
    return await storage.get(chatId);
  } catch {
    return null;
  }
}

/**
 * List all persisted chat IDs from storage.
 *
 * @param storage - The StorageAdapter to query.
 */
export async function listChats(storage: StorageAdapter): Promise<string[]> {
  try {
    return await storage.list();
  } catch {
    return [];
  }
}

/**
 * Delete a persisted conversation from storage.
 *
 * @param storage - The StorageAdapter to delete from.
 * @param chatId  - The chat ID to remove.
 */
export async function deleteChat(storage: StorageAdapter, chatId: string): Promise<void> {
  try {
    await storage.delete(chatId);
  } catch {
    // Silently ignore
  }
}
