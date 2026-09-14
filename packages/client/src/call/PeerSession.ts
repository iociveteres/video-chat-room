import {
  MAX_VIDEO_BITRATE_BPS,
  PEER_CONNECT_TIMEOUT_MS,
  type IceCandidateDTO,
  type SignalData,
} from '@vcr/shared';
import type { LocalTracks, TrackKind } from '../media/MediaController';

export type PeerRole = 'offerer' | 'answerer';
export type PeerStatus = 'connecting' | 'connected' | 'unstable' | 'failed' | 'closed';

export interface PeerSessionDeps {
  remoteId: string;
  role: PeerRole;
  rtcConfig: RTCConfiguration;
  /** Актуальные локальные треки на момент вызова (MediaController.getTracks). */
  getLocalTracks: () => LocalTracks;
  sendSignal: (data: SignalData) => void;
  onStatus: (status: PeerStatus) => void;
  /** DI для unit-тестов: в jsdom нет RTCPeerConnection. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  /** DI для unit-тестов: в jsdom нет MediaStream. */
  createStream?: () => MediaStream;
  /** Сколько ждать connected после отправки offer/answer; по умолчанию PEER_CONNECT_TIMEOUT_MS. */
  connectTimeoutMs?: number;
}

/** iceConnectionState, а не connectionState: второго нет в Firefox 100–112 (TDD §1.3). */
export function toPeerStatus(state: RTCIceConnectionState): PeerStatus {
  switch (state) {
    case 'connected':
    case 'completed':
      return 'connected';
    case 'disconnected':
      return 'unstable';
    case 'failed':
      return 'failed';
    case 'closed':
      return 'closed';
    default: // new, checking
      return 'connecting';
  }
}

/**
 * Одно RTCPeerConnection на пару участников (TDD этапа 4 §4.4). Инварианты:
 *
 * - I1: offer шлёт только вошедший раньше; на соединение ровно одна пара offer/answer,
 *   negotiationneeded не обрабатывается.
 * - I2: трансиверы фиксированы — m=audio, затем m=video, оба sendrecv, даже без трека.
 * - I3: треки меняются только через replaceTrack; addTrack/removeTrack запрещены.
 * - I4: входящие ICE-кандидаты до применения remote description буферизуются; SDP-операции
 *   и replaceTrack сериализованы в opChain; после каждого await — проверка closed.
 */
export class PeerSession {
  readonly remoteId: string;
  readonly role: PeerRole;
  /** Стабильный объект на всё время жизни сессии: треки приёма не меняются. */
  readonly remoteStream: MediaStream;

  private readonly pc: RTCPeerConnection;
  private readonly getLocalTracks: PeerSessionDeps['getLocalTracks'];
  private readonly sendSignal: PeerSessionDeps['sendSignal'];
  private readonly onStatus: PeerSessionDeps['onStatus'];
  private readonly connectTimeoutMs: number;

  private audioTx: RTCRtpTransceiver | null = null;
  private videoTx: RTCRtpTransceiver | null = null;
  private opChain: Promise<void> = Promise.resolve();
  private started = false;
  private closed = false;
  private status: PeerStatus | null = null;
  /** Параметры отправки выставляются один раз — при первом connected. */
  private sendParametersApplied = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * I4: выставляется, когда remote description применён И буфер кандидатов разобран.
   * Флаг, а не pc.remoteDescription: пока SRD в процессе, это поле ещё null.
   */
  private remoteDescriptionApplied = false;
  /** I4: входящие кандидаты до remote description, в порядке получения. */
  private pendingCandidates: IceCandidateDTO[] = [];
  /**
   * Исходящие кандидаты до отправки offer/answer. У адресата нет сессии, пока не пришёл offer:
   * кандидат, обогнавший его, был бы потерян.
   */
  private outgoingCandidates: IceCandidateDTO[] | null = [];

  constructor(deps: PeerSessionDeps) {
    this.remoteId = deps.remoteId;
    this.role = deps.role;
    this.getLocalTracks = deps.getLocalTracks;
    this.sendSignal = deps.sendSignal;
    this.onStatus = deps.onStatus;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? PEER_CONNECT_TIMEOUT_MS;
    this.remoteStream = deps.createStream?.() ?? new MediaStream();
    this.pc = (deps.createPeerConnection ?? ((config) => new RTCPeerConnection(config)))(
      deps.rtcConfig,
    );
    // I1/I3: ренеготиации нет. Браузер шлёт negotiationneeded после addTransceiver —
    // обработчик сознательно пуст, иначе появился бы второй offer и glare.
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = (event) => {
      if (event.candidate) this.sendCandidate(toCandidateDTO(event.candidate.toJSON()));
    };
    this.pc.oniceconnectionstatechange = () => this.onIceConnectionStateChange();
  }

