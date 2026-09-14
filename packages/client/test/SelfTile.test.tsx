import type { ParticipantDTO } from '@vcr/shared';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VideoStage } from '../src/features/call/VideoStage';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, FakeMediaDevices, flushMicrotasks } from './helpers/FakeMedia';
import { FakeSocket } from './helpers/FakeSocket';

const alex: ParticipantDTO = {
  id: 'p-alex',
  name: 'Алекс',
  joinedAt: 1_000,
  media: { audio: true, video: true },
};

async function renderStage(devices = new FakeMediaDevices()) {
  const socket = new FakeSocket();
  const media = fakeMedia(devices);
  let session: RoomSession | undefined;
  const view = render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({
          dispatch,
          createSocket: () => socket.asSocket(),
          createMedia: media.createMedia,
        }))
      }
    >
      <VideoStage />
    </AppStateProvider>,
  );

  await act(async () => {
    session!.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [alex], messages: [] });
  });

  const settle = () => act(() => flushMicrotasks());
  const video = () => view.container.querySelector('video')!;
  const placeholder = () => view.container.querySelector('.avatar-placeholder');
  return { ...view, session: session!, media, settle, video, placeholder };
}

describe('SelfTile', () => {
  it('shows the own preview stream, muted and mirrored, labelled «Вы»', async () => {
    const t = await renderStage();

    expect(screen.getByRole('figure', { name: 'Вы' })).toBeInTheDocument();
    expect(t.video().srcObject).toBe(t.session.media.previewStream);
    expect(t.video().muted).toBe(true);
    expect(t.video()).toHaveClass('tile__video--mirrored');
    expect(t.placeholder()).toBeNull();
    expect(screen.queryByRole('img', { name: 'Микрофон выключен' })).toBeNull();
  });

  it('camera off → placeholder with the name and «Камера выключена», video stays mounted', async () => {
    const t = await renderStage();
    const video = t.video();

    act(() => t.session.toggleVideo());
    await t.settle();

    expect(t.video()).toBe(video);
    expect(t.video()).toHaveClass('tile__video--hidden');
    expect(t.placeholder()).toHaveTextContent('Алекс');
    expect(t.placeholder()).toHaveTextContent('Камера выключена');
  });

  it('camera on again → rebinds the preview (videoTrackVersion) and hides the placeholder', async () => {
    const t = await renderStage();
    act(() => t.session.toggleVideo());
    await t.settle();
    t.video().srcObject = null;

    act(() => t.session.toggleVideo());
    await t.settle();

    expect(t.placeholder()).toBeNull();
    expect(t.video().srcObject).toBe(t.session.media.previewStream);
  });

  it('microphone off → crossed-out microphone icon', async () => {
    const t = await renderStage();

    act(() => t.session.toggleAudio());
    await t.settle();

    expect(screen.getByRole('img', { name: 'Микрофон выключен' })).toBeInTheDocument();
  });

  it.each<[string, (devices: FakeMediaDevices) => void, string]>([
    ['denied', (d) => d.rejectWith('NotAllowedError'), 'Нет доступа к камере'],
    ['not-found', (d) => (d.inputs = ['audioinput']), 'Камера не найдена'],
    [
      'busy',
      (d) => d.rejectWith('NotReadableError', { kind: 'video' }),
      'Камера занята другим приложением',
    ],
  ])('camera %s → placeholder with «%s»', async (_label, program, text) => {
    const devices = new FakeMediaDevices();
    program(devices);

    const t = await renderStage(devices);

    expect(t.placeholder()).toHaveTextContent(text);
  });

  it('device lost → «Камера отключена»', async () => {
    const t = await renderStage();
    const track = t.session.media.getTracks().video as unknown as { dispatchEnded(): void };

    act(() => track.dispatchEnded());
    await t.settle();

    expect(t.placeholder()).toHaveTextContent('Камера отключена');
  });
});
