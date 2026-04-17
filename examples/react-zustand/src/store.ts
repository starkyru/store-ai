import { createAIStore, anthropic, logging } from '@store-ai/core';
import { toZustand } from '@store-ai/zustand';

export const aiStore = createAIStore({
  provider: anthropic(),
  middleware: [logging({ level: 'debug' })],
});

export const { store: zustandStore } = toZustand(aiStore);