  /** Только offerer: создать трансиверы и отправить offer. Повторный вызов игнорируется. */
  start(): void {
    if (this.role !== 'offerer' || this.started) {
      return this.protocolViolation(this.role !== 'offerer' ? 'start-as-answerer' : 'restart');
    }
    this.started = true;
    void this.enqueue(async () => {
      const { audio, video } = this.getLocalTracks();
      // I2: оба трансивера всегда, в фиксированном порядке, sendrecv.
      this.audioTx = this.pc.addTransceiver(audio ?? 'audio', { direction: 'sendrecv' });
      this.videoTx = this.pc.addTransceiver(video ?? 'video', { direction: 'sendrecv' });
      this.attachRemoteTracks();

      const offer = await this.pc.createOffer();
      if (this.closed) return;
      await this.pc.setLocalDescription(offer);
      if (this.closed) return;
      this.sendDescription({ type: 'offer', sdp: this.localSdp() });
    });
  }

  handleSignal(data: SignalData): void {
    if (this.closed) return;
    switch (data.type) {
      case 'offer':
        void this.enqueue(() => this.onOffer(data.sdp));
        break;
      case 'answer':
        void this.enqueue(() => this.onAnswer(data.sdp));
        break;
      case 'candidate':
        // Кандидаты не идут в opChain: иначе ждали бы не относящиеся к ним операции.
        if (this.remoteDescriptionApplied) void this.addCandidate(data.candidate);
        else this.pendingCandidates.push(data.candidate);
        break;
    }
  }

  /**
   * Без ренеготиации (I3). Сериализовано с SDP-шагами: replaceTrack(null), поставленный во
   * время ответа на offer, выполнится после него и победит. Без трансивера (answerer до offer)
   * — no-op: трек прочитается из getLocalTracks() при ответе.
   */
  replaceTrack(kind: TrackKind, track: MediaStreamTrack | null): Promise<void> {
    return this.enqueue(async () => {
      const tx = kind === 'audio' ? this.audioTx : this.videoTx;
      if (!tx) return;
      await tx.sender.replaceTrack(track);
    });
  }

