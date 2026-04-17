import type { AIState, MiddlewareContext, MiddlewareObject, StorageAdapter } from '../types.js';

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
