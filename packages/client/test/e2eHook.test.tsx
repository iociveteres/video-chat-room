import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installE2EHook, recordCreatedTracks } from '../src/app/e2eHook';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, FakeMediaDevices, flushMicrotasks } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeers } from './helpers/FakePeerConnection';
import { FakeSocket } from './helpers/FakeSocket';

function createSession(
  devices = new FakeMediaDevices(),
  socket = new FakeSocket(),
  peers = fakePeers(),
) {
  return new RoomSession({
    dispatch: () => {},
    createSocket: () => socket.asSocket(),
    createMedia: fakeMedia(devices).createMedia,
    createPeers: peers.createPeers,
  });
}

afterEach(() => {
  delete window.__vcr;
  vi.unstubAllEnvs();
});

describe('recordCreatedTracks', () => {
  it('records every track handed out by getUserMedia and keeps the result intact', async () => {
    const devices = new FakeMediaDevices();
    const tracks = recordCreatedTracks(devices as unknown as MediaDevices);

    const stream = await devices.getUserMedia({ audio: true, video: true });
    await devices.getUserMedia({ video: true });

    expect(stream.getTracks()).toHaveLength(2);
    expect(tracks).toEqual(devices.createdTracks);
    expect(tracks).toHaveLength(3);
  });

  it('is idempotent: a second call does not wrap getUserMedia again', async () => {
    const devices = new FakeMediaDevices();
    const first = recordCreatedTracks(devices as unknown as MediaDevices);
    const wrapped = devices.getUserMedia;

    const second = recordCreatedTracks(devices as unknown as MediaDevices);
    await devices.getUserMedia({ audio: true });

    expect(second).toBe(first);
    expect(devices.getUserMedia).toBe(wrapped);
    expect(first).toHaveLength(1);
  });
});

describe('installE2EHook', () => {
  it('exposes the session tracks and snapshots of all created tracks', async () => {
    const devices = new FakeMediaDevices();
    const session = createSession(devices);
    installE2EHook(session, window, devices as unknown as MediaDevices);

    // Controller вызывает getUserMedia уже через обёртку хука.
    await session.media.acquireInitial();
    await flushMicrotasks();
    await session.media.setVideoEnabled(false);

    const hook = window.__vcr!;
    expect(hook.media.getTracks()).toEqual(session.media.getTracks());
    expect(hook.media.getTracks().video).toBeNull();
    expect(
      hook.media
        .debugCreatedTracks()
        .map(({ kind, readyState }) => [kind, readyState])
        .sort(),
    ).toEqual([
      ['audio', 'live'],
      ['video', 'ended'],
    ]);
    // Снимки сериализуемы: page.evaluate вернёт их как есть.
    expect(JSON.parse(JSON.stringify(hook.media.debugCreatedTracks()))).toEqual(
      hook.media.debugCreatedTracks(),
    );
  });

  it('exposes peer ids, serializable stats and signal counts per addressee', async () => {
    const socket = new FakeSocket();
    const peers = fakePeers();
    const session = createSession(new FakeMediaDevices(), socket, peers);
    installE2EHook(session, window, undefined);
    const hook = window.__vcr!;

    session.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    const self = { id: 'p-alex', name: 'Алекс', joinedAt: 1, media: { audio: true, video: true } };
    const maria = { ...self, id: 'p-maria', name: 'Мария', joinedAt: 0 };
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self, participants: [maria, self], messages: [] });
    socket.serverEmit('signal', { from: maria.id, data: { type: 'offer', sdp: fakeOfferSdp() } });
    await flushMicrotasks();
    peers.pcs.last.emitIceCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 });

    expect(hook.peers.ids()).toEqual([maria.id]);
    const counts = hook.debug.signalCounts();
    expect(counts).toEqual({ [maria.id]: { offer: 0, answer: 1, candidate: 1 } });
    counts[maria.id]!.offer = 99;
    expect(hook.debug.signalCounts()[maria.id]!.offer).toBe(0);

    const stat = { id: 'in-1', type: 'inbound-rtp', timestamp: 1 } as RTCStats;
    vi.spyOn(peers.pcs.last, 'getStats').mockResolvedValue(new Map([[stat.id, stat]]));
    await expect(hook.peers.getStats(maria.id)).resolves.toEqual([stat]);
    await expect(hook.peers.getStats('nobody')).resolves.toBeNull();
  });

  it('stops counting signals after cleanup', async () => {
    const socket = new FakeSocket();
    const session = createSession(new FakeMediaDevices(), socket);
    const uninstall = installE2EHook(session, window, undefined);
    const hook = window.__vcr!;
    uninstall();

    session.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    const self = { id: 'p-alex', name: 'Алекс', joinedAt: 1, media: { audio: true, video: true } };
    socket.lastEmitted('room:join').respond({ ok: true, self, participants: [self], messages: [] });
    socket.serverEmit('participant:joined', { participant: { ...self, id: 'p-boris' } });
    await flushMicrotasks();

    expect(hook.debug.signalCounts()).toEqual({});
  });

  it('works without mediaDevices and removes itself on cleanup', () => {
    const uninstall = installE2EHook(createSession(), window, undefined);

    expect(window.__vcr?.media.debugCreatedTracks()).toEqual([]);
    uninstall();
    expect(window.__vcr).toBeUndefined();
  });

  it('cleanup does not remove a hook installed later by another session', () => {
    const uninstallFirst = installE2EHook(createSession(), window, undefined);
    installE2EHook(createSession(), window, undefined);
    const second = window.__vcr;

    uninstallFirst();

    expect(window.__vcr).toBe(second);
  });
});

describe('AppStateProvider and the E2E hook', () => {
  const renderProvider = () =>
    render(
      <AppStateProvider createSession={() => createSession()}>
        <div />
      </AppStateProvider>,
    );

  it('does not install window.__vcr without VITE_E2E', () => {
    vi.stubEnv('VITE_E2E', '');
    renderProvider();
    expect(window.__vcr).toBeUndefined();
  });

  it('installs window.__vcr with VITE_E2E=1 and removes it on unmount', () => {
    vi.stubEnv('VITE_E2E', '1');
    const view = renderProvider();

    expect(window.__vcr?.media.getTracks()).toEqual({ audio: null, video: null });

    view.unmount();
    expect(window.__vcr).toBeUndefined();
  });
});
