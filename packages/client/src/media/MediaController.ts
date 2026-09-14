import { AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS, type MediaState } from '@vcr/shared';
import { acquireNotice, deviceStatusLabel, lostNotice } from './mediaTexts';

export type TrackKind = 'audio' | 'video';

export type DeviceStatus =
  | 'acquiring' // идёт getUserMedia
  | 'on' // трек есть и передаётся
  | 'off' // выключено пользователем
  | 'denied' // NotAllowedError / SecurityError
  | 'not-found' // устройства нет (NotFoundError или нет в enumerateDevices)
  | 'busy' // NotReadableError / AbortError — занято другим приложением или ОС
  | 'lost' // трек завершился сам (ended): устройство отключили или отозвали доступ
  | 'failed'; // прочие ошибки

export interface LocalTracks {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
}

/** Подписчик может вернуть Promise — controller дождётся его перед stop(). */
export type TrackChangeListener = (
  kind: TrackKind,
  track: MediaStreamTrack | null,
) => void | Promise<void>;

export interface MediaControllerDeps {
  mediaDevices: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;
  /** navigator.permissions, если есть. */
  permissions?: Pick<Permissions, 'query'>;
  onStatus: (kind: TrackKind, status: DeviceStatus) => void;
  onNotice: (text: string, tone: 'info' | 'error') => void;
  /** Фабрика previewStream; подменяется в тестах (в jsdom нет MediaStream). */
  createStream?: () => MediaStream;
}

const KINDS: readonly TrackKind[] = ['audio', 'video'];

const PERMISSION_NAMES: Record<TrackKind, PermissionName> = {
  audio: 'microphone',
  video: 'camera',
};

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) return undefined;
  return typeof error.name === 'string' ? error.name : undefined;
}

function isOverconstrained(error: unknown): boolean {
  return errorName(error) === 'OverconstrainedError';
}

/**
 * Классификация ошибок getUserMedia (TDD этапа 3 §4.3). OverconstrainedError сюда попадает,
 * только если повтор без ограничений тоже не удался, — тогда это failed.
 */
export function classify(error: unknown): DeviceStatus {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'not-found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
}

/** Ошибки общего запроса, после которых имеет смысл спросить устройства по одному. */
function shouldRetryPerDevice(error: unknown): boolean {
  const status = classify(error);
  return status === 'busy' || status === 'not-found' || isOverconstrained(error);
}

function constraintsFor(kind: TrackKind, unconstrained: boolean): MediaStreamConstraints {
  if (unconstrained) return { [kind]: true };
  return kind === 'audio' ? { audio: AUDIO_CONSTRAINTS } : { video: VIDEO_CONSTRAINTS };
}

/**
 * Владелец локальных MediaStreamTrack; вне React, чтобы треки не попадали в state.
 *
 * Инвариант: у каждого kind не больше одного живого трека, и все потребители держат
 * именно его — никаких clone(), иначе лампочка камеры не погаснет (TDD этапа 3 §1.3).
 */
export class MediaController {
  /** Стабильный MediaStream для self-view; содержит только текущий видеотрек. */
  readonly previewStream: MediaStream;

  private readonly md: MediaControllerDeps['mediaDevices'];
  private readonly permissions: MediaControllerDeps['permissions'];
  private readonly onStatus: MediaControllerDeps['onStatus'];
  private readonly onNotice: MediaControllerDeps['onNotice'];

  private readonly tracks: LocalTracks = { audio: null, video: null };
  private readonly statuses: Record<TrackKind, DeviceStatus> = { audio: 'off', video: 'off' };
  /** Последовательная очередь публичных async-операций: без параллельных getUserMedia. */
  private chain: Promise<void> = Promise.resolve();
  /**
   * Поколение: stopAll() увеличивает его, и результат операции, начатой раньше, отбрасывается,
   * а пришедшие поздно треки сразу останавливаются. Счётчик вместо флага disposed оставляет
   * controller пригодным для повторного входа («Повторить вход» после ROOM_FULL).
   */
  private generation = 0;
  private readonly listeners = new Set<TrackChangeListener>();

  constructor(deps: MediaControllerDeps) {
    this.md = deps.mediaDevices;
    this.permissions = deps.permissions;
    this.onStatus = deps.onStatus;
    this.onNotice = deps.onNotice;
    this.previewStream = deps.createStream?.() ?? new MediaStream();
  }

  getTracks(): LocalTracks {
    return { ...this.tracks };
  }

  getPublicState(): MediaState {
    return { audio: this.statuses.audio === 'on', video: this.statuses.video === 'on' };
  }

