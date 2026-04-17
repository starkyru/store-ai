import type { ReactiveController, ReactiveControllerHost } from '@lit/reactive-element';
import type { AIStore, AIFullState, DeepPartial } from '@store-ai/core';

/**
 * Lit ReactiveController that subscribes to an AIStore and triggers
 * host updates on state changes.
 *
 * Usage:
 * ```ts
 * class MyChatElement extends LitElement {
 *   private ai = new AIController(this, aiStore);
 *
 *   render() {
 *     return html`<p>${this.ai.text}</p>`;
 *   }
 * }
 * ```
 */
export class AIController<T = unknown> implements ReactiveController {
  private _state: AIFullState<T>;
  private _unsub: (() => void) | null = null;

  constructor(
    private host: ReactiveControllerHost,
    private store: AIStore<T>,
  ) {
    this._state = store.get();
    host.addController(this);
  }

  hostConnected(): void {
    this._state = this.store.get();
    this._unsub = this.store.subscribe((state) => {
      this._state = state;
      this.host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this._unsub?.();
    this._unsub = null;
  }

  get state(): AIFullState<T> {
    return this._state;
  }

  get text(): string {
    return this._state.text;
  }

  get status(): AIFullState<T>['status'] {
    return this._state.status;
  }

  get messages() {
    return this._state.messages;
  }

  get toolCalls() {
    return this._state.toolCalls;
  }

  get thinking(): string {
    return this._state.thinking;
  }

  get error(): Error | null {
    return this._state.error;
  }

  get isStreaming(): boolean {
    return this._state.isStreaming;
  }

  get partialObject(): DeepPartial<T> | null {
    return this._state.partialObject;
  }

  get object(): T | null {
    return this._state.object;
  }
}
