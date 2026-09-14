import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installE2EHook, recordCreatedTracks } from '../src/app/e2eHook';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, FakeMediaDevices, flushMicrotasks } from './helpers/FakeMedia';
import { FakeSocket } from './helpers/FakeSocket';

function createSession(devices = new FakeMediaDevices()) {
  return new RoomSession({
    dispatch: () => {},
    createSocket: () => new FakeSocket().asSocket(),
    createMedia: fakeMedia(devices).createMedia,
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
