import type { AppClientSocket } from '../../src/net/createSocket';

type Listener = (...args: never[]) => void;
type AckCallback = (...args: unknown[]) => void;

export interface EmittedCommand {
  event: string;
  args: unknown[];
  /** Ответить на ack (как сервер). */
  respond(...args: unknown[]): void;
}

/**
 * Минимальная подмена socket.io-client Socket: только то, чем пользуется RoomSession.
 * Методы server* имитируют действия сервера; timeout(ms).emit ведёт себя как в socket.io —
 * по истечении времени вызывает callback с ошибкой, а поздний ответ игнорирует.
 */
export class FakeSocket {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly emitted: EmittedCommand[] = [];
  /** Какие события были подписаны на момент вызова connect(). */
  listenersAtConnect: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapper = ((...args: never[]) => {
      this.listeners.get(event)?.delete(wrapper);
      listener(...args);
    }) as Listener;
    return this.on(event, wrapper);
  }

  connect(): this {
    this.connectCalls += 1;
    this.listenersAtConnect = [...this.listeners.keys()].filter(
      (event) => (this.listeners.get(event)?.size ?? 0) > 0,
    );
    return this;
  }

  disconnect(): this {
    this.disconnectCalls += 1;
    if (this.connected) {
      this.connected = false;
      this.fire('disconnect', 'io client disconnect');
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.record(event, args, undefined);
    return this;
  }

  timeout(ms: number): { emit: (event: string, ...args: unknown[]) => void } {
    return {
      emit: (event, ...args) => this.record(event, args, ms),
    };
  }

  // ── действия «сервера» ─────────────────────────────────────────────────────
  serverConnect(): void {
    this.connected = true;
    this.fire('connect');
  }

  serverConnectError(): void {
    this.fire('connect_error', new Error('xhr poll error'));
  }

  serverDisconnect(reason = 'transport close'): void {
    this.connected = false;
    this.fire('disconnect', reason);
  }

  serverEmit(event: string, payload: unknown): void {
    this.fire(event, payload);
  }

  lastEmitted(event: string): EmittedCommand {
    const command = this.emitted.filter((c) => c.event === event).at(-1);
    if (!command) throw new Error(`"${event}" was not emitted`);
    return command;
  }

  asSocket(): AppClientSocket {
    return this as unknown as AppClientSocket;
  }

  private record(event: string, rawArgs: unknown[], timeoutMs: number | undefined): void {
    const last = rawArgs.at(-1);
    const callback = typeof last === 'function' ? (last as AckCallback) : undefined;
    const args = callback ? rawArgs.slice(0, -1) : rawArgs;
    let settled = false;

    const settle = (...response: unknown[]) => {
      if (settled || !callback) return;
      settled = true;
      callback(...response);
    };

    if (timeoutMs !== undefined) {
      setTimeout(() => settle(new Error('operation has timed out')), timeoutMs);
    }

    this.emitted.push({
      event,
      args,
      // С timeout() первый аргумент callback — ошибка (null при успехе).
      respond: (...response) =>
        settle(...(timeoutMs === undefined ? response : [null, ...response])),
    });
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }
}
