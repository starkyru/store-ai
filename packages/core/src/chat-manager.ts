import type { AIStore } from './store.js';
import type { AIStoreOptions, ChatInfo, AIStatus } from './types.js';
import { createAIStore } from './store.js';

export interface ChatManagerOptions {
  /** Default options applied to every new chat's AIStore. */
  defaults?: Omit<AIStoreOptions, 'initialMessages'>;
  /** Maximum number of concurrent chats. Oldest inactive chat is destroyed when exceeded. */
  maxChats?: number;
}

export interface ChatManager {
  /** Create a new chat. Returns its AIStore. */
  create(id?: string, opts?: Partial<AIStoreOptions>): AIStore;
  /** Get an existing chat by ID. */
  get(id: string): AIStore | undefined;
  /** Delete a chat and destroy its store. */
  delete(id: string): void;
  /** List all chats with summary info. */
  list(): ChatInfo[];

  /** The active chat ID, or null if none. */
  readonly activeId: string | null;
  /** The active chat's AIStore, or null. */
  readonly active: AIStore | null;
  /** Switch the active chat. */
  setActive(id: string): void;

  /** Subscribe to changes in the chat list (create/delete/active change/status changes). */
  subscribe(listener: (chats: ChatInfo[]) => void): () => void;

  /** Destroy all chats and clean up. */
  destroy(): void;
}

function buildChatInfo(id: string, store: AIStore): ChatInfo {
  const state = store.get();
  const messages = state.messages;

  let title: string | null = null;
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (firstUserMessage) {
    const textPart = firstUserMessage.content.find((c) => c.type === 'text');
    if (textPart && textPart.type === 'text') {
      const raw = textPart.text;
      title = raw.length > 50 ? raw.slice(0, 50) : raw;
    }
  }

  let lastMessageAt: Date | null = null;
  if (messages.length > 0) {
    lastMessageAt = messages[messages.length - 1]!.createdAt;
  }

  return {
    id,
    title,
    lastMessageAt,
    messageCount: messages.length,
    status: state.status as AIStatus,
  };
}

export function createChatManager(options?: ChatManagerOptions): ChatManager {
  const stores = new Map<string, AIStore>();
  const storeUnsubs = new Map<string, () => void>();
  const creationOrder: string[] = [];
  const listeners = new Set<(chats: ChatInfo[]) => void>();

  let activeId: string | null = null;
  let destroyed = false;

  const defaults = options?.defaults;
  const maxChats = options?.maxChats;

  function assertNotDestroyed(): void {
    if (destroyed) {
      throw new Error('ChatManager has been destroyed');
    }
  }

  function notifyListeners(): void {
    if (destroyed) return;
    const chats = buildList();
    for (const listener of listeners) {
      listener(chats);
    }
  }

  function buildList(): ChatInfo[] {
    const result: ChatInfo[] = [];
    for (const [id, store] of stores) {
      result.push(buildChatInfo(id, store));
    }
    return result;
  }

  function enforceMaxChats(): void {
    if (maxChats == null) return;

    // Loop until within limit (handles bulk-create scenarios)
    while (stores.size > maxChats) {
      let evicted = false;
      // Find oldest non-active, non-streaming chat to evict
      for (const id of creationOrder) {
        if (id === activeId) continue;
        const store = stores.get(id);
        if (!store) continue;
        const state = store.get();
        if (state.status === 'streaming' || state.status === 'connecting') continue;

        // Evict this chat
        removeChat(id);
        evicted = true;
        break;
      }
      // If nothing could be evicted (all active or streaming), stop
      if (!evicted) break;
    }
  }

  function removeChat(id: string): void {
    const store = stores.get(id);
    if (!store) return;

    const unsub = storeUnsubs.get(id);
    if (unsub) unsub();
    storeUnsubs.delete(id);

    store.destroy();
    stores.delete(id);

    const orderIdx = creationOrder.indexOf(id);
    if (orderIdx !== -1) creationOrder.splice(orderIdx, 1);

    if (activeId === id) {
      activeId = null;
    }
  }

  const manager: ChatManager = {
    create(id?: string, opts?: Partial<AIStoreOptions>): AIStore {
      assertNotDestroyed();

      const chatId = id ?? crypto.randomUUID();

      // If a chat with this ID already exists, destroy it first to prevent leaks
      if (stores.has(chatId)) {
        removeChat(chatId);
      }

      const mergedOpts: AIStoreOptions = {
        ...defaults,
        ...opts,
        middleware: [...(defaults?.middleware ?? []), ...(opts?.middleware ?? [])],
      };

      const store = createAIStore(mergedOpts);
      stores.set(chatId, store);
      creationOrder.push(chatId);

      // Subscribe to store state changes to track status updates
      const unsub = store.subscribe(() => {
        notifyListeners();
      });
      storeUnsubs.set(chatId, unsub);

      enforceMaxChats();
      notifyListeners();

      return store;
    },

    get(id: string): AIStore | undefined {
      return stores.get(id);
    },

    delete(id: string): void {
      assertNotDestroyed();
      if (!stores.has(id)) return;
      removeChat(id);
      notifyListeners();
    },

    list(): ChatInfo[] {
      return buildList();
    },

    get activeId(): string | null {
      return activeId;
    },

    get active(): AIStore | null {
      if (activeId == null) return null;
      return stores.get(activeId) ?? null;
    },

    setActive(id: string): void {
      assertNotDestroyed();
      if (!stores.has(id)) {
        throw new Error(`Chat "${id}" does not exist`);
      }
      activeId = id;
      notifyListeners();
    },

    subscribe(listener: (chats: ChatInfo[]) => void): () => void {
      assertNotDestroyed();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      // Snapshot IDs to avoid mutating the map during iteration
      const ids = [...stores.keys()];
      for (const id of ids) {
        removeChat(id);
      }
      stores.clear();
      storeUnsubs.clear();
      creationOrder.length = 0;
      listeners.clear();
      activeId = null;
    },
  };

  return manager;
}
