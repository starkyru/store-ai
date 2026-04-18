import { useState, useRef, useEffect } from 'react';
import { useAIText, useAIStatus, useAIMessages } from '@store-ai/react';
import { useStore } from 'zustand';
import type { Message } from '@store-ai/core';

import { aiStore, zustandStore } from './store';
import { createMockAnthropicStream, pickResponse } from './mock-stream';

// ---------------------------------------------------------------------------
// Shared submit logic
// ---------------------------------------------------------------------------

function sendMessage(text: string) {
  const response = pickResponse();
  const stream = createMockAnthropicStream(response);
  aiStore.submit({ message: text, stream });
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const text = msg.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: 12,
          background: isUser ? '#2563eb' : '#f1f5f9',
          color: isUser ? '#fff' : '#1e293b',
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: '#94a3b8',
    streaming: '#2563eb',
    complete: '#16a34a',
    error: '#dc2626',
    aborted: '#f59e0b',
    connecting: '#8b5cf6',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        color: '#fff',
        background: colors[status] ?? '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pattern 1: Direct React hooks (@store-ai/react)
// ---------------------------------------------------------------------------

function ChatDirect() {
  const messages = useAIMessages(aiStore);
  const status = useAIStatus(aiStore);
  const streamingText = useAIText(aiStore);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <strong>@store-ai/react hooks</strong>
        <StatusBadge status={status} />
      </div>

      <div ref={scrollRef} style={messageListStyle}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {status === 'streaming' && streamingText && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div
              style={{
                maxWidth: '80%',
                padding: '8px 12px',
                borderRadius: 12,
                background: '#f1f5f9',
                color: '#1e293b',
                fontSize: 14,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {streamingText}
              <span style={{ opacity: 0.5 }}>|</span>
            </div>
          </div>
        )}
        {messages.length === 0 && status === 'idle' && (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
            Send a message to get started
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pattern 2: Zustand bridge (@store-ai/zustand)
// ---------------------------------------------------------------------------

function ChatZustand() {
  const messages = useStore(zustandStore, (s) => s.messages);
  const status = useStore(zustandStore, (s) => s.status);
  const streamingText = useStore(zustandStore, (s) => s.text);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <strong>@store-ai/zustand bridge</strong>
        <StatusBadge status={status} />
      </div>

      <div ref={scrollRef} style={messageListStyle}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {status === 'streaming' && streamingText && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div
              style={{
                maxWidth: '80%',
                padding: '8px 12px',
                borderRadius: 12,
                background: '#f1f5f9',
                color: '#1e293b',
                fontSize: 14,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {streamingText}
              <span style={{ opacity: 0.5 }}>|</span>
            </div>
          </div>
        )}
        {messages.length === 0 && status === 'idle' && (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 40 }}>
            Send a message to get started
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input bar + App shell
// ---------------------------------------------------------------------------

function InputBar() {
  const [input, setInput] = useState('');
  const status = useAIStatus(aiStore);
  const isStreaming = status === 'streaming';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    sendMessage(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} style={inputBarStyle}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type a message..."
        disabled={isStreaming}
        style={inputStyle}
      />
      {isStreaming ? (
        <button type="button" onClick={() => aiStore.abort()} style={abortBtnStyle}>
          Abort
        </button>
      ) : (
        <button type="submit" disabled={!input.trim()} style={sendBtnStyle}>
          Send
        </button>
      )}
      <button
        type="button"
        onClick={() => aiStore.reset()}
        disabled={isStreaming}
        style={resetBtnStyle}
      >
        Reset
      </button>
    </form>
  );
}

export default function App() {
  return (
    <div style={appStyle}>
      <h1 style={{ margin: 0, fontSize: 20, color: '#1e293b' }}>
        store-ai: React + Zustand Example
      </h1>
      <p style={{ margin: '4px 0 16px', fontSize: 13, color: '#64748b' }}>
        Both panels share one AIStore. Left uses @store-ai/react hooks directly. Right uses the
        Zustand bridge via toZustand(). They stay perfectly in sync.
      </p>

      <div style={panelsContainerStyle}>
        <ChatDirect />
        <ChatZustand />
      </div>

      <InputBar />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const appStyle: React.CSSProperties = {
  maxWidth: 1000,
  margin: '0 auto',
  padding: 20,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
};

const panelsContainerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 16,
  flex: 1,
  minHeight: 0,
};

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  overflow: 'hidden',
  background: '#fff',
};

const panelHeaderStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid #e2e8f0',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 13,
  color: '#475569',
  background: '#f8fafc',
};

const messageListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 14,
  minHeight: 0,
};

const inputBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 16,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  fontSize: 14,
  outline: 'none',
};

const sendBtnStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 8,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

const abortBtnStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 8,
  border: 'none',
  background: '#dc2626',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

const resetBtnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#64748b',
  fontWeight: 500,
  fontSize: 14,
  cursor: 'pointer',
};
