import type { SignalData } from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PEER_CREATE_FAILED_NOTICE, PeerManager } from '../src/call/PeerManager';
import { PeerSession, type PeerSessionDeps, type PeerStatus } from '../src/call/PeerSession';
import type { LocalTracks, TrackChangeListener, TrackKind } from '../src/media/MediaController';
import { FakeMediaStream, FakeTrack, flushMicrotasks } from './helpers/FakeMedia';
import { fakePeerConnections } from './helpers/FakePeerConnection';

/** Управляемый Promise для replaceTrack: проверяем, что подписчик ждёт все сессии. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

class FakePeerSession {
  readonly remoteId: string;
  readonly role: PeerSessionDeps['role'];
  readonly remoteStream = new FakeMediaStream() as unknown as MediaStream;
  readonly start = vi.fn();
  readonly handleSignal = vi.fn();
  readonly close = vi.fn(() => this.deps.onStatus('closed'));
  readonly getStats = vi.fn(() => Promise.resolve(new Map() as RTCStatsReport));
  readonly replaceTrack = vi.fn((_kind: TrackKind, _track: MediaStreamTrack | null) => {
    const d = deferred();
    this.pendingReplace.push(d);
    return d.promise;
  });
  readonly pendingReplace: ReturnType<typeof deferred>[] = [];

  constructor(readonly deps: PeerSessionDeps) {
    this.remoteId = deps.remoteId;
    this.role = deps.role;
  }
}

class FakeMedia {
  tracks: LocalTracks = {
    audio: new FakeTrack('audio') as unknown as MediaStreamTrack,
    video: null,
  };
  readonly listeners = new Set<TrackChangeListener>();
  readonly getTracks = vi.fn(() => ({ ...this.tracks }));
  readonly onTrackChange = vi.fn((listener: TrackChangeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  });

  emit(kind: TrackKind, track: MediaStreamTrack | null): Promise<unknown> {
    return Promise.all([...this.listeners].map(async (listener) => listener(kind, track)));
  }
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };
const OFFER: SignalData = { type: 'offer', sdp: 'v=0\r\n' };
const ANSWER: SignalData = { type: 'answer', sdp: 'v=0\r\n' };
const CANDIDATE: SignalData = {
  type: 'candidate',
  candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
};

function setup(opts: { createSession?: (deps: PeerSessionDeps) => PeerSession } = {}) {
  const media = new FakeMedia();
  const sessions = new Map<string, FakePeerSession>();
  const created: FakePeerSession[] = [];
  const statuses: [string, PeerStatus][] = [];
  const notices: string[] = [];
  const sent: [string, SignalData][] = [];

  const manager = new PeerManager({
    media,
    rtcConfig: RTC_CONFIG,
    sendSignal: (to, data) => sent.push([to, data]),
    onPeerStatus: (id, status) => statuses.push([id, status]),
    onNotice: (text) => notices.push(text),
    connectTimeoutMs: 3_000,
    createSession:
      opts.createSession ??
      ((deps) => {
        const session = new FakePeerSession(deps);
        sessions.set(deps.remoteId, session);
        created.push(session);
        return session as unknown as PeerSession;
      }),
  });

  return { manager, media, sessions, created, statuses, notices, sent };
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PeerManager routing', () => {
  it('participant:joined → offerer session with the right deps, started', () => {
    const t = setup();

    t.manager.handleParticipantJoined('x');

    const x = t.sessions.get('x')!;
    expect(x.role).toBe('offerer');
    expect(x.start).toHaveBeenCalledOnce();
    expect(x.deps).toMatchObject({ remoteId: 'x', rtcConfig: RTC_CONFIG, connectTimeoutMs: 3_000 });
    expect(x.deps.getLocalTracks()).toEqual(t.media.tracks);

    x.deps.sendSignal(OFFER);
    x.deps.onStatus('connected');
    expect(t.sent).toEqual([['x', OFFER]]);
    expect(t.statuses).toEqual([['x', 'connected']]);
  });

  it('ignores a duplicate participant:joined with a warning', () => {
    const t = setup();

    t.manager.handleParticipantJoined('x');
    t.manager.handleParticipantJoined('x');

    expect(t.created).toHaveLength(1);
    expect(t.sessions.get('x')!.start).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('offer from an unknown participant → answerer session receiving the offer', () => {
    const t = setup();

    t.manager.handleSignal('y', OFFER);

    const y = t.sessions.get('y')!;
    expect(y.role).toBe('answerer');
    expect(y.start).not.toHaveBeenCalled();
    expect(y.handleSignal).toHaveBeenCalledWith(OFFER);
  });

  // Для answerer-сессии (дубль offer) — та же ветка: сессия уже есть.
  it('ignores an offer for an existing offerer session (I1 violation) with a warning', () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    const x = t.sessions.get('x')!;

    t.manager.handleSignal('x', OFFER);

    expect(t.created).toHaveLength(1);
    expect(x.handleSignal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('routes answer and candidate to the existing session', () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');

    t.manager.handleSignal('x', ANSWER);
    t.manager.handleSignal('x', CANDIDATE);

    expect(t.sessions.get('x')!.handleSignal.mock.calls).toEqual([[ANSWER], [CANDIDATE]]);
  });

  it('ignores answer and candidate from an unknown participant', () => {
    const t = setup();

    t.manager.handleSignal('z', ANSWER);
    t.manager.handleSignal('z', CANDIDATE);

    expect(t.created).toEqual([]);
    expect(t.manager.getRemoteStream('z')).toBeNull();
  });

  it('participant:left → close(), removed from the Map, no stream, no closed status', async () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    t.manager.handleParticipantJoined('y');
    const x = t.sessions.get('x')!;
    expect(t.manager.getRemoteStream('x')).toBe(x.remoteStream);

    t.manager.handleParticipantLeft('x');
    t.manager.handleParticipantLeft('x');
    t.manager.handleParticipantLeft('unknown');

    expect(x.close).toHaveBeenCalledOnce();
    expect(t.manager.getRemoteStream('x')).toBeNull();
    await expect(t.manager.getStats('x')).resolves.toBeNull();
    expect(t.statuses).toEqual([]);
    // Опоздавшие статусы и сигналы ушедшей пары тоже не проходят.
    x.deps.onStatus('failed');
    t.manager.handleSignal('x', CANDIDATE);
    expect(t.statuses).toEqual([]);
    expect(x.handleSignal).not.toHaveBeenCalled();
    expect(t.sessions.get('y')!.close).not.toHaveBeenCalled();
  });

  it('a participant who left and came back gets a fresh session', () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    t.manager.handleParticipantLeft('x');

    t.manager.handleParticipantJoined('x');

    expect(t.created).toHaveLength(2);
    expect(t.created[1]!.start).toHaveBeenCalledOnce();
  });

  it('ids() lists participants with a live session', () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    t.manager.handleSignal('y', OFFER);
    expect(t.manager.ids()).toEqual(['x', 'y']);

    t.manager.handleParticipantLeft('x');
    expect(t.manager.ids()).toEqual(['y']);

    t.manager.closeAll();
    expect(t.manager.ids()).toEqual([]);
  });
});

describe('PeerManager media tracks', () => {
  it('onTrackChange → replaceTrack in every session; resolves only after all of them', async () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    t.manager.handleSignal('y', OFFER);
    const camera = new FakeTrack('video') as unknown as MediaStreamTrack;
    let done = false;

    void t.media.emit('video', camera).then(() => {
      done = true;
    });
    await flushMicrotasks();

    const [x, y] = [t.sessions.get('x')!, t.sessions.get('y')!];
    // Подписка одна на все сессии: каждая получает смену трека ровно один раз.
    expect(t.media.onTrackChange).toHaveBeenCalledOnce();
    expect(x.replaceTrack.mock.calls).toEqual([['video', camera]]);
    expect(y.replaceTrack.mock.calls).toEqual([['video', camera]]);

    x.pendingReplace[0]!.resolve();
    await flushMicrotasks();
    expect(done).toBe(false);

    y.pendingReplace[0]!.resolve();
    await flushMicrotasks();
    expect(done).toBe(true);
  });
});

describe('PeerManager closeAll', () => {
  it('closes all sessions, clears the Map and unsubscribes from media', () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    t.manager.handleSignal('y', OFFER);

    t.manager.closeAll();

    expect(t.created.every((s) => s.close.mock.calls.length === 1)).toBe(true);
    expect(t.manager.getRemoteStream('x')).toBeNull();
    expect(t.manager.getRemoteStream('y')).toBeNull();
    expect(t.media.listeners.size).toBe(0);
    expect(t.statuses).toEqual([]);
  });

  it('stays usable for the next join: new sessions resubscribe to media', async () => {
    const t = setup();
    t.manager.handleParticipantJoined('x');
    t.manager.closeAll();
    t.manager.closeAll();

    t.manager.handleParticipantJoined('x');
    void t.media.emit('audio', null);
    await flushMicrotasks();

    expect(t.media.listeners.size).toBe(1);
    expect(t.created[1]!.replaceTrack).toHaveBeenCalledWith('audio', null);
    expect(t.created[0]!.replaceTrack).not.toHaveBeenCalled();
  });
});

describe('PeerManager with a failing RTCPeerConnection constructor', () => {
  it('reports failed for the pair, shows a notice and keeps other pairs working', () => {
    const pcs = fakePeerConnections();
    let blocked = true;
    // Настоящая PeerSession: бросает конструктор соединения, как при запрете политикой браузера.
    const t = setup({
      createSession: (deps) =>
        new PeerSession({
          ...deps,
          createStream: () => new FakeMediaStream() as unknown as MediaStream,
          createPeerConnection: (config) => {
            if (blocked) throw new DOMException('blocked', 'NotSupportedError');
            return pcs.create(config);
          },
        }),
    });

    t.manager.handleParticipantJoined('x');
    t.manager.handleSignal('y', OFFER);

    expect(t.statuses).toEqual([
      ['x', 'failed'],
      ['y', 'failed'],
    ]);
    expect(t.notices).toEqual([PEER_CREATE_FAILED_NOTICE, PEER_CREATE_FAILED_NOTICE]);
    expect(t.manager.getRemoteStream('x')).toBeNull();
    expect(t.media.onTrackChange).not.toHaveBeenCalled();
    // Опоздавшие сигналы для несозданной пары просто игнорируются.
    t.manager.handleSignal('x', CANDIDATE);
    t.manager.handleParticipantLeft('x');

    blocked = false;
    t.manager.handleParticipantJoined('z');
    expect(t.manager.getRemoteStream('z')).not.toBeNull();
    expect(pcs.instances).toHaveLength(1);
  });
});
