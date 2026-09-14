import type { SignalData } from '@vcr/shared';
import type { LocalTracks } from '../media/MediaController';

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
}

/**
 * Одно RTCPeerConnection на пару участников (TDD этапа 4 §4.4). Инварианты:
 *
 * - I1: offer шлёт только вошедший раньше; на соединение ровно одна пара offer/answer,
 *   negotiationneeded не обрабатывается.
 * - I2: трансиверы фиксированы — m=audio, затем m=video, оба sendrecv, даже без трека.
 * - I3: треки меняются только через replaceTrack; addTrack/removeTrack запрещены.
 * - I4: SDP-операции сериализованы в opChain; после каждого await — проверка closed.
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

  private audioTx: RTCRtpTransceiver | null = null;
  private videoTx: RTCRtpTransceiver | null = null;
  private opChain: Promise<void> = Promise.resolve();
  private started = false;
  private closed = false;

  constructor(deps: PeerSessionDeps) {
    this.remoteId = deps.remoteId;
    this.role = deps.role;
    this.getLocalTracks = deps.getLocalTracks;
    this.sendSignal = deps.sendSignal;
    this.onStatus = deps.onStatus;
    this.remoteStream = deps.createStream?.() ?? new MediaStream();
    this.pc = (deps.createPeerConnection ?? ((config) => new RTCPeerConnection(config)))(
      deps.rtcConfig,
    );
    // I1/I3: ренеготиации нет. Браузер шлёт negotiationneeded после addTransceiver —
    // обработчик сознательно пуст, иначе появился бы второй offer и glare.
    this.pc.onnegotiationneeded = null;
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
      this.sendSignal({ type: 'offer', sdp: this.localSdp() });
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
        // Буферизация и применение кандидатов (I4) добавляются следующим шагом.
        break;
    }
  }

  /** Идемпотентно. Локальные треки не трогает: ими владеет MediaController. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pc.onicecandidate = null;
    this.pc.oniceconnectionstatechange = null;
    // Удалённые треки переходят в ended.
    this.pc.close();
    this.onStatus('closed');
  }

  private async onOffer(sdp: string): Promise<void> {
    // Offer offerer'у — нарушение I1; второй offer answerer'у — ренеготиация (I3).
    if (this.role !== 'answerer' || this.pc.remoteDescription) {
      return this.protocolViolation('unexpected-offer');
    }
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
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
    this.sendSignal({ type: 'answer', sdp: this.localSdp() });
  }

  private async onAnswer(sdp: string): Promise<void> {
    if (this.role !== 'offerer' || this.pc.signalingState !== 'have-local-offer') {
      return this.protocolViolation('unexpected-answer');
    }
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /** receiver.track существует с создания трансивера, поэтому ontrack не нужен. */
  private attachRemoteTracks(): void {
    for (const tx of [this.audioTx, this.videoTx]) {
      const track = tx?.receiver.track;
      if (track && !this.remoteStream.getTracks().includes(track))
        this.remoteStream.addTrack(track);
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

  private fail(reason: string, err?: unknown): void {
    if (this.closed) return;
    console.warn(`PeerSession failed: ${reason}`, this.remoteId, err);
    this.onStatus('failed');
  }

  /** Неожиданный сигнал: игнорируется, состояние сессии не меняется. */
  private protocolViolation(reason: string): void {
    console.warn(`PeerSession protocol violation: ${reason}`, this.remoteId);
  }
}
