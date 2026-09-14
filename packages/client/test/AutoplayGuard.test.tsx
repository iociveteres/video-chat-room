import type { ParticipantDTO, SignalData } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOPLAY_TEXT,
  AutoplayBanner,
  AutoplayGuard,
  AutoplayRegistry,
} from '../src/features/call/AutoplayGuard';
import { VideoStage } from '../src/features/call/VideoStage';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { domError, fakeMedia, flushMicrotasks } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeers } from './helpers/FakePeerConnection';
import { FakeSocket } from './helpers/FakeSocket';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Элемент и его мок play() отдельно: expect(el.play) оторвал бы метод от объекта. */
function fakeVideo(impl: () => Promise<void> = () => Promise.resolve()) {
  const play = vi.fn(impl);
  return { el: { play } as unknown as HTMLVideoElement, play };
}

function registry() {
  const onBlocked = vi.fn();
  const onResumed = vi.fn();
  return { registry: new AutoplayRegistry({ onBlocked, onResumed }), onBlocked, onResumed };
}

describe('AutoplayRegistry', () => {
  it('register() plays the element; NotAllowedError reports blocked', async () => {
    const t = registry();
    const ok = fakeVideo();
    const blocked = fakeVideo(() => Promise.reject(domError('NotAllowedError')));

    t.registry.register(ok.el);
    t.registry.register(blocked.el);
    await flushMicrotasks();

    expect(ok.play).toHaveBeenCalledOnce();
    expect(blocked.play).toHaveBeenCalledOnce();
    expect(t.onBlocked).toHaveBeenCalledOnce();
  });

  it('ignores other play() errors and rejections of an element already unregistered', async () => {
    const t = registry();
    t.registry.register(fakeVideo(() => Promise.reject(domError('AbortError'))).el);
    const unregister = t.registry.register(
      fakeVideo(() => Promise.reject(domError('NotAllowedError'))).el,
    );
    unregister();
    await flushMicrotasks();

    expect(t.onBlocked).not.toHaveBeenCalled();
  });

  it('resumeAll() plays every registered element and reports resumed', async () => {
    const t = registry();
    const a = fakeVideo();
    const b = fakeVideo();
    const gone = fakeVideo();
    t.registry.register(a.el);
    t.registry.register(b.el);
    t.registry.register(gone.el)();

    await t.registry.resumeAll();

    expect(a.play).toHaveBeenCalledTimes(2);
    expect(b.play).toHaveBeenCalledTimes(2);
    expect(gone.play).toHaveBeenCalledOnce();
    expect(t.onResumed).toHaveBeenCalledOnce();
    expect(t.onBlocked).not.toHaveBeenCalled();
  });

  it('resumeAll() keeps the banner if the policy still blocks an element', async () => {
    const t = registry();
    t.registry.register(fakeVideo().el);
    t.registry.register(fakeVideo(() => Promise.reject(domError('NotAllowedError'))).el);
    await flushMicrotasks();
    t.onBlocked.mockClear();

    await t.registry.resumeAll();

    expect(t.onResumed).not.toHaveBeenCalled();
    expect(t.onBlocked).toHaveBeenCalledOnce();
  });
});

const alex: ParticipantDTO = {
  id: 'p-alex',
  name: 'Алекс',
  joinedAt: 1_000,
  media: { audio: true, video: true },
};
const maria: ParticipantDTO = { ...alex, id: 'p-maria', name: 'Мария', joinedAt: 2_000 };
const OFFER: SignalData = { type: 'offer', sdp: fakeOfferSdp() };

/** Комната с Марией: её offer принят, ICE connected — у плитки есть поток. */
async function renderRoom() {
  const socket = new FakeSocket();
  const peers = fakePeers();
  let session: RoomSession | undefined;
  render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({
          dispatch,
          createSocket: () => socket.asSocket(),
          createMedia: fakeMedia().createMedia,
          createPeers: peers.createPeers,
        }))
      }
    >
      <AutoplayGuard>
        <AutoplayBanner />
        <VideoStage />
      </AutoplayGuard>
    </AppStateProvider>,
  );

  await act(async () => {
    session!.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [maria, alex], messages: [] });
    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    await flushMicrotasks();
    peers.pcs.last.setIceConnectionState('connected');
    await flushMicrotasks();
  });

  const banner = () => screen.queryByRole('region', { name: 'Звук заблокирован' });
  const remoteVideo = () =>
    screen.getByRole('figure', { name: 'Мария' }).querySelector('video') as HTMLVideoElement;
  return { banner, remoteVideo };
}

describe('AutoplayGuard with remote tiles', () => {
  it('rejected play() of a remote video → banner; «Включить звук» plays it again and hides the banner', async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    play.mockImplementation(function (this: HTMLMediaElement) {
      // Self-view без звука политика пропускает; удалённое видео — нет.
      return this.muted ? Promise.resolve() : Promise.reject(domError('NotAllowedError'));
    });

    const t = await renderRoom();

    const banner = t.banner()!;
    expect(banner).toHaveTextContent(AUTOPLAY_TEXT.message);
    const remoteCalls = () => play.mock.contexts.filter((el) => el === t.remoteVideo()).length;
    expect(remoteCalls()).toBe(1);

    play.mockResolvedValue(undefined);
    await user.click(within(banner).getByRole('button', { name: 'Включить звук' }));

    expect(remoteCalls()).toBe(2);
    expect(t.banner()).toBeNull();
  });
});
