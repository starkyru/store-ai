import { createAIStore, anthropic, logging } from '@store-ai/core';
import { toZustand } from '@store-ai/zustand';
import { createMockAnthropicStream } from './mock-stream';

// ── Create stores ──

const aiStore = createAIStore({
  provider: anthropic(),
  middleware: [logging({ level: 'debug' })],
  batchStrategy: 'raf', // batch DOM updates per animation frame
});

const { store: zStore } = toZustand(aiStore);

// ── DOM references ──

const statusEl = document.getElementById('status')!;
const messagesEl = document.getElementById('messages')!;
const streamingEl = document.getElementById('streaming')!;
const form = document.getElementById('chat-form') as HTMLFormElement;
const input = document.getElementById('input') as HTMLInputElement;
const abortBtn = document.getElementById('abort-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

// ── Canned responses for the mock stream ──

const responses = [
  'The key to understanding quantum computing lies in superposition and entanglement. Unlike classical bits that must be 0 or 1, qubits can exist in a probability distribution across both states simultaneously.',
  'Machine learning models work by finding patterns in data through iterative optimization. Each training step adjusts model weights to minimize a loss function, gradually improving predictions.',
  "Rust's ownership model prevents memory bugs at compile time. Every value has exactly one owner, and when ownership is transferred (moved), the previous binding becomes invalid.",
  'WebAssembly enables near-native performance in the browser. Code compiled to Wasm runs in a sandboxed virtual machine, making it safe while being significantly faster than JavaScript for compute-heavy tasks.',
  'Event-driven architectures decouple producers from consumers. When a service emits an event, it does not need to know who listens. This enables independent scaling and deployment of each component.',
];

// ── Render helpers ──

function renderMessages(messages: ReturnType<typeof zStore.getState>['messages']): void {
  // Only rebuild if the count changed (simple heuristic to avoid full rerenders)
  if (messagesEl.childElementCount === messages.length) return;

  messagesEl.innerHTML = '';
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = `message message-${msg.role}`;

    const textParts = msg.content
      .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
      .map((c) => c.text);

    div.textContent = `${msg.role}: ${textParts.join('')}`;
    messagesEl.appendChild(div);
  }
}

function renderStatus(status: string): void {
  statusEl.textContent = status;
  statusEl.className = `status-${status}`;
}

function renderStreaming(status: string, text: string): void {
  if (status === 'streaming' && text) {
    streamingEl.textContent = text;
    streamingEl.style.display = 'block';
  } else {
    streamingEl.style.display = 'none';
  }
}

// ── Subscribe to zustand store ──

zStore.subscribe((state) => {
  renderStatus(state.status);
  renderStreaming(state.status, state.text);
  renderMessages(state.messages);
  abortBtn.disabled = state.status !== 'streaming';
});

// ── Event handlers ──

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const response = responses[Math.floor(Math.random() * responses.length)]!;
  const stream = createMockAnthropicStream(response, 30);

  aiStore.submit({ message: text, stream });
});

abortBtn.addEventListener('click', () => {
  aiStore.abort();
});

resetBtn.addEventListener('click', () => {
  aiStore.reset();
  // Clear DOM immediately after reset
  messagesEl.innerHTML = '';
  streamingEl.style.display = 'none';
});