  /** Диагностика и E2E. */
  getStats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  /** Идемпотентно. Локальные треки не трогает: ими владеет MediaController. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearConnectTimeout();
    this.pendingCandidates = [];
    this.outgoingCandidates = null;
    this.pc.onicecandidate = null;
    this.pc.oniceconnectionstatechange = null;
    // Удалённые треки переходят в ended.
    this.pc.close();
    this.setStatus('closed');
  }

  private async onOffer(sdp: string): Promise<void> {
    // Offer offerer'у — нарушение I1; второй offer answerer'у — ренеготиация (I3).
    if (this.role !== 'answerer' || this.pc.remoteDescription) {
      return this.protocolViolation('unexpected-offer');
    }
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    if (this.closed) return;
    await this.flushPendingCandidates();
    if (this.closed) return;

    // Порядок m-line у разных браузеров может отличаться: ищем по kind, а не по индексу.
    const transceivers = this.pc.getTransceivers();
    this.audioTx = transceivers.find((tx) => tx.receiver.track.kind === 'audio') ?? null;
    this.videoTx = transceivers.find((tx) => tx.receiver.track.kind === 'video') ?? null;
    if (!this.audioTx || !this.videoTx || transceivers.length !== 2) {
      // Ответить на такой offer нельзя, а второго не будет: пара остаётся без медиа.
      return this.fail('bad-m-lines');
    }

    // I2: трансиверы из remote offer создаются recvonly. Без sendrecv до createAnswer
    // answer запретит отправку, и replaceTrack потом «ничего не передаст».
    this.audioTx.direction = 'sendrecv';
    this.videoTx.direction = 'sendrecv';
    // Треки читаются после SRD: камеру могли выключить, пока он шёл.
    const { audio, video } = this.getLocalTracks();
    await this.audioTx.sender.replaceTrack(audio);
    if (this.closed) return;
    await this.videoTx.sender.replaceTrack(video);
    if (this.closed) return;
    this.attachRemoteTracks();

    const answer = await this.pc.createAnswer();
    if (this.closed) return;
    await this.pc.setLocalDescription(answer);
    if (this.closed) return;
    this.sendDescription({ type: 'answer', sdp: this.localSdp() });
  }

  private async onAnswer(sdp: string): Promise<void> {
    if (this.role !== 'offerer' || this.pc.signalingState !== 'have-local-offer') {
      return this.protocolViolation('unexpected-answer');
    }
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    if (this.closed) return;
    await this.flushPendingCandidates();
  }

  /**
   * В исходном порядке. Кандидаты, пришедшие во время разбора, встают в конец того же буфера,
   * а флаг выставляется только на пустом буфере — поэтому они не обгоняют более ранние.
   */
  private async flushPendingCandidates(): Promise<void> {
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift()!;
      await this.addCandidate(candidate);
      if (this.closed) return;
    }
    this.remoteDescriptionApplied = true;
  }

  /** Один плохой кандидат не валит сессию: у ICE есть другие пары. */
  private async addCandidate(candidate: IceCandidateDTO): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.closed) console.warn('PeerSession addIceCandidate failed', this.remoteId, err);
    }
  }

  private sendDescription(data: Extract<SignalData, { type: 'offer' | 'answer' }>): void {
    this.sendSignal(data);
    const queued = this.outgoingCandidates ?? [];
    this.outgoingCandidates = null;
    for (const candidate of queued) this.sendSignal({ type: 'candidate', candidate });
    this.armConnectTimeout();
  }

  private sendCandidate(candidate: IceCandidateDTO): void {
    if (this.closed) return;
    if (this.outgoingCandidates) this.outgoingCandidates.push(candidate);
    else this.sendSignal({ type: 'candidate', candidate });
  }

  private onIceConnectionStateChange(): void {
    // Событие, поставленное в очередь до close(), может прийти после него.
    if (this.closed) return;
    const status = toPeerStatus(this.pc.iceConnectionState);
    // После connected или failed ICE таймаут больше не нужен: итог уже известен.
    if (status === 'connected' || status === 'failed') this.clearConnectTimeout();
    this.setStatus(status);
    if (status === 'connected' && !this.sendParametersApplied) {
      this.sendParametersApplied = true;
      void this.applySendParameters();
    }
  }

  /**
   * Потолок битрейта видео (TDD этапа 5 §4.3). setParameters не вызывает ренеготиацию (I3),
   * а параметры кодирования живут на отправителе и переживают replaceTrack. Ошибка не влияет
   * на статус: соединение работает и без потолка.
   */
  private async applySendParameters(): Promise<void> {
    const sender = this.videoTx?.sender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      // Firefox до первой отправки отдаёт пустой encodings.
      if (params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = MAX_VIDEO_BITRATE_BPS;
      await sender.setParameters(params);
    } catch (err) {
      if (!this.closed) console.warn('PeerSession setParameters failed', this.remoteId, err);
    }
  }

  /**
   * failed, если за connectTimeoutMs не было connected (например, STUN недоступен и host-пары
   * не проходят). PC не закрывается: соединится позже — статус обновится.
   */
  private armConnectTimeout(): void {
    this.clearConnectTimeout();
    if (toPeerStatus(this.pc.iceConnectionState) === 'connected') return;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      console.warn('PeerSession connect timeout', this.remoteId);
      this.setStatus('failed');
    }, this.connectTimeoutMs);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimer === null) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /** receiver.track существует с создания трансивера, поэтому ontrack не нужен. */
  private attachRemoteTracks(): void {
    for (const tx of [this.audioTx, this.videoTx]) {
      const track = tx?.receiver.track;
      if (track && !this.remoteStream.getTracks().includes(track)) {
        this.remoteStream.addTrack(track);
      }
    }
  }

  private localSdp(): string {
    const sdp = this.pc.localDescription?.sdp;
    if (!sdp) throw new Error('Local description has no SDP');
    return sdp;
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    // Операция, дошедшая до очереди после close(), не выполняется.
    const run = this.opChain.then(() => (this.closed ? undefined : op()));
    // Ошибка одной операции не рвёт цепочку, но соединение без неё уже не поднимется.
    this.opChain = run.catch((err: unknown) => this.fail('op-error', err));
    return this.opChain;
  }

  /** Повтор того же статуса не сообщается (connected → completed и т.п.). */
  private setStatus(status: PeerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  private fail(reason: string, err?: unknown): void {
    if (this.closed) return;
    console.warn(`PeerSession failed: ${reason}`, this.remoteId, err);
    this.clearConnectTimeout();
    this.setStatus('failed');
  }

  /** Неожиданный сигнал: игнорируется, состояние сессии не меняется. */
  private protocolViolation(reason: string): void {
    console.warn(`PeerSession protocol violation: ${reason}`, this.remoteId);
  }
}

/** Поля RTCIceCandidateInit необязательны, в DTO — явные null (схема сервера строгая). */
function toCandidateDTO(init: RTCIceCandidateInit): IceCandidateDTO {
  return {
    candidate: init.candidate ?? '',
    sdpMid: init.sdpMid ?? null,
    sdpMLineIndex: init.sdpMLineIndex ?? null,
    ...(init.usernameFragment != null && { usernameFragment: init.usernameFragment }),
  };
}
