import type { SignalData } from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PeerSession, type PeerRole, type PeerStatus } from '../src/call/PeerSession';
import type { LocalTracks } from '../src/media/MediaController';
import { FakeMediaStream, FakeTrack, flushMicrotasks } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeerConnections } from './helpers/FakePeerConnection';

const RTC_CONFIG: RTCConfiguration = { iceServers: [], bundlePolicy: 'max-bundle' };

function setup(role: PeerRole, initial: { audio?: boolean; video?: boolean } = {}) {
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
});

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