  /**
   * Захват при входе: enumerateDevices → общий getUserMedia только для имеющихся устройств →
   * при ошибке уточнение по Permissions API или поштучный повтор → сводный notice.
   */
  acquireInitial(): Promise<void> {
    return this.enqueue(async () => {
      const generation = this.generation;
      for (const kind of KINDS) this.setStatus(kind, 'acquiring');

      const available = await this.detectDevices();
      if (generation !== this.generation) return;

      const result: Record<TrackKind, DeviceStatus> = { audio: 'not-found', video: 'not-found' };
      const wanted = KINDS.filter((kind) => available[kind]);
      if (wanted.length > 0) {
        const statuses = await this.acquireKinds(wanted, generation);
        if (!statuses) return;
        Object.assign(result, statuses);
      }

      for (const kind of KINDS) this.setStatus(kind, result[kind]);
      const notice = acquireNotice(result);
      if (notice) this.onNotice(notice.text, notice.tone);
    });
  }

  /**
   * Микрофон: on ↔ off через track.enabled — мгновенно и без повторного запроса разрешения.
   * Из статусов ошибок включение — новый getUserMedia и trackChange.
   */
  setAudioEnabled(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const track = this.tracks.audio;
      if (track) {
        track.enabled = enabled;
        this.setStatus('audio', enabled ? 'on' : 'off');
        return;
      }
      if (enabled) await this.enableTrack('audio');
      else this.setStatus('audio', 'off');
    });
  }

  /** Камера: выключение — stop() (лампочка гаснет, FR-19), включение — новый getUserMedia. */
  setVideoEnabled(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!enabled) return this.disableVideo();
      // Повторный клик после успешного включения не должен захватывать камеру ещё раз.
      if (this.tracks.video) return;
      await this.enableTrack('video');
    });
  }

  /**
   * Подписка на смену трека (этап 4: sender.replaceTrack). Controller дожидается всех
   * подписчиков, прежде чем остановить старый трек. Возвращает отписку.
   */
  onTrackChange(listener: TrackChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Синхронно освобождает устройства; операции, начатые до вызова, свой результат отбросят. */
  stopAll(): void {
    this.generation += 1;
    // Новые операции не ждут прежние: пользователь может так и не ответить на запрос разрешения,
    // и getUserMedia провисит вечно. Прежние операции доработают сами и отбросят результат.
    this.chain = Promise.resolve();
    for (const kind of KINDS) {
      this.releaseTrack(kind);
      this.setStatus(kind, 'off');
    }
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    // Операция, поставленная до stopAll(), но не успевшая начаться, не выполняется вовсе.
    const generation = this.generation;
    const run = this.chain.then(() => (generation === this.generation ? op() : undefined));
    // Ошибка одной операции не должна останавливать очередь.
    this.chain = run.catch((err: unknown) => {
      console.warn('MediaController operation failed', err);
    });
    return this.chain;
  }

  private setStatus(kind: TrackKind, status: DeviceStatus): void {
    if (this.statuses[kind] === status) return;
    this.statuses[kind] = status;
    this.onStatus(kind, status);
  }

  /**
   * Порядок важен: сначала все отправители отцепляют трек (replaceTrack(null)), и только потом
   * stop(). Иначе при повторном включении пришлось бы ренеготировать соединения (TDD §4.3).
   */
  private async disableVideo(): Promise<void> {
    const track = this.tracks.video;
    if (!track) return this.setStatus('video', 'off');
    const generation = this.generation;
    this.tracks.video = null;
    track.removeEventListener('ended', this.onTrackEnded);
    await this.emitTrackChange('video', null);
    this.previewStream.removeTrack(track);
    track.stop();
    // После stopAll() статусом уже владеют новые операции.
    if (generation === this.generation) this.setStatus('video', 'off');
  }

  private async enableTrack(kind: TrackKind): Promise<void> {
    const generation = this.generation;
    this.setStatus(kind, 'acquiring');
    const status = await this.acquireOne(kind, generation, false);
    if (!status) return;
    const track = this.tracks[kind];
    if (status !== 'on' || !track) {
      this.setStatus(kind, status);
      this.onNotice(deviceStatusLabel(kind, status), 'error');
      return;
    }
    await this.emitTrackChange(kind, track);
    // За время ожидания подписчиков трек могли остановить (stopAll) или он завершился сам.
    if (generation !== this.generation || this.tracks[kind] !== track) return;
    this.setStatus(kind, 'on');
  }

  /** Трек завершился не по нашему stop(): устройство отключили или отозвали доступ (FR-20). */
  private readonly onTrackEnded = (event: Event): void => {
    const track = event.target as MediaStreamTrack;
    const kind = track.kind as TrackKind;
    if (this.tracks[kind] !== track) return; // устаревший трек
    void this.enqueue(async () => {
      if (this.tracks[kind] !== track) return; // выключили раньше, чем дошла очередь
      const generation = this.generation;
      this.tracks[kind] = null;
      track.removeEventListener('ended', this.onTrackEnded);
      await this.emitTrackChange(kind, null);
      if (kind === 'video') this.previewStream.removeTrack(track);
      track.stop();
      if (generation !== this.generation) return;
      this.setStatus(kind, 'lost');
      this.onNotice(lostNotice(kind), 'error');
    });
  };

  /** Ошибка подписчика не мешает освободить устройство: приоритет — погасить камеру. */
  private async emitTrackChange(kind: TrackKind, track: MediaStreamTrack | null): Promise<void> {
    const results = await Promise.allSettled(
      [...this.listeners].map(async (listener) => listener(kind, track)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(`Track change listener failed (${kind})`, result.reason);
      }
    }
  }

  /** До выдачи разрешения label пустые, но kind виден — этого достаточно. */
  private async detectDevices(): Promise<Record<TrackKind, boolean>> {
    try {
      const devices = await this.md.enumerateDevices();
      return {
        audio: devices.some((d) => d.kind === 'audioinput'),
        video: devices.some((d) => d.kind === 'videoinput'),
      };
    } catch {
      // Не смогли перечислить — пусть решит getUserMedia.
      return { audio: true, video: true };
    }
  }

  /** Статусы запрошенных устройств; null — операция устарела из-за stopAll(). */
  private async acquireKinds(
    wanted: TrackKind[],
    generation: number,
  ): Promise<Partial<Record<TrackKind, DeviceStatus>> | null> {
    const statuses: Partial<Record<TrackKind, DeviceStatus>> = {};
    try {
      const stream = await this.md.getUserMedia({
        audio: wanted.includes('audio') && AUDIO_CONSTRAINTS,
        video: wanted.includes('video') && VIDEO_CONSTRAINTS,
      });
      if (!this.adopt(stream, generation, wanted)) return null;
      for (const kind of wanted) statuses[kind] = this.tracks[kind] ? 'on' : 'failed';
      return statuses;
    } catch (error) {
      if (generation !== this.generation) return null;

      if (classify(error) === 'denied') {
        const permissions = await this.queryPermissions(wanted);
        if (generation !== this.generation) return null;
        // Без Permissions API не донимаем пользователя повторными запросами.
        if (!permissions) {
          for (const kind of wanted) statuses[kind] = 'denied';
          return statuses;
        }
        for (const kind of wanted) {
          if (permissions[kind] === 'denied') {
            statuses[kind] = 'denied';
            continue;
          }
          const status = await this.acquireOne(kind, generation, false);
          if (!status) return null;
          statuses[kind] = status;
        }
        return statuses;
      }

      if (shouldRetryPerDevice(error)) {
        // Ограничения задаёт только камера: без них повторяем именно её.
        const unconstrainedVideo = isOverconstrained(error);
        for (const kind of wanted) {
          const unconstrained = unconstrainedVideo && kind === 'video';
          const status = await this.acquireOne(kind, generation, unconstrained);
          if (!status) return null;
          statuses[kind] = status;
        }
        return statuses;
      }

      for (const kind of wanted) statuses[kind] = classify(error);
      return statuses;
    }
  }

  /** Поштучный запрос; OverconstrainedError повторяется без ограничений. null — устарело. */
  private async acquireOne(
    kind: TrackKind,
    generation: number,
    unconstrained: boolean,
  ): Promise<DeviceStatus | null> {
    try {
      let stream: MediaStream;
      try {
        stream = await this.md.getUserMedia(constraintsFor(kind, unconstrained));
      } catch (error) {
        if (unconstrained || !isOverconstrained(error) || generation !== this.generation) {
          throw error;
        }
        stream = await this.md.getUserMedia(constraintsFor(kind, true));
      }
      if (!this.adopt(stream, generation, [kind])) return null;
      return this.tracks[kind] ? 'on' : 'failed';
    } catch (error) {
      return generation === this.generation ? classify(error) : null;
    }
  }

  /** Статус разрешений; null — Permissions API нет или он не знает camera/microphone. */
  private async queryPermissions(
    kinds: TrackKind[],
  ): Promise<Partial<Record<TrackKind, PermissionState>> | null> {
    const { permissions } = this;
    if (!permissions) return null;
    try {
      const states = await Promise.all(
        kinds.map(async (kind) => {
          const status = await permissions.query({ name: PERMISSION_NAMES[kind] });
          return [kind, status.state] as const;
        }),
      );
      return Object.fromEntries(states);
    } catch {
      // Часть браузеров бросает TypeError на неизвестное имя разрешения.
      return null;
    }
  }

  /**
   * Забирает треки из ответа getUserMedia. Если операция устарела, всё сразу останавливается;
   * лишние треки (незапрошенного kind или сверх одного) тоже, чтобы не держать устройство.
   */
  private adopt(stream: MediaStream, generation: number, kinds: readonly TrackKind[]): boolean {
    const fresh = generation === this.generation;
    for (const track of stream.getTracks()) {
      const kind = track.kind as TrackKind;
      if (!fresh || !kinds.includes(kind) || this.tracks[kind]) {
        track.stop();
        continue;
      }
      this.tracks[kind] = track;
      track.addEventListener('ended', this.onTrackEnded);
      if (kind === 'video') this.previewStream.addTrack(track);
    }
    return fresh;
  }

  private releaseTrack(kind: TrackKind): void {
    const track = this.tracks[kind];
    if (!track) return;
    this.tracks[kind] = null;
    track.removeEventListener('ended', this.onTrackEnded);
    if (kind === 'video') this.previewStream.removeTrack(track);
    track.stop();
  }
}
