import type { SignalData } from '@vcr/shared';
import type { PeerSession, PeerSessionDeps } from '../../../client/src/call/PeerSession';

/** Минимальный SDP, который пропускает серверная схема: содержимое серверу неважно. */
export const SYNTHETIC_SDP = 'v=0\r\ns=role-stand\r\n';

export type DescriptionType = 'offer' | 'answer';

/**
 * Подмена PeerSession для стенда ролей (TDD этапа 5 §11.2): без WebRTC, только протокол.
 * Записывает роль, отправленные и полученные offer/answer; на offer отвечает синтетическим
 * answer. Кандидаты не генерирует: для I1 важны только описания.
 */
export class FakePeerSession {
  readonly remoteId: string;
  readonly role: PeerSessionDeps['role'];
  /** В Node нет MediaStream; стенд потоки не читает. */
  readonly remoteStream = null as unknown as MediaStream;
  readonly sent: DescriptionType[] = [];
  readonly received: DescriptionType[] = [];
  closed = false;

  private readonly deps: PeerSessionDeps;

  constructor(deps: PeerSessionDeps) {
    this.deps = deps;
    this.remoteId = deps.remoteId;
    this.role = deps.role;
  }

  start(): void {
    this.send('offer');
  }

  handleSignal(data: SignalData): void {
    if (this.closed || data.type === 'candidate') return;
    this.received.push(data.type);
    if (data.type === 'offer') this.send('answer');
    // Пара согласована: answer отправлен (answerer) или получен (offerer).
    this.deps.onStatus('connected');
  }

  replaceTrack(): Promise<void> {
    return Promise.resolve();
  }

  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as RTCStatsReport);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.deps.onStatus('closed');
  }

  /** Для DI в PeerManager: структурно совместим с используемой частью PeerSession. */
  asPeerSession(): PeerSession {
    return this as unknown as PeerSession;
  }

  private send(type: DescriptionType): void {
    if (this.closed) return;
    this.sent.push(type);
    this.deps.sendSignal({ type, sdp: SYNTHETIC_SDP });
  }
}
