import type { SignalData } from '@vcr/shared';
import type { MediaController } from '../media/MediaController';
import { PeerSession, type PeerRole, type PeerSessionDeps, type PeerStatus } from './PeerSession';

/** Конструктор RTCPeerConnection бросил (редкие политики браузера) — TDD этапа 4 §8.2. */
export const PEER_CREATE_FAILED_NOTICE = 'Не удалось создать медиасоединение в этом браузере';

export interface PeerManagerDeps {
  media: Pick<MediaController, 'getTracks' | 'onTrackChange'>;
  rtcConfig: RTCConfiguration;
  sendSignal: (to: string, data: SignalData) => void;
  onPeerStatus: (participantId: string, status: PeerStatus) => void;
  onNotice: (text: string) => void;
  connectTimeoutMs?: number;
  /** DI для unit-тестов. */
  createSession?: (deps: PeerSessionDeps) => PeerSession;
}

/**
 * Реестр PeerSession по participantId (TDD этапа 4 §4.5). С первого дня Map, а не одна сессия:
 * на этапе 5 mesh не потребует переписывать ядро.
 *
 * Роль определяется тем, как узнали о пире (I1): participant:joined — я вошёл раньше и шлю
 * offer; offer от неизвестного — он вошёл раньше, я отвечаю.
 */
export class PeerManager {
  private readonly deps: PeerManagerDeps;
  private readonly createSession: (deps: PeerSessionDeps) => PeerSession;
  private readonly sessions = new Map<string, PeerSession>();
  /** Подписка на смену треков живёт, пока есть сессии: closeAll() снимает её до следующего входа. */
  private unsubscribeMedia: (() => void) | null = null;

  constructor(deps: PeerManagerDeps) {
    this.deps = deps;
    this.createSession = deps.createSession ?? ((sessionDeps) => new PeerSession(sessionDeps));
  }

  /** participant:joined — я вошёл раньше, значит offerer. */
  handleParticipantJoined(participantId: string): void {
    if (this.sessions.has(participantId)) {
      console.warn('PeerManager: duplicate participant:joined', participantId);
      return;
    }
    this.createPeer(participantId, 'offerer')?.start();
  }

  handleSignal(from: string, data: SignalData): void {
    const session = this.sessions.get(from);
    if (session) {
      if (data.type === 'offer') {
        // offerer — нарушение I1 (сервер такой offer тоже отбрасывает); answerer — дубль.
        console.warn(`PeerManager: offer for an existing ${session.role} session`, from);
        return;
      }
      session.handleSignal(data);
      return;
    }
    // Answer и candidate без сессии — опоздавшие сообщения уже закрытой пары.
    if (data.type !== 'offer') return;
    this.createPeer(from, 'answerer')?.handleSignal(data);
  }

  handleParticipantLeft(participantId: string): void {
    const session = this.sessions.get(participantId);
    if (!session) return;
    // Сначала из реестра: статус closed ушедшей пары наружу не сообщается.
    this.sessions.delete(participantId);
    session.close();
  }

  /** Участники, с которыми сейчас есть сессия (диагностика и E2E). */
  ids(): string[] {
    return [...this.sessions.keys()];
  }

  getRemoteStream(participantId: string): MediaStream | null {
    return this.sessions.get(participantId)?.remoteStream ?? null;
  }

  getStats(participantId: string): Promise<RTCStatsReport | null> {
    return this.sessions.get(participantId)?.getStats() ?? Promise.resolve(null);
  }

  /** Все пути выхода из комнаты. Менеджер остаётся пригодным для следующего входа. */
  closeAll(): void {
    this.unsubscribeMedia?.();
    this.unsubscribeMedia = null;
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.close();
  }

  private createPeer(participantId: string, role: PeerRole): PeerSession | null {
    let session: PeerSession | null = null;
    try {
      session = this.createSession({
        remoteId: participantId,
        role,
        rtcConfig: this.deps.rtcConfig,
        getLocalTracks: () => this.deps.media.getTracks(),
        sendSignal: (data) => this.deps.sendSignal(participantId, data),
        onStatus: (status) => {
          // Статусы сессии, уже удалённой из реестра, устарели.
          if (session && this.sessions.get(participantId) === session) {
            this.deps.onPeerStatus(participantId, status);
          }
        },
        connectTimeoutMs: this.deps.connectTimeoutMs,
      });
    } catch (err) {
      console.warn('PeerManager: failed to create a peer connection', participantId, err);
      this.deps.onPeerStatus(participantId, 'failed');
      this.deps.onNotice(PEER_CREATE_FAILED_NOTICE);
      return null;
    }
    this.sessions.set(participantId, session);
    this.subscribeMedia();
    return session;
  }

  private subscribeMedia(): void {
    if (this.unsubscribeMedia) return;
    // MediaController ждёт этот Promise перед track.stop(): сначала все отправители отцепляют
    // трек, потом устройство гаснет (TDD этапа 3 §4.3). replaceTrack сессии не отклоняется.
    this.unsubscribeMedia = this.deps.media.onTrackChange(async (kind, track) => {
      await Promise.all([...this.sessions.values()].map((s) => s.replaceTrack(kind, track)));
    });
  }
}
