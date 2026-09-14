import type { IceCandidateDTO, SignalData } from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PeerSession, toPeerStatus, type PeerRole, type PeerStatus } from '../src/call/PeerSession';
import type { LocalTracks } from '../src/media/MediaController';
import { FakeMediaStream, FakeTrack, flushMicrotasks } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeerConnections } from './helpers/FakePeerConnection';

const RTC_CONFIG: RTCConfiguration = { iceServers: [], bundlePolicy: 'max-bundle' };

function setup(
  role: PeerRole,
  initial: { audio?: boolean; video?: boolean; connectTimeoutMs?: number } = {},
) {
  const pcs = fakePeerConnections();
  const tracks: Record<'audio' | 'video', FakeTrack | null> = {
    audio: initial.audio === false ? null : new FakeTrack('audio'),
    video: initial.video === false ? null : new FakeTrack('video'),
  };
  const remoteStream = new FakeMediaStream();
  const signals: SignalData[] = [];
  const statuses: PeerStatus[] = [];

  const session = new PeerSession({
    remoteId: 'remote-1',
    role,
    rtcConfig: RTC_CONFIG,
    getLocalTracks: () => ({ ...tracks }) as unknown as LocalTracks,
    // sendSignal пишется в журнал соединения: так виден его порядок относительно SDP-шагов.
    sendSignal: (data) => {
      signals.push(data);
      pcs.last.record(`sendSignal(${data.type})`);
    },
    onStatus: (status) => statuses.push(status),
    createPeerConnection: pcs.create,
    createStream: () => remoteStream as unknown as MediaStream,
    connectTimeoutMs: initial.connectTimeoutMs,
  });

  return { session, pc: pcs.last, pcs, tracks, remoteStream, signals, statuses };
}

const offer = (kinds?: ('audio' | 'video')[]): SignalData => ({
  type: 'offer',
  sdp: fakeOfferSdp(kinds),
});
const ANSWER_SDP = 'v=0\r\ns=remote-answer\r\n';
const ANSWER: SignalData = { type: 'answer', sdp: ANSWER_SDP };

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const candidate = (n: number): IceCandidateDTO => ({
  candidate: `candidate:${n} 1 udp 2122260223 h${n}.local 5000${n} typ host`,
  sdpMid: '0',
  sdpMLineIndex: 0,
});
const candidateSignal = (n: number): SignalData => ({ type: 'candidate', candidate: candidate(n) });
const added = (n: number) => `addIceCandidate(${candidate(n).candidate})`;

/** Полное согласование: offerer отправил offer и применил answer. */
async function negotiatedOfferer(initial?: Parameters<typeof setup>[1]) {
  const t = setup('offerer', initial);
  t.session.start();
  await flushMicrotasks();
  t.session.handleSignal(ANSWER);
  await flushMicrotasks();
  return t;
}

