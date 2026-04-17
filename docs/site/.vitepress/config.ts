import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'store-ai',
  description: 'Framework-agnostic AI stream state management',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/core' },
      { text: 'Migration', link: '/migration/from-vercel-ai-sdk' },
    ],
    sidebar: {
      '/guide/': [
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Core Concepts', link: '/guide/core-concepts' },
        { text: 'Providers', link: '/guide/providers' },
        { text: 'Middleware', link: '/guide/middleware' },
        { text: 'Store Adapters', link: '/guide/store-adapters' },
        { text: 'Framework Adapters', link: '/guide/framework-adapters' },
        { text: 'Structured Output', link: '/guide/structured-output' },
        { text: 'Persistence', link: '/guide/persistence' },
        { text: 'Multi-Chat', link: '/guide/multi-chat' },
        { text: 'Resumable Streams', link: '/guide/resumable-streams' },
        { text: 'WebSocket Transport', link: '/guide/websocket-transport' },
        { text: 'Worker Offloading', link: '/guide/worker-offloading' },
        { text: 'Message Branching', link: '/guide/message-branching' },
        { text: 'Generative UI', link: '/guide/generative-ui' },
        { text: 'DevTools', link: '/guide/devtools' },
      ],
      '/api/': [
        { text: 'Core', link: '/api/core' },
        { text: 'Middleware', link: '/api/middleware' },
        { text: 'Providers', link: '/api/providers' },
        { text: 'Store Adapters', link: '/api/store-adapters' },
        { text: 'Framework Adapters', link: '/api/framework-adapters' },
      ],
      '/migration/': [
        {
          text: 'From Vercel AI SDK',
          link: '/migration/from-vercel-ai-sdk',
        },
        {
          text: 'From @ai-sdk-tools/store',
          link: '/migration/from-ai-sdk-tools',
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/example/store-ai' }],
  },
});
