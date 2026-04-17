import { createAIStore, anthropic, logging } from '@store-ai/core';

export const aiStore = createAIStore({
  provider: anthropic(),
  middleware: [logging({ level: 'debug' })],
});
