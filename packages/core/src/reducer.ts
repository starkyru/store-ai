import type { AIState, StoreAction, ToolCallState } from './types.js';

const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizePartial(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePartial);
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (PROTO_KEYS.has(key)) continue;
    clean[key] = sanitizePartial((obj as Record<string, unknown>)[key]);
  }
  return clean;
}

export function getInitialState<T = unknown>(): AIState<T> {
  return {
    status: 'idle',
    error: null,
    text: '',
    textDelta: '',
    messages: [],
    lastMessage: null,
    partialObject: null,
    object: null,
    toolCalls: [],
    thinking: '',
    thinkingDelta: '',
    usage: null,
    latency: null,
    model: null,
    provider: null,
  };
}

export function aiReducer<T>(state: AIState<T>, action: StoreAction): AIState<T> {
  switch (action.type) {
    case 'stream/start': {
      const now = Date.now();
      return {
        ...state,
        status: 'streaming',
        error: null,
        text: '',
        textDelta: '',
        thinking: '',
        thinkingDelta: '',
        partialObject: null,
        object: null,
        toolCalls: [],
        model: action.meta?.model ?? state.model,
        provider: action.meta?.provider ?? state.provider,
        latency: {
          startMs: now,
          firstTokenMs: null,
          endMs: null,
          ttft: null,
          totalMs: null,
        },
      };
    }

    case 'stream/text-delta': {
      const latency = state.latency
        ? {
            ...state.latency,
            firstTokenMs: state.latency.firstTokenMs ?? Date.now(),
            ttft: state.latency.ttft ?? Date.now() - state.latency.startMs,
          }
        : null;

      return {
        ...state,
        text: state.text + action.delta,
        textDelta: action.delta,
        latency,
      };
    }

    case 'stream/thinking-delta': {
      return {
        ...state,
        thinking: state.thinking + action.delta,
        thinkingDelta: action.delta,
      };
    }

    case 'stream/tool-call-start': {
      const newToolCall: ToolCallState = {
        id: action.id,
        name: action.name,
        status: 'pending',
        input: undefined,
        inputText: '',
        output: null,
        error: null,
        startedAt: new Date(),
        completedAt: null,
      };
      return {
        ...state,
        toolCalls: [...state.toolCalls, newToolCall],
      };
    }

    case 'stream/tool-call-delta': {
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.id === action.toolCallId
            ? { ...tc, status: 'partial' as const, inputText: tc.inputText + action.inputDelta }
            : tc,
        ),
      };
    }

    case 'stream/tool-call-complete': {
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.id === action.toolCallId
            ? { ...tc, status: 'complete' as const, input: action.input, completedAt: new Date() }
            : tc,
        ),
      };
    }

    case 'stream/object-delta': {
      return {
        ...state,
        partialObject: sanitizePartial(action.partial) as AIState<T>['partialObject'],
      };
    }

    case 'stream/usage': {
      return {
        ...state,
        usage: action.usage,
      };
    }

    case 'stream/complete': {
      const now = Date.now();
      const latency = state.latency
        ? {
            ...state.latency,
            endMs: now,
            totalMs: now - state.latency.startMs,
          }
        : null;

      // Build final assistant message from accumulated text + tool calls
      const contentParts: AIState<T>['messages'][number]['content'] = [];
      if (state.thinking) {
        contentParts.push({ type: 'thinking', text: state.thinking });
      }
      if (state.text) {
        contentParts.push({
          type: 'text',
          text: state.text + (action.type === 'stream/complete' ? '' : ''),
        });
      }
      for (const tc of state.toolCalls) {
        contentParts.push({ type: 'tool-call', toolCall: tc });
      }

      const assistantMessage: AIState<T>['messages'][number] = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: contentParts,
        createdAt: new Date(),
      };

      const messages = [...state.messages, assistantMessage];

      return {
        ...state,
        status: 'complete',
        messages,
        lastMessage: assistantMessage,
        usage: action.usage ?? state.usage,
        latency,
        // Promote partial to final if we had structured output
        object: (state.partialObject ?? null) as AIState<T>['object'],
      };
    }

    case 'stream/error': {
      const now = Date.now();
      return {
        ...state,
        status: 'error',
        error: action.error,
        latency: state.latency
          ? { ...state.latency, endMs: now, totalMs: now - state.latency.startMs }
          : null,
      };
    }

    case 'stream/abort': {
      const now = Date.now();
      return {
        ...state,
        status: 'aborted',
        latency: state.latency
          ? { ...state.latency, endMs: now, totalMs: now - state.latency.startMs }
          : null,
      };
    }

    case 'messages/set': {
      return {
        ...state,
        messages: action.messages,
        lastMessage: action.messages[action.messages.length - 1] ?? null,
      };
    }

    case 'messages/append': {
      const messages = [...state.messages, action.message];
      return {
        ...state,
        messages,
        lastMessage: action.message,
      };
    }

    case 'tool/result': {
      return {
        ...state,
        toolCalls: state.toolCalls.map((tc) =>
          tc.id === action.toolCallId ? { ...tc, output: action.result } : tc,
        ),
      };
    }

    case 'reset': {
      return getInitialState<T>();
    }

    default:
      return state;
  }
}
