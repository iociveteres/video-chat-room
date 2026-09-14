import { vi } from 'vitest';
import { MediaController, type TrackKind } from '../../src/media/MediaController';
import type { MediaCallbacks } from '../../src/session/RoomSession';

let trackSeq = 0;

/** Минимальная подмена MediaStreamTrack: stop() переводит в ended без события, как в браузере. */
export class FakeTrack extends EventTarget {
  readonly id = `track-${++trackSeq}`;
  enabled = true;
  readyState: MediaStreamTrackState = 'live';
  readonly stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  /** Клоны запрещены инвариантом controller'а: тесты проверяют, что вызовов нет. */
  readonly clone = vi.fn(() => new FakeTrack(this.kind));

  constructor(readonly kind: TrackKind) {
    super();
  }

  /** Внешняя причина завершения: устройство отключили или отозвали разрешение. */
  dispatchEnded(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeMediaStream {
  private readonly tracks = new Set<FakeTrack>();

  constructor(tracks: FakeTrack[] = []) {
    for (const track of tracks) this.tracks.add(track);
  }

  addTrack(track: FakeTrack): void {
    this.tracks.add(track);
  }

  removeTrack(track: FakeTrack): void {
    this.tracks.delete(track);
  }

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): FakeTrack[] {
    return this.getTracks().filter((t) => t.kind === 'audio');
  }

  getVideoTracks(): FakeTrack[] {
    return this.getTracks().filter((t) => t.kind === 'video');
  }
}

export function domError(name: string): DOMException {
  return new DOMException(`${name} (fake)`, name);
}

/** Ответ на один вызов getUserMedia: выдать треки, отклонить или ждать ручного решения. */
export type GumResponder = (constraints: MediaStreamConstraints) => Promise<FakeMediaStream>;

export interface PendingGum {
  constraints: MediaStreamConstraints;
  grant(): void;
  reject(name: string): void;
}

/**
 * Программируемый navigator.mediaDevices. По умолчанию выдаёт трек на каждый запрошенный kind.
 * Ответы задаются правилами: первое подходящее по constraints правило определяет результат.
 */
export class FakeMediaDevices {
  inputs: MediaDeviceKind[] = ['audioinput', 'videoinput'];
  /** Все созданные треки — для проверки, что ни один не остался live. */
  readonly createdTracks: FakeTrack[] = [];
  readonly pending: PendingGum[] = [];
  private readonly rules: {
    matches: (c: MediaStreamConstraints) => boolean;
    respond: GumResponder;
    once: boolean;
  }[] = [];

  readonly getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
    const index = this.rules.findIndex((rule) => rule.matches(constraints));
    const rule = this.rules[index];
    if (!rule) return Promise.resolve(this.grant(constraints));
    if (rule.once) this.rules.splice(index, 1);
    return rule.respond(constraints);
  });

  readonly enumerateDevices = vi.fn(() =>
    Promise.resolve(
      this.inputs.map((kind, i) => ({ kind, deviceId: `d${i}`, groupId: '', label: '' })),
    ),
  );

  /** Отклонять запросы, в которых есть kind (или любые, если kind не задан). */
  rejectWith(name: string, opts: { kind?: TrackKind; once?: boolean } = {}): this {
    this.rules.push({
      matches: (c) => !opts.kind || Boolean(c[opts.kind]),
      respond: () => Promise.reject(domError(name)),
      once: opts.once ?? false,
    });
    return this;
  }

  /** Отклонять запросы, где kind запрошен с ограничениями (объектом, а не true). */
  rejectConstrained(name: string, kind: TrackKind): this {
    this.rules.push({
      matches: (c) => typeof c[kind] === 'object',
      respond: () => Promise.reject(domError(name)),
      once: false,
    });
    return this;
  }

  /** Следующий подходящий запрос повиснет до ручного grant()/reject(). */
  deferNext(): this {
    this.rules.push({
      matches: () => true,
      respond: (constraints) =>
        new Promise((resolve, reject) => {
          this.pending.push({
            constraints,
            grant: () => resolve(this.grant(constraints)),
            reject: (name) => reject(domError(name)),
          });
        }),
      once: true,
    });
    return this;
  }

  /** Все запросы в порядке вызова. */
  get requests(): MediaStreamConstraints[] {
    return this.getUserMedia.mock.calls.map(([c]) => c);
  }

  private grant(constraints: MediaStreamConstraints): FakeMediaStream {
    const tracks = (['audio', 'video'] as const)
      .filter((kind) => Boolean(constraints[kind]))
      .map((kind) => new FakeTrack(kind));
    this.createdTracks.push(...tracks);
    return new FakeMediaStream(tracks);
  }
}

export class FakePermissions {
  states: Partial<Record<PermissionName, PermissionState>> = {};
  /** Имена, на которые query бросает TypeError, как Firefox на camera/microphone. */
  unsupported = new Set<PermissionName>();

  readonly query = vi.fn(({ name }: PermissionDescriptor) => {
    if (this.unsupported.has(name)) {
      return Promise.reject(new TypeError(`'${name}' is not a valid PermissionName`));
    }
    return Promise.resolve({ state: this.states[name] ?? 'prompt' } as PermissionStatus);
  });
}

/**
 * Фабрика MediaController для RoomSession на фейковых устройствах (в jsdom нет MediaStream
 * и navigator.mediaDevices). По умолчанию обе устройства есть и доступ выдаётся.
 */
export function fakeMedia(devices = new FakeMediaDevices(), permissions?: FakePermissions) {
  let controller: MediaController | undefined;
  const createMedia = (callbacks: MediaCallbacks) =>
    (controller = new MediaController({
      mediaDevices: devices as unknown as MediaDevices,
      permissions,
      createStream: () => new FakeMediaStream() as unknown as MediaStream,
      ...callbacks,
    }));
  return {
    devices,
    createMedia,
    get controller(): MediaController {
      if (!controller) throw new Error('MediaController was not created');
      return controller;
    },
  };
}

/**
 * Досчитывает цепочки промисов фейковых устройств. Не зависит от таймеров, поэтому работает и
 * с vi.useFakeTimers(): vi.waitFor при фейковых таймерах сдвигал бы время.
 */
export async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
