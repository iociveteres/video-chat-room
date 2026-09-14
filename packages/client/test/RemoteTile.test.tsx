import type { MediaState, ParticipantDTO, SignalData } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PeerStatus } from '../src/call/PeerSession';
import { PEER_STATUS_TEXT, remoteTileView } from '../src/features/call/RemoteTile';
import { VideoGrid } from '../src/features/call/VideoGrid';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, flushMicrotasks } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeers } from './helpers/FakePeerConnection';
import { FakeSocket } from './helpers/FakeSocket';

const ALL_ON: MediaState = { audio: true, video: true };
const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 1_000, media: ALL_ON };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 2_000, media: ALL_ON };
const boris: ParticipantDTO = { id: 'p-boris', name: 'Борис', joinedAt: 3_000, media: ALL_ON };
const OFFER: SignalData = { type: 'offer', sdp: fakeOfferSdp() };

describe('remoteTileView', () => {
  const on: MediaState = { audio: true, video: true };
  const camOff: MediaState = { audio: true, video: false };

  it.each<[PeerStatus | undefined, MediaState, ReturnType<typeof remoteTileView>]>([
    [undefined, on, { showVideo: false, statusLabel: PEER_STATUS_TEXT.connecting }],
    ['connecting', on, { showVideo: false, statusLabel: 'Подключение…' }],
    ['connected', on, { showVideo: true }],
    ['connected', camOff, { showVideo: false, statusLabel: 'Камера выключена' }],
    ['unstable', on, { showVideo: true, overlayLabel: 'Связь нестабильна…' }],
    ['unstable', camOff, { showVideo: false, statusLabel: 'Связь нестабильна…' }],
    ['failed', on, { showVideo: false, statusLabel: 'Не удалось установить медиасоединение' }],
    ['failed', camOff, { showVideo: false, statusLabel: 'Не удалось установить медиасоединение' }],
    ['closed', on, { showVideo: false, statusLabel: PEER_STATUS_TEXT.connecting }],
  ])('status %s with media %j → %j', (status, media, expected) => {
    expect(remoteTileView(status, media)).toEqual(expected);
  });
});

async function renderStage(participants: ParticipantDTO[] = [maria, alex]) {
  const socket = new FakeSocket();
  const media = fakeMedia();
  const peers = fakePeers();
  let session: RoomSession | undefined;

  const view = render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({
          dispatch,
          createSocket: () => socket.asSocket(),
          createMedia: media.createMedia,
          createPeers: peers.createPeers,
        }))
      }
    >
      <VideoGrid />
    </AppStateProvider>,
  );

  await act(async () => {
    session!.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    socket.lastEmitted('room:join').respond({ ok: true, self: alex, participants, messages: [] });
  });

  const tile = (name: string) => screen.getByRole('figure', { name });
  const video = (name: string) => tile(name).querySelector('video')!;
  const placeholder = (name: string) => tile(name).querySelector('.avatar-placeholder');
  const server = (event: string, payload: unknown) =>
    act(async () => {
      socket.serverEmit(event, payload);
      await flushMicrotasks();
    });
  /** Мария прислала offer: у меня появилась answerer-сессия. */
  const connectMaria = async () => {
    await server('signal', { from: maria.id, data: OFFER });
    return peers.pcs.last;
  };
  const setIce = (state: RTCIceConnectionState) =>
    act(() => peers.pcs.last.setIceConnectionState(state));

  return {
    ...view,
    session: session!,
    tile,
    video,
    placeholder,
    server,
    connectMaria,
    setIce,
  };
}

describe('RemoteTile in VideoGrid', () => {
  it('renders the self tile and a tile per remote participant in join order', async () => {
    const t = await renderStage([maria, boris, alex]);

    const stage = screen.getByRole('region', { name: 'Видео' });
    expect(
      within(stage)
        .getAllByRole('figure')
        .map((f) => f.getAttribute('aria-label')),
    ).toEqual(['Вы', 'Мария', 'Борис']);
    expect(t.video('Мария').muted).toBe(false);
    expect(t.video('Мария')).not.toHaveClass('tile__video--mirrored');
  });

  it('shows «Подключение…» until the connection is up, then the remote stream', async () => {
    const t = await renderStage();
    expect(t.placeholder('Мария')).toHaveTextContent('Мария');
    expect(t.placeholder('Мария')).toHaveTextContent('Подключение…');

    await t.connectMaria();
    t.setIce('checking');
    expect(t.placeholder('Мария')).toHaveTextContent('Подключение…');

    t.setIce('connected');
    expect(t.placeholder('Мария')).toBeNull();
    expect(t.video('Мария')).not.toHaveClass('tile__video--hidden');
    expect(t.video('Мария').srcObject).toBe(t.session.peers.getRemoteStream(maria.id));
  });

  it('keeps the same <video> element through every status change', async () => {
    const t = await renderStage();
    const video = t.video('Мария');

    await t.connectMaria();
    for (const state of ['checking', 'connected', 'disconnected', 'failed', 'connected'] as const) {
      t.setIce(state);
      expect(t.video('Мария')).toBe(video);
    }
  });

  it('connected with the camera off → «Камера выключена»; microphone off → icon', async () => {
    const t = await renderStage();
    await t.connectMaria();
    t.setIce('connected');

    await t.server('participant:media', {
      participantId: maria.id,
      media: { audio: false, video: false },
    });

    expect(t.placeholder('Мария')).toHaveTextContent('Камера выключена');
    expect(within(t.tile('Мария')).getByRole('img', { name: 'Микрофон выключен' })).toBeVisible();
    expect(within(t.tile('Вы')).queryByRole('img', { name: 'Микрофон выключен' })).toBeNull();
  });

  it('unstable → «Связь нестабильна…» over the last video', async () => {
    const t = await renderStage();
    await t.connectMaria();
    t.setIce('connected');

    t.setIce('disconnected');

    expect(t.placeholder('Мария')).toBeNull();
    expect(within(t.tile('Мария')).getByRole('status')).toHaveTextContent('Связь нестабильна…');

    t.setIce('connected');
    expect(within(t.tile('Мария')).queryByRole('status')).toBeNull();
  });

  it('adds a tile for a newcomer and removes the tile of someone who left', async () => {
    const t = await renderStage();

    await t.server('participant:joined', { participant: boris });
    expect(t.placeholder('Борис')).toHaveTextContent('Подключение…');

    await t.server('participant:left', { participantId: maria.id });
    expect(screen.queryByRole('figure', { name: 'Мария' })).toBeNull();
    expect(screen.getAllByRole('figure')).toHaveLength(2);
  });
});
