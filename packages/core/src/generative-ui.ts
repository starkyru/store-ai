import type { ToolCallState } from './types.js';
import type { AIStore } from './store.js';

/** A rendered UI element descriptor. Framework adapters interpret this. */
export interface UIElement {
  /** Component identifier (matches the registered tool name, or a custom component key) */
  component: string;
  /** Props passed to the component */
  props: Record<string, unknown>;
  /** Whether the tool call is still in progress (partial input) */
  loading: boolean;
  /** The raw tool call state */
  toolCall: ToolCallState;
}

/** Function that renders a tool call into a UIElement */
export type ToolRenderer = (toolCall: ToolCallState) => UIElement;

export interface UIRegistry {
  /** Register a renderer for a tool name */
  register(toolName: string, renderer: ToolRenderer): void;

  /** Unregister a renderer */
  unregister(toolName: string): void;

  /** Check if a tool has a registered renderer */
  has(toolName: string): boolean;

  /** Render a tool call. Returns UIElement if registered, null if not. */
  render(toolCall: ToolCallState): UIElement | null;

  /** Render all tool calls from a list. Skips unregistered tools (unless fallback is set). */
  renderAll(toolCalls: ToolCallState[]): UIElement[];

  /** Set a fallback renderer for unregistered tools */
  setFallback(renderer: ToolRenderer | null): void;

  /** List all registered tool names */
  list(): string[];
}

export function createUIRegistry(): UIRegistry {
  const renderers = new Map<string, ToolRenderer>();
  let fallback: ToolRenderer | null = null;

  function resolve(toolName: string): ToolRenderer | null {
    return renderers.get(toolName) ?? fallback;
  }

  return {
    register(toolName: string, renderer: ToolRenderer): void {
      renderers.set(toolName, renderer);
    },

    unregister(toolName: string): void {
      renderers.delete(toolName);
    },

    has(toolName: string): boolean {
      return renderers.has(toolName);
    },

    render(toolCall: ToolCallState): UIElement | null {
      const renderer = resolve(toolCall.name);
      if (!renderer) return null;
      return renderer(toolCall);
    },

    renderAll(toolCalls: ToolCallState[]): UIElement[] {
      const elements: UIElement[] = [];
      for (const tc of toolCalls) {
        const renderer = resolve(tc.name);
        if (renderer) {
          elements.push(renderer(tc));
        }
      }
      return elements;
    },

    setFallback(renderer: ToolRenderer | null): void {
      fallback = renderer;
    },

    list(): string[] {
      return Array.from(renderers.keys());
    },
  };
}

/**
 * Subscribes to an AIStore's tool calls and produces UIElements reactively.
 * Returns a function to get current UIElements and an unsubscribe function.
 */
export function connectUI(
  store: AIStore,
  registry: UIRegistry,
): { getElements: () => UIElement[]; destroy: () => void } {
  let cached: UIElement[] = registry.renderAll(store.get('toolCalls'));

  const unsubscribe = store.subscribe('toolCalls', (toolCalls: ToolCallState[]) => {
    cached = registry.renderAll(toolCalls);
  });

  return {
    getElements: () => cached,
    destroy: unsubscribe,
  };
}
