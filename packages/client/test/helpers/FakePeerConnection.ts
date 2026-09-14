import { PeerManager, type PeerManagerDeps } from '../../src/call/PeerManager';
import { PeerSession } from '../../src/call/PeerSession';
import type { TrackKind } from '../../src/media/MediaController';
import { domError, FakeMediaStream, FakeTrack } from './FakeMedia';

/** Асинхронные методы, результат которых тест может придержать (TDD этапа 4 §11.1). */
export type DeferrableMethod =
  | 'createOffer'
  | 'createAnswer'
  | 'setLocalDescription'
  | 'setRemoteDescription'
  | 'addIceCandidate'
  | 'replaceTrack'
  | 'setParameters';

/** Придержанный вызов: side effect метода применяется только в resolve(), как в браузере. */
export interface PendingCall {
  method: DeferrableMethod;
  args: unknown[];
  resolve(): void;
  reject(error?: Error): void;
}

export class FakeRtpSender {
  /** Как в Chromium: одна кодировка. Firefox до первой отправки — пустой массив. */
  parameters: RTCRtpSendParameters = {
    transactionId: 'tx-0',
    encodings: [{ active: true }],
    headerExtensions: [],
    rtcp: {},
    codecs: [],
  };

  constructor(
    private readonly pc: FakePeerConnection,
    private readonly transceiver: FakeRtpTransceiver,
    public track: MediaStreamTrack | null,
  ) {}

  replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    const kind = this.transceiver.kind;
    if (track && track.kind !== kind) {
      return Promise.reject(new TypeError(`Cannot put a ${track.kind} track into ${kind} sender`));
    }
    return this.pc.invoke(
      'replaceTrack',
      [kind, track],
      `${kind}.replaceTrack(${trackLabel(track)})`,
      () => {
        this.track = track;
      },
    );
  }

  /** Копия, как в браузере: изменения применяются только через setParameters. */
  getParameters(): RTCRtpSendParameters {
    return structuredClone(this.parameters);
  }

  setParameters(parameters: RTCRtpSendParameters): Promise<void> {
    const bitrates = parameters.encodings.map((e) => e.maxBitrate ?? '-').join(',');
    return this.pc.invoke(
      'setParameters',
      [this.transceiver.kind, parameters],
      `${this.transceiver.kind}.setParameters(maxBitrate=${bitrates})`,
      () => {
        this.parameters = structuredClone(parameters);
      },
    );
  }
}

export class FakeRtpTransceiver {
  readonly sender: FakeRtpSender;
  /** Трек приёма существует с создания трансивера и не меняется до close(). */
  readonly receiver: { track: FakeTrack };
  mid: string | null = null;
  private currentDirection: RTCRtpTransceiverDirection;

  constructor(
    private readonly pc: FakePeerConnection,
    readonly kind: TrackKind,
    direction: RTCRtpTransceiverDirection,
    track: MediaStreamTrack | null,
  ) {
    this.currentDirection = direction;
    this.sender = new FakeRtpSender(pc, this, track);
    this.receiver = { track: new FakeTrack(kind) };
  }

  get direction(): RTCRtpTransceiverDirection {
    return this.currentDirection;
  }

  /** Присваивание пишется в журнал: порядок «direction до createAnswer» проверяется тестами. */
  set direction(value: RTCRtpTransceiverDirection) {
    this.pc.record(`${this.kind}.direction=${value}`);
    this.currentDirection = value;
  }
}

/**
 * Подмена RTCPeerConnection для unit-тестов PeerSession и PeerManager.
 *
 * - Журнал `journal` — строки в порядке вызовов: `addTransceiver(audio, sendrecv)`,
 *   `setRemoteDescription(offer)`, `video.direction=sendrecv`, `audio.replaceTrack(null)`…
 * - По умолчанию асинхронные методы завершаются сразу. `hold(method)` заставляет следующие
 *   вызовы ждать ручного `resolve()`/`reject()` из `pending`; side effect (remoteDescription,
 *   signalingState, трек отправителя) применяется только при resolve.
 * - Сигнальные состояния и ошибки повторяют браузер там, где на них держатся инварианты:
 *   `addIceCandidate` до remote description и offer не в `stable` бросают InvalidStateError.
 * - События не возникают сами: `setIceConnectionState`, `dispatchNegotiationNeeded`,
 *   `emitIceCandidate` вызывают их явно.
 */
export class FakePeerConnection extends EventTarget {
  readonly journal: string[] = [];
  readonly pending: PendingCall[] = [];
  readonly addedCandidates: RTCIceCandidateInit[] = [];