describe('PeerSession offerer', () => {
  it('without a camera: two sendrecv transceivers, audio first, then offer → SLD → signal', async () => {
    const t = setup('offerer', { video: false });

    t.session.start();
    await flushMicrotasks();

    expect(t.pc.journal).toEqual([
      `addTransceiver(${t.tracks.audio!.id}, sendrecv)`,
      'addTransceiver(video, sendrecv)',
      'createOffer',
      'setLocalDescription(offer)',
      'sendSignal(offer)',
    ]);
    expect(t.signals).toEqual([{ type: 'offer', sdp: t.pc.localDescription!.sdp }]);
    expect(t.pc.configuration).toBe(RTC_CONFIG);
    expect(t.pc.signalingState).toBe('have-local-offer');
    expect(t.statuses).toEqual([]);
  });

  it('puts both local tracks into the transceivers and exposes both receiver tracks', async () => {
    const t = setup('offerer');

    t.session.start();
    await flushMicrotasks();

    const [audioTx, videoTx] = t.pc.getTransceivers();
    expect(audioTx!.sender.track).toBe(t.tracks.audio);
    expect(videoTx!.sender.track).toBe(t.tracks.video);
    expect(t.session.remoteStream).toBe(t.remoteStream);
    expect(t.remoteStream.getTracks()).toEqual([audioTx!.receiver.track, videoTx!.receiver.track]);
  });

  it('applies the answer', async () => {
    const t = setup('offerer');
    t.session.start();
    await flushMicrotasks();

    t.session.handleSignal(ANSWER);
    await flushMicrotasks();

    expect(t.pc.journal.at(-1)).toBe('setRemoteDescription(answer)');
    expect(t.pc.remoteDescription).toEqual({ type: 'answer', sdp: ANSWER_SDP });
    expect(t.pc.signalingState).toBe('stable');
  });

  it('ignores negotiationneeded: no second offer (I1/I3)', async () => {
    const t = setup('offerer');
    expect(t.pc.onnegotiationneeded).toBeNull();

    t.session.start();
    await flushMicrotasks();
    t.pc.dispatchNegotiationNeeded();
    t.session.handleSignal(ANSWER);
    await flushMicrotasks();
    t.pc.dispatchNegotiationNeeded();
    await flushMicrotasks();

    expect(t.pc.journal.filter((entry) => entry === 'createOffer')).toHaveLength(1);
    expect(t.signals.map((s) => s.type)).toEqual(['offer']);
  });

  it('ignores a repeated start() and start() on an answerer', async () => {
    const offerer = setup('offerer');
    const answerer = setup('answerer');

    offerer.session.start();
    offerer.session.start();
    answerer.session.start();
    await flushMicrotasks();

    expect(offerer.signals.map((s) => s.type)).toEqual(['offer']);
    expect(answerer.pc.journal).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('close() while createOffer is pending: no SLD and no signal', async () => {
    const t = setup('offerer');
    t.pc.hold('createOffer');
    t.session.start();
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('createOffer').resolve();
    await flushMicrotasks();

    expect(t.pc.journal).not.toContain('setLocalDescription(offer)');
    expect(t.signals).toEqual([]);
    expect(t.statuses).toEqual(['closed']);
  });
});

describe('PeerSession answerer', () => {
  it('sets direction to sendrecv BEFORE createAnswer, then replaceTrack, answer → SLD → signal', async () => {
    const t = setup('answerer', { video: false });

    t.session.handleSignal(offer());
    await flushMicrotasks();

    expect(t.pc.journal).toEqual([
      'setRemoteDescription(offer)',
      'audio.direction=sendrecv',
      'video.direction=sendrecv',
      `audio.replaceTrack(${t.tracks.audio!.id})`,
      'video.replaceTrack(null)',
      'createAnswer',
      'setLocalDescription(answer)',
      'sendSignal(answer)',
    ]);
    expect(t.signals).toEqual([{ type: 'answer', sdp: t.pc.localDescription!.sdp }]);
    expect(t.pc.localDescription!.sdp).toMatch(
      /m=audio[\s\S]*a=sendrecv[\s\S]*m=video[\s\S]*a=sendrecv/,
    );
    expect(t.remoteStream.getTracks().map((track) => track.kind)).toEqual(['audio', 'video']);
    expect(t.statuses).toEqual([]);
  });

  it('reads local tracks after SRD resolves', async () => {
    const t = setup('answerer', { video: false });
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    const camera = new FakeTrack('video');
    t.tracks.video = camera;
    t.tracks.audio = null;
    t.pc.takePending('setRemoteDescription').resolve();
    await flushMicrotasks();

    expect(t.pc.journal).toContain('audio.replaceTrack(null)');
    expect(t.pc.journal).toContain(`video.replaceTrack(${camera.id})`);
  });

  it('finds transceivers by receiver kind, not by m-line index', async () => {
    const t = setup('answerer');

    t.session.handleSignal(offer(['video', 'audio']));
    await flushMicrotasks();

    const [first, second] = t.pc.getTransceivers();
    expect(first!.sender.track).toBe(t.tracks.video);
    expect(second!.sender.track).toBe(t.tracks.audio);
    expect(t.signals.map((s) => s.type)).toEqual(['answer']);
  });

  it.each([
    ['audio only', ['audio'] as const],
    ['three m-lines', ['audio', 'video', 'video'] as const],
    ['two video m-lines', ['video', 'video'] as const],
  ])('fails without answering an offer with %s', async (_label, kinds) => {
    const t = setup('answerer');

    t.session.handleSignal(offer([...kinds]));
    await flushMicrotasks();

    expect(t.pc.journal).toEqual(['setRemoteDescription(offer)']);
    expect(t.signals).toEqual([]);
    expect(t.statuses).toEqual(['failed']);
  });

  it('close() while SRD is pending: no createAnswer and no signal after it resolves', async () => {
    const t = setup('answerer');
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('setRemoteDescription').resolve();
    await flushMicrotasks();

    expect(t.pc.journal).toEqual(['setRemoteDescription(offer)', 'close']);
    expect(t.signals).toEqual([]);
    expect(t.statuses).toEqual(['closed']);
  });

  it('close() while replaceTrack is pending: no createAnswer', async () => {
    const t = setup('answerer');
    t.pc.hold('replaceTrack');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('replaceTrack').resolve();
    await flushMicrotasks();

    expect(t.pc.journal).not.toContain('createAnswer');
    expect(t.signals).toEqual([]);
  });

  it('close() while createAnswer is pending: no SLD and no signal', async () => {
    const t = setup('answerer');
    t.pc.hold('createAnswer');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('createAnswer').resolve();
    await flushMicrotasks();

    expect(t.pc.journal).not.toContain('setLocalDescription(answer)');
    expect(t.signals).toEqual([]);
  });
});

describe('PeerSession unexpected signals', () => {
  it('ignores a repeated offer to the answerer with a warning', async () => {
    const t = setup('answerer');
    t.session.handleSignal(offer());
    await flushMicrotasks();
    const journal = [...t.pc.journal];

    t.session.handleSignal(offer());
    await flushMicrotasks();

    expect(t.pc.journal).toEqual(journal);
    expect(t.signals.map((s) => s.type)).toEqual(['answer']);
    expect(t.statuses).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpected-offer'), 'remote-1');
  });

  it('ignores a second offer queued while the first SRD is still pending', async () => {
    const t = setup('answerer');
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(offer());
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.pc.release('setRemoteDescription').takePending('setRemoteDescription').resolve();
    await flushMicrotasks();

    expect(t.pc.journal.filter((entry) => entry === 'setRemoteDescription(offer)')).toHaveLength(1);
    expect(t.signals.map((s) => s.type)).toEqual(['answer']);
  });

  it('ignores an offer to the offerer', async () => {
    const t = setup('offerer');
    t.session.start();
    await flushMicrotasks();

    t.session.handleSignal(offer());
    await flushMicrotasks();

    expect(t.pc.journal).not.toContain('setRemoteDescription(offer)');
    expect(t.pc.signalingState).toBe('have-local-offer');
    expect(t.statuses).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpected-offer'), 'remote-1');
  });

  it('ignores an answer before the offer is sent, a second answer and an answer to the answerer', async () => {
    const offerer = setup('offerer');
    offerer.session.handleSignal(ANSWER);
    await flushMicrotasks();
    offerer.session.start();
    offerer.session.handleSignal(ANSWER);
    offerer.session.handleSignal(ANSWER);
    const answerer = setup('answerer');
    answerer.session.handleSignal(ANSWER);
    await flushMicrotasks();

    expect(offerer.pc.journal.filter((e) => e === 'setRemoteDescription(answer)')).toHaveLength(1);
    expect(answerer.pc.journal).toEqual([]);
    expect(offerer.statuses).toEqual([]);
    expect(answerer.statuses).toEqual([]);
    expect(
      warn.mock.calls.filter(([msg]) => String(msg).includes('unexpected-answer')),
    ).toHaveLength(3);
  });
});

describe('PeerSession errors and close()', () => {
  it('reports failed when an SDP step rejects and keeps the queue alive', async () => {
    const t = setup('answerer');
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.pc.takePending('setRemoteDescription').reject(new DOMException('bad sdp', 'OperationError'));
    t.pc.release('setRemoteDescription');
    await flushMicrotasks();
    expect(t.statuses).toEqual(['failed']);

    t.session.handleSignal(offer());
    await flushMicrotasks();
    expect(t.signals.map((s) => s.type)).toEqual(['answer']);
  });

  it('is idempotent, reports closed once and leaves local tracks alone', async () => {
    const t = setup('offerer');
    t.session.start();
    await flushMicrotasks();

    t.session.close();
    t.session.close();

    expect(t.statuses).toEqual(['closed']);
    expect(t.pc.signalingState).toBe('closed');
    expect(t.pc.onicecandidate).toBeNull();
    expect(t.pc.oniceconnectionstatechange).toBeNull();
    expect(t.tracks.audio!.stop).not.toHaveBeenCalled();
    expect(t.tracks.video!.stop).not.toHaveBeenCalled();
    expect(t.remoteStream.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
  });

  it('does nothing on signals and start() after close()', async () => {
    const offerer = setup('offerer');
    const answerer = setup('answerer');
    offerer.session.close();
    answerer.session.close();

    offerer.session.start();
    offerer.session.handleSignal(ANSWER);
    answerer.session.handleSignal(offer());
    await flushMicrotasks();

    expect(offerer.pc.journal).toEqual(['close']);
    expect(answerer.pc.journal).toEqual(['close']);
    expect(offerer.signals).toEqual([]);
    expect(answerer.signals).toEqual([]);
  });
});

describe('PeerSession ICE candidates (I4)', () => {
  it('buffers candidates received before SRD and applies them in order after it resolves', async () => {
    const t = setup('answerer');
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(offer());
    t.session.handleSignal(candidateSignal(1));
    t.session.handleSignal(candidateSignal(2));
    t.session.handleSignal(candidateSignal(3));
    await flushMicrotasks();
    expect(t.pc.journal).toEqual(['setRemoteDescription(offer)']);

    t.pc.takePending('setRemoteDescription').resolve();
    await flushMicrotasks();

    expect(t.pc.journal.slice(0, 5)).toEqual([
      'setRemoteDescription(offer)',
      added(1),
      added(2),
      added(3),
      'audio.direction=sendrecv',
    ]);
    expect(t.pc.addedCandidates).toEqual([candidate(1), candidate(2), candidate(3)]);
  });

  it('buffers candidates that arrive before the offer itself', async () => {
    const t = setup('answerer');
    t.session.handleSignal(candidateSignal(1));
    await flushMicrotasks();
    expect(t.pc.journal).toEqual([]);

    t.session.handleSignal(offer());
    await flushMicrotasks();

    expect(t.pc.addedCandidates).toEqual([candidate(1)]);
  });

  it('adds a candidate at once after SRD without waiting for queued operations', async () => {
    const t = await negotiatedOfferer();
    t.pc.hold('replaceTrack');
    void t.session.replaceTrack('video', null);
    await flushMicrotasks();

    t.session.handleSignal(candidateSignal(1));
    await flushMicrotasks();

    expect(t.pc.journal.at(-1)).toBe(added(1));
    expect(t.pc.pending.map((call) => call.method)).toEqual(['replaceTrack']);
  });

  it('offerer buffers candidates from the answerer until the answer is applied', async () => {
    const t = setup('offerer');
    t.session.start();
    await flushMicrotasks();

    t.session.handleSignal(candidateSignal(1));
    t.session.handleSignal(candidateSignal(2));
    await flushMicrotasks();
    expect(t.pc.addedCandidates).toEqual([]);

    t.session.handleSignal(ANSWER);
    await flushMicrotasks();

    expect(t.pc.journal.slice(-3)).toEqual(['setRemoteDescription(answer)', added(1), added(2)]);
  });

  it('keeps the order for candidates that arrive while the buffer is being flushed', async () => {
    const t = setup('answerer');
    t.pc.hold('setRemoteDescription', 'addIceCandidate');
    t.session.handleSignal(candidateSignal(1));
    t.session.handleSignal(offer());
    await flushMicrotasks();
    t.pc.takePending('setRemoteDescription').resolve();
    await flushMicrotasks();

    t.session.handleSignal(candidateSignal(2));
    await flushMicrotasks();
    expect(t.pc.journal.filter((e) => e.startsWith('addIceCandidate'))).toEqual([added(1)]);

    t.pc.release('addIceCandidate').takePending('addIceCandidate').resolve();
    await flushMicrotasks();

    expect(t.pc.journal.filter((e) => e.startsWith('addIceCandidate'))).toEqual([
      added(1),
      added(2),
    ]);
    t.session.handleSignal(candidateSignal(3));
    expect(t.pc.journal.at(-1)).toBe(added(3));
  });

  it('a rejected candidate is logged, the others are applied and the status is not failed', async () => {
    const t = await negotiatedOfferer();
    t.pc.hold('addIceCandidate');

    for (const n of [1, 2, 3]) t.session.handleSignal(candidateSignal(n));
    t.pc.takePending('addIceCandidate').resolve();
    t.pc.takePending('addIceCandidate').reject(new DOMException('bad', 'OperationError'));
    t.pc.takePending('addIceCandidate').resolve();
    await flushMicrotasks();

    expect(t.pc.addedCandidates).toEqual([candidate(1), candidate(3)]);
    expect(t.statuses).not.toContain('failed');
    expect(warn).toHaveBeenCalledWith(
      'PeerSession addIceCandidate failed',
      'remote-1',
      expect.objectContaining({ name: 'OperationError' }),
    );
  });

  it('stops flushing the buffer on close()', async () => {
    const t = setup('answerer');
    t.pc.hold('addIceCandidate');
    t.session.handleSignal(candidateSignal(1));
    t.session.handleSignal(candidateSignal(2));
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('addIceCandidate').resolve();
    await flushMicrotasks();

    expect(t.pc.journal.filter((e) => e.startsWith('addIceCandidate'))).toEqual([added(1)]);
    expect(t.signals).toEqual([]);
  });

  it('sends local candidates after the offer, buffering those gathered before it', async () => {
    const t = setup('offerer');
    t.pc.hold('setLocalDescription');
    t.session.start();
    await flushMicrotasks();

    t.pc.emitIceCandidate({ candidate: 'candidate:a', sdpMid: '0', sdpMLineIndex: 0 });
    expect(t.signals).toEqual([]);
    t.pc.takePending('setLocalDescription').resolve();
    await flushMicrotasks();
    t.pc.emitIceCandidate({ candidate: 'candidate:b', usernameFragment: 'uf' });
    t.pc.emitIceCandidate(null);

    expect(t.signals.map((s) => s.type)).toEqual(['offer', 'candidate', 'candidate']);
    expect(t.signals.slice(1)).toEqual([
      { type: 'candidate', candidate: { candidate: 'candidate:a', sdpMid: '0', sdpMLineIndex: 0 } },
      {
        type: 'candidate',
        candidate: {
          candidate: 'candidate:b',
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: 'uf',
        },
      },
    ]);
  });

  it('answerer sends local candidates only after the answer and none after close()', async () => {
    const t = setup('answerer');
    t.pc.hold('setLocalDescription');
    t.session.handleSignal(offer());
    await flushMicrotasks();
    t.pc.emitIceCandidate({ candidate: 'candidate:a', sdpMid: '0', sdpMLineIndex: 0 });

    t.pc.takePending('setLocalDescription').resolve();
    await flushMicrotasks();
    expect(t.signals.map((s) => s.type)).toEqual(['answer', 'candidate']);

    const handler = t.pc.onicecandidate;
    t.session.close();
    expect(t.pc.onicecandidate).toBeNull();
    handler?.({
      candidate: { toJSON: () => ({ candidate: 'late' }) },
    } as unknown as RTCPeerConnectionIceEvent);
    expect(t.signals.map((s) => s.type)).toEqual(['answer', 'candidate']);
  });
});

describe('PeerSession replaceTrack', () => {
  it('is serialized: replaceTrack(T1) then replaceTrack(null) ends with null', async () => {
    const t = await negotiatedOfferer({ video: false });
    const camera = new FakeTrack('video') as unknown as MediaStreamTrack;
    t.pc.hold('replaceTrack');

    const first = t.session.replaceTrack('video', camera);
    const second = t.session.replaceTrack('video', null);
    await flushMicrotasks();
    expect(t.pc.pending).toHaveLength(1);

    t.pc.takePending('replaceTrack').resolve();
    await flushMicrotasks();
    t.pc.takePending('replaceTrack').resolve();
    await Promise.all([first, second]);

    expect(t.pc.journal.slice(-2)).toEqual([
      `video.replaceTrack(${camera.id})`,
      'video.replaceTrack(null)',
    ]);
    expect(t.pc.getTransceivers()[1]!.sender.track).toBeNull();
    expect(t.pc.journal.filter((e) => e === 'createOffer')).toHaveLength(1);
  });

  it('camera turned off while the answerer handles the offer: the sender ends with null', async () => {
    const t = setup('answerer');
    const camera = t.tracks.video!;
    t.pc.hold('replaceTrack');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    // onOffer уже прочитал треки и ждёт replaceTrack(audio); MediaController выключает камеру.
    t.tracks.video = null;
    const off = t.session.replaceTrack('video', null);
    t.pc.release('replaceTrack').takePending('replaceTrack').resolve();
    await off;

    expect(t.pc.journal.filter((e) => e.startsWith('video.replaceTrack'))).toEqual([
      `video.replaceTrack(${camera.id})`,
      'video.replaceTrack(null)',
    ]);
    expect(t.pc.getTransceivers().find((tx) => tx.kind === 'video')!.sender.track).toBeNull();
    expect(t.signals.map((s) => s.type)).toEqual(['answer']);
  });

  it('is a no-op without a transceiver and after close()', async () => {
    const answerer = setup('answerer');
    await expect(answerer.session.replaceTrack('audio', null)).resolves.toBeUndefined();
    expect(answerer.pc.journal).toEqual([]);

    const offerer = await negotiatedOfferer();
    offerer.session.close();
    await expect(offerer.session.replaceTrack('audio', null)).resolves.toBeUndefined();
    expect(offerer.pc.journal).not.toContain('audio.replaceTrack(null)');
  });
});

describe('PeerSession connection status', () => {
  it.each([
    ['new', 'connecting'],
    ['checking', 'connecting'],
    ['connected', 'connected'],
    ['completed', 'connected'],
    ['disconnected', 'unstable'],
    ['failed', 'failed'],
    ['closed', 'closed'],
  ] as const)('maps iceConnectionState %s to %s', (state, status) => {
    expect(toPeerStatus(state)).toBe(status);
  });

  it('reports changes of iceConnectionState without repeating the same status', async () => {
    const t = await negotiatedOfferer();

    for (const state of [
      'checking',
      'connected',
      'completed',
      'disconnected',
      'connected',
    ] as const) {
      t.pc.setIceConnectionState(state);
    }

    expect(t.statuses).toEqual(['connecting', 'connected', 'unstable', 'connected']);
  });

  it('reports failed after the connect timeout without closing the PC, then connected', async () => {
    vi.useFakeTimers();
    const t = await negotiatedOfferer();
    t.pc.setIceConnectionState('checking');

    vi.advanceTimersByTime(19_999);
    expect(t.statuses).toEqual(['connecting']);
    vi.advanceTimersByTime(1);
    expect(t.statuses).toEqual(['connecting', 'failed']);
    expect(t.pc.signalingState).not.toBe('closed');

    t.pc.setIceConnectionState('connected');
    expect(t.statuses).toEqual(['connecting', 'failed', 'connected']);
  });

  it('does not time out once connected, and ICE failed does not report failed twice', async () => {
    vi.useFakeTimers();
    const connected = await negotiatedOfferer();
    connected.pc.setIceConnectionState('connected');
    vi.advanceTimersByTime(60_000);
    expect(connected.statuses).toEqual(['connected']);

    const failed = await negotiatedOfferer();
    failed.pc.setIceConnectionState('failed');
    vi.advanceTimersByTime(60_000);
    expect(failed.statuses).toEqual(['failed']);
  });

  it('arms the timeout only after sending the description and honours connectTimeoutMs', async () => {
    vi.useFakeTimers();
    const t = setup('answerer', { connectTimeoutMs: 3_000 });
    vi.advanceTimersByTime(60_000);
    expect(t.statuses).toEqual([]);

    t.session.handleSignal(offer());
    await flushMicrotasks();
    vi.advanceTimersByTime(3_000);

    expect(t.statuses).toEqual(['failed']);
  });

  it('close() cancels the timeout and ignores later ICE state changes', async () => {
    vi.useFakeTimers();
    const t = await negotiatedOfferer();
    const handler = t.pc.oniceconnectionstatechange;

    t.session.close();
    vi.advanceTimersByTime(60_000);
    t.pc.iceConnectionState = 'connected';
    handler?.(new Event('iceconnectionstatechange'));

    expect(t.pc.oniceconnectionstatechange).toBeNull();
    expect(t.statuses).toEqual(['closed']);
  });

  it('getStats() delegates to the peer connection', async () => {
    const t = setup('offerer');
    const report = new Map() as RTCStatsReport;
    vi.spyOn(t.pc, 'getStats').mockResolvedValue(report);

    await expect(t.session.getStats()).resolves.toBe(report);
  });
});

describe('PeerSession close() between any two awaits (I4)', () => {
  it('offerer: close() while setLocalDescription(offer) is pending → no offer, no timeout', async () => {
    vi.useFakeTimers();
    const t = setup('offerer');
    t.pc.hold('setLocalDescription');
    t.session.start();
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('setLocalDescription').resolve();
    await flushMicrotasks();
    vi.advanceTimersByTime(60_000);

    expect(t.signals).toEqual([]);
    expect(t.statuses).toEqual(['closed']);
  });

  it('answerer: close() while replaceTrack(video) is pending → no createAnswer', async () => {
    const t = setup('answerer');
    t.pc.hold('replaceTrack');
    t.session.handleSignal(offer());
    await flushMicrotasks();
    t.pc.takePending('replaceTrack').resolve(); // audio
    await flushMicrotasks();
    expect(t.pc.pending.map((call) => call.args[0])).toEqual(['video']);

    t.session.close();
    t.pc.takePending('replaceTrack').resolve();
    await flushMicrotasks();

    expect(t.pc.journal).not.toContain('createAnswer');
    expect(t.signals).toEqual([]);
  });

  it('answerer: close() while setLocalDescription(answer) is pending → no answer', async () => {
    const t = setup('answerer');
    t.pc.hold('setLocalDescription');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('setLocalDescription').resolve();
    await flushMicrotasks();

    expect(t.signals).toEqual([]);
  });

  it('offerer: close() while setRemoteDescription(answer) is pending → buffered candidates are dropped', async () => {
    const t = setup('offerer');
    t.session.start();
    await flushMicrotasks();
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(ANSWER);
    t.session.handleSignal(candidateSignal(1));
    await flushMicrotasks();

    t.session.close();
    t.pc.takePending('setRemoteDescription').resolve();
    await flushMicrotasks();

    expect(t.pc.journal.filter((e) => e.startsWith('addIceCandidate'))).toEqual([]);
  });

  it('a step that rejects after close() does not report failed', async () => {
    const t = setup('answerer');
    t.pc.hold('setRemoteDescription');
    t.session.handleSignal(offer());
    await flushMicrotasks();

    t.session.close();
    t.pc
      .takePending('setRemoteDescription')
      .reject(new DOMException('closed', 'InvalidStateError'));
    await flushMicrotasks();

    expect(t.statuses).toEqual(['closed']);
  });
});

describe('PeerSession edge cases', () => {
  it('offerer without a microphone creates an empty audio transceiver first', async () => {
    const t = setup('offerer', { audio: false });

    t.session.start();
    await flushMicrotasks();

    expect(t.pc.journal.slice(0, 2)).toEqual([
      'addTransceiver(audio, sendrecv)',
      `addTransceiver(${t.tracks.video!.id}, sendrecv)`,
    ]);
  });

  it('does not arm the connect timeout when ICE is already connected at send time', async () => {
    vi.useFakeTimers();
    const t = setup('offerer');
    t.pc.hold('setLocalDescription');
    t.session.start();
    await flushMicrotasks();
    t.pc.setIceConnectionState('connected');

    t.pc.takePending('setLocalDescription').resolve();
    await flushMicrotasks();
    vi.advanceTimersByTime(60_000);

    expect(t.signals.map((s) => s.type)).toEqual(['offer']);
    expect(t.statuses).toEqual(['connected']);
  });

  it('serializes a local candidate without a candidate string as an empty one', async () => {
    const t = await negotiatedOfferer();

    t.pc.emitIceCandidate({ sdpMid: '1', sdpMLineIndex: 1 });

    expect(t.signals.at(-1)).toEqual({
      type: 'candidate',
      candidate: { candidate: '', sdpMid: '1', sdpMLineIndex: 1 },
    });
  });

  it('uses the browser RTCPeerConnection and MediaStream by default', () => {
    const pcs = fakePeerConnections();
    const streams: FakeMediaStream[] = [];
    vi.stubGlobal(
      'RTCPeerConnection',
      vi.fn(function (config: RTCConfiguration) {
        return pcs.create(config);
      }),
    );
    vi.stubGlobal(
      'MediaStream',
      vi.fn(function () {
        const stream = new FakeMediaStream();
        streams.push(stream);
        return stream;
      }),
    );
    try {
      const session = new PeerSession({
        remoteId: 'remote-1',
        role: 'offerer',
        rtcConfig: RTC_CONFIG,
        getLocalTracks: () => ({ audio: null, video: null }),
        sendSignal: () => {},
        onStatus: () => {},
      });

      expect(pcs.last.configuration).toBe(RTC_CONFIG);
      expect(session.remoteStream).toBe(streams[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
