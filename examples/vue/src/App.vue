<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useAI } from '@store-ai/vue';
import { aiStore } from './store';
import { createMockAnthropicStream } from './mock-stream';

const { text, status, messages, isStreaming, error } = useAI(aiStore);

const input = ref('');
const messagesEl = ref<HTMLElement | null>(null);
const statusLog = ref<string[]>([]);

const MOCK_RESPONSES: Record<string, string> = {
  default:
    'This is a mock response from the store-ai Vue example. The Anthropic SSE stream is being simulated locally with token-by-token delivery. Each token arrives with a small delay to demonstrate real-time streaming through the Vue composable.',
  hello:
    'Hello! I am a mock assistant running inside a Vue 3 application powered by store-ai. The useAI composable provides reactive state that updates automatically as tokens stream in.',
  vue: 'Vue 3 with the Composition API pairs nicely with store-ai. The useAI() composable returns computed refs for text, status, messages, and more. Template bindings like {{ text }} update reactively as the stream progresses.',
};

function pickResponse(msg: string): string {
  const lower = msg.toLowerCase().trim();
  for (const [key, value] of Object.entries(MOCK_RESPONSES)) {
    if (key !== 'default' && lower.includes(key)) return value;
  }
  return MOCK_RESPONSES['default']!;
}

function handleSubmit() {
  const msg = input.value.trim();
  if (!msg || isStreaming.value) return;

  const stream = createMockAnthropicStream(pickResponse(msg));
  aiStore.submit({ message: msg, stream });
  input.value = '';
}

function handleAbort() {
  aiStore.abort();
}

function handleReset() {
  aiStore.reset();
  statusLog.value = [];
}

// Watch status changes and log them
watch(status, (newStatus, oldStatus) => {
  statusLog.value.push(`${oldStatus} -> ${newStatus}`);
});

// Auto-scroll message list when messages or text change
watch([messages, text], async () => {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
});
</script>

<template>
  <div class="app">
    <header>
      <h1>store-ai + Vue 3</h1>
      <div class="status-bar">
        Status: <strong>{{ status }}</strong>
        <span v-if="isStreaming" class="streaming-dot" />
      </div>
    </header>

    <div ref="messagesEl" class="messages">
      <div v-if="messages.length === 0" class="empty">
        Send a message to start. Try "hello" or "vue".
      </div>

      <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
        <div class="role">{{ msg.role }}</div>
        <div class="content">
          <template v-for="(part, i) in msg.content" :key="i">
            <span v-if="part.type === 'text'">{{ part.text }}</span>
          </template>
        </div>
      </div>

      <!-- Streaming text (not yet committed to messages) -->
      <div v-if="isStreaming && text" class="message assistant streaming">
        <div class="role">assistant</div>
        <div class="content">{{ text }}</div>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      {{ error.message }}
    </div>

    <form class="input-bar" @submit.prevent="handleSubmit">
      <input v-model="input" type="text" placeholder="Type a message..." :disabled="isStreaming" />
      <button type="submit" :disabled="isStreaming || !input.trim()">Send</button>
      <button v-if="isStreaming" type="button" class="abort" @click="handleAbort">Abort</button>
      <button type="button" class="reset" @click="handleReset">Reset</button>
    </form>

    <details class="status-log">
      <summary>Status transitions ({{ statusLog.length }})</summary>
      <ul>
        <li v-for="(entry, i) in statusLog" :key="i">{{ entry }}</li>
      </ul>
    </details>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
}

.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #ddd;
}

header h1 {
  font-size: 1.1rem;
  font-weight: 600;
}

.status-bar {
  font-size: 0.85rem;
  color: #666;
}

.streaming-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #22c55e;
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty {
  color: #999;
  text-align: center;
  margin-top: 2rem;
  font-size: 0.9rem;
}

.message {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  max-width: 85%;
}

.message.user {
  background: #e0e7ff;
  align-self: flex-end;
}

.message.assistant {
  background: #fff;
  border: 1px solid #e5e5e5;
  align-self: flex-start;
}

.message.streaming {
  border-color: #22c55e;
}

.role {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 2px;
}

.content {
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: pre-wrap;
}

.error-banner {
  background: #fef2f2;
  color: #b91c1c;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  margin: 0.5rem 0;
}

.input-bar {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid #ddd;
}

.input-bar input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
}

.input-bar input:disabled {
  background: #f3f3f3;
}

.input-bar button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  font-weight: 500;
}

.input-bar button[type='submit'] {
  background: #3b82f6;
  color: #fff;
}

.input-bar button[type='submit']:disabled {
  background: #93c5fd;
  cursor: default;
}

.input-bar button.abort {
  background: #ef4444;
  color: #fff;
}

.input-bar button.reset {
  background: #e5e5e5;
  color: #333;
}

.status-log {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  color: #666;
}

.status-log summary {
  cursor: pointer;
}

.status-log ul {
  list-style: none;
  padding: 0.25rem 0;
}

.status-log li {
  padding: 1px 0;
  font-family: monospace;
  font-size: 0.75rem;
}
</style>