  signalingState: RTCSignalingState = 'stable';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  oniceconnectionstatechange: ((event: Event) => void) | null = null;
  onnegotiationneeded: ((event: Event) => void) | null = null;

  private readonly transceivers: FakeRtpTransceiver[] = [];
  private readonly held = new Set<DeferrableMethod>();

  constructor(readonly configuration: RTCConfiguration = {}) {
    super();
  }

  // ── Управление из теста ──────────────────────────────────────────────────────

  /** Следующие вызовы method будут ждать ручного решения. */
  hold(...methods: DeferrableMethod[]): this {
    for (const method of methods) this.held.add(method);
    return this;
  }

  /** Снова завершать вызовы сразу; уже придержанные остаются в pending. */
  release(...methods: DeferrableMethod[]): this {
    for (const method of methods) this.held.delete(method);
    return this;
  }

  /** Первый придержанный вызов method; бросает, если такого нет. */
  takePending(method: DeferrableMethod): PendingCall {
    const index = this.pending.findIndex((call) => call.method === method);
    if (index === -1) throw new Error(`No pending ${method} call`);
    return this.pending.splice(index, 1)[0]!;
  }

  setIceConnectionState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    const event = new Event('iceconnectionstatechange');
    this.oniceconnectionstatechange?.(event);
    this.dispatchEvent(event);
  }

  dispatchNegotiationNeeded(): void {
    const event = new Event('negotiationneeded');
    this.onnegotiationneeded?.(event);
    this.dispatchEvent(event);
  }

  /** Локальный ICE-кандидат; null — конец сбора кандидатов. */
  emitIceCandidate(init: RTCIceCandidateInit | null): void {
    const candidate =
      init && ({ ...init, toJSON: () => ({ ...init }) } as unknown as RTCIceCandidate);
    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);
  }

  // ── API RTCPeerConnection ────────────────────────────────────────────────────

  getTransceivers(): FakeRtpTransceiver[] {
    return [...this.transceivers];
  }

  addTransceiver(
    trackOrKind: MediaStreamTrack | TrackKind,
    init: RTCRtpTransceiverInit = {},
  ): FakeRtpTransceiver {
    this.assertOpen();
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    const kind = (track?.kind ?? trackOrKind) as TrackKind;
    const direction = init.direction ?? 'sendrecv';
    this.record(`addTransceiver(${track ? trackLabel(track) : kind}, ${direction})`);
    const transceiver = new FakeRtpTransceiver(this, kind, direction, track);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  addTrack(): never {
    throw new Error('FakePeerConnection: addTrack is forbidden by invariant I3');
  }

  removeTrack(): never {
    throw new Error('FakePeerConnection: removeTrack is forbidden by invariant I3');
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return this.invoke(
      'createOffer',
      [],
      'createOffer',
      () => {
        this.assertOpen();
        return { type: 'offer', sdp: this.buildSdp('offer') };
      },
      () => ({ type: 'offer', sdp: '' }),
    );
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return this.invoke(
      'createAnswer',
      [],
      'createAnswer',
      () => {
        this.assertOpen();
        if (this.signalingState !== 'have-remote-offer') {
          throw domError('InvalidStateError');
        }
        return { type: 'answer', sdp: this.buildSdp('answer') };
      },
      () => ({ type: 'answer', sdp: '' }),
    );
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    return this.invoke(
      'setLocalDescription',
      [description],
      `setLocalDescription(${description.type})`,
      () => {
        this.assertOpen();
        if (description.type === 'offer') {
          if (this.signalingState !== 'stable') throw domError('InvalidStateError');
          this.signalingState = 'have-local-offer';
        } else if (description.type === 'answer') {
          if (this.signalingState !== 'have-remote-offer') throw domError('InvalidStateError');
          this.signalingState = 'stable';
        }
        this.assignMids();
        this.localDescription = { type: description.type, sdp: description.sdp };
      },
    );
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    return this.invoke(
      'setRemoteDescription',
      [description],
      `setRemoteDescription(${description.type})`,
      () => {
        this.assertOpen();
        if (description.type === 'offer') {
          // Без rollback/perfect negotiation: offer не в stable — это glare.
          if (this.signalingState !== 'stable') throw domError('InvalidStateError');
          this.createTransceiversFromOffer(description.sdp ?? '');
          this.signalingState = 'have-remote-offer';
        } else if (description.type === 'answer') {
          if (this.signalingState !== 'have-local-offer') throw domError('InvalidStateError');
          this.signalingState = 'stable';
        }
        this.remoteDescription = { type: description.type, sdp: description.sdp };
      },
    );
  }

  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    return this.invoke(
      'addIceCandidate',
      [candidate],
      `addIceCandidate(${candidate.candidate ?? ''})`,
      () => {
        this.assertOpen();
        // Как в браузере: кандидат до remote description теряется с ошибкой (I4).
        if (!this.remoteDescription) throw domError('InvalidStateError');
        this.addedCandidates.push(candidate);
      },
    );
  }

  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as RTCStatsReport);
  }

  close(): void {
    if (this.signalingState === 'closed') return;
    this.record('close');
    this.signalingState = 'closed';
    // Без события iceconnectionstatechange: браузер его при close() не шлёт.
    this.iceConnectionState = 'closed';
    for (const transceiver of this.transceivers) transceiver.receiver.track.stop();
  }

  // ── Внутреннее ───────────────────────────────────────────────────────────────

  record(entry: string): void {
    this.journal.push(entry);
  }

  /**
   * Общий путь асинхронных методов: журнал, затем сразу или через pending.
   * Придержанный вызов, решённый после close(), резолвится без side effect значением
   * closedResult. Браузер такой Promise не завершает вовсе; резолв — худший для кода случай:
   * он проверяет, что после каждого await стоит проверка closed.
   */
  invoke<T>(
    method: DeferrableMethod,
    args: unknown[],
    entry: string,
    effect: () => T,
    closedResult?: () => T,
  ): Promise<T> {
    this.record(entry);
    // Исключение effect внутри executor превращается в reject, как у браузерных методов.
    if (!this.held.has(method)) return new Promise<T>((resolve) => resolve(effect()));
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        method,
        args,
        resolve: () => {
          if (this.signalingState === 'closed') {
            resolve(closedResult ? closedResult() : (undefined as T));
            return;
          }
          try {
            resolve(effect());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject: (error = domError('OperationError')) => reject(error),
      });
    });
  }

  private assertOpen(): void {
    if (this.signalingState === 'closed') throw domError('InvalidStateError');
  }

  private createTransceiversFromOffer(sdp: string): void {
    const kinds = [...sdp.matchAll(/^m=(audio|video) /gm)].map((match) => match[1] as TrackKind);
    kinds.forEach((kind, index) => {
      const existing = this.transceivers[index];
      if (existing) return;
      // Трансиверы из remote offer браузер создаёт recvonly — отсюда I2.
      this.transceivers.push(new FakeRtpTransceiver(this, kind, 'recvonly', null));
    });
  }

  private assignMids(): void {
    this.transceivers.forEach((transceiver, index) => {
      transceiver.mid ??= String(index);
    });
  }

  private buildSdp(type: 'offer' | 'answer'): string {
    const lines = ['v=0', `s=fake-${type}`];
    for (const transceiver of this.transceivers) {
      lines.push(`m=${transceiver.kind} 9 UDP/TLS/RTP/SAVPF 0`, `a=${transceiver.direction}`);
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}

function trackLabel(track: MediaStreamTrack | null): string {
  return track ? track.id : 'null';
}

/** Фабрика для DI `createPeerConnection`: запоминает все созданные соединения. */
export function fakePeerConnections() {
  const instances: FakePeerConnection[] = [];
  const create = (configuration: RTCConfiguration) => {
    const pc = new FakePeerConnection(configuration);
    instances.push(pc);
    return pc as unknown as RTCPeerConnection;
  };
  return {
    create,
    instances,
    /** Последнее созданное соединение. */
    get last(): FakePeerConnection {
      const pc = instances.at(-1);
      if (!pc) throw new Error('No RTCPeerConnection was created');
      return pc;
    },
  };
}

/** Минимальный SDP offer с заданными m-line — для answerer'а без настоящего offerer'а. */
export function fakeOfferSdp(kinds: TrackKind[] = ['audio', 'video']): string {
  const lines = ['v=0', 's=fake-offer'];
  for (const kind of kinds) lines.push(`m=${kind} 9 UDP/TLS/RTP/SAVPF 0`, 'a=sendrecv');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Фабрика PeerManager для RoomSession: настоящие PeerManager и PeerSession поверх фейковых
 * RTCPeerConnection и MediaStream (в jsdom их нет).
 */
export function fakePeers() {
  const pcs = fakePeerConnections();
  let manager: PeerManager | undefined;
  const createPeers = (deps: PeerManagerDeps) =>
    (manager = new PeerManager({
      ...deps,
      createSession: (sessionDeps) =>
        new PeerSession({
          ...sessionDeps,
          createPeerConnection: pcs.create,
          createStream: () => new FakeMediaStream() as unknown as MediaStream,
        }),
    }));
  return {
    pcs,
    createPeers,
    get manager(): PeerManager {
      if (!manager) throw new Error('PeerManager was not created');
      return manager;
    },
  };
}
