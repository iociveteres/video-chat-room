import {
  ACK_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  type ChatMessage,
  type ParticipantDTO,
  type ServerErrorCode,
  type SignalData,
} from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_ACK_TIMEOUT_MS, mapChatSendError, RoomSession } from '../src/session/RoomSession';
import { shouldLeaveOnNavigation } from '../src/session/navigation';
import type { AppAction, ChatSendFailure, JoinFailure } from '../src/state/actions';
import { appReducer, initialAppState, type AppState } from '../src/state/appReducer';
import { selectParticipants } from '../src/state/selectors';
import { fakeMedia, flushMicrotasks, FakeMediaDevices, type FakeTrack } from './helpers/FakeMedia';
import { fakeOfferSdp, fakePeers } from './helpers/FakePeerConnection';
import { FakeSocket } from './helpers/FakeSocket';

const ALL_ON = { audio: true, video: true };

const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 1_000, media: ALL_ON };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 2_000, media: ALL_ON };
const boris: ParticipantDTO = { id: 'p-boris', name: 'Борис', joinedAt: 3_000, media: ALL_ON };

const joinedMaria: ChatMessage = {
  kind: 'system',
  id: 'm-1',
  ts: 2_000,
  event: 'participant-joined',
  participantId: maria.id,
  participantName: maria.name,
};
const helloFromMaria: ChatMessage = {
  kind: 'user',
  id: 'm-2',
  ts: 2_500,
  authorId: maria.id,
  authorName: maria.name,
  text: 'Привет',
};

const MEDIA_ACTIONS = new Set<AppAction['type']>([
  'LOCAL_MEDIA_STATUS_CHANGED',
  'LOCAL_VIDEO_TRACK_CHANGED',
]);

function setup(devices = new FakeMediaDevices()) {
  const actions: AppAction[] = [];
  let state: AppState = initialAppState;
  const sockets: FakeSocket[] = [];
  const media = fakeMedia(devices);
  const peers = fakePeers();
  const session = new RoomSession({
    dispatch: (action) => {
      actions.push(action);
      state = appReducer(state, action);
    },
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket.asSocket();
    },
    createMedia: media.createMedia,
    createPeers: peers.createPeers,
  });

  const lastSocket = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket created');
    return socket;
  };

  /** Начинает вход и дожидается захвата медиа (фейковые устройства отвечают сразу). */
  const startJoin = async (roomId = 'room1', name = 'Алекс') => {
    session.join(roomId, name);
    await flushMicrotasks();
    return lastSocket();
  };

  /** Проводит вход до успешного ack. */
  const joinSuccessfully = async (
    participants: ParticipantDTO[] = [maria, alex],
    messages: ChatMessage[] = [],
  ) => {
    const socket = await startJoin();
    socket.serverConnect();
    socket.lastEmitted('room:join').respond({ ok: true, self: alex, participants, messages });
    return socket;
  };

  const tracks = () => session.media.getTracks() as unknown as Record<string, FakeTrack | null>;

  return {
    session,
    devices,
    pcs: peers.pcs,
    actions,
    sockets,
    lastSocket,
    startJoin,
    joinSuccessfully,
    tracks,
    liveTracks: () => devices.createdTracks.filter((t) => t.readyState === 'live'),
    getState: () => state,
    /** Типы действий сессии без статусов медиа — их порядок проверяется отдельно. */
    types: () => actions.map((a) => a.type).filter((type) => !MEDIA_ACTIONS.has(type)),
    mediaUpdates: (socket: FakeSocket) =>
      socket.emitted.filter((c) => c.event === 'media:update').map((c) => c.args[0]),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RoomSession.join', () => {
  it('acquires media, connects, sends room:join with media and dispatches JOIN_SUCCEEDED', async () => {
    const t = setup();

    t.session.join('room1', 'Алекс');

    expect(t.actions[0]).toEqual({ type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' });
    expect(t.getState().joinStep).toBe('acquiring-media');
    expect(t.sockets).toEqual([]);

    await flushMicrotasks();

    const socket = t.lastSocket();
    expect(t.types()).toEqual(['JOIN_REQUESTED', 'JOIN_CONNECTING']);
    expect(t.getState().joinStep).toBe('connecting');
    expect(t.getState().localMedia).toMatchObject({ audio: 'on', video: 'on' });
    expect(socket.connectCalls).toBe(1);
    expect(socket.emitted).toEqual([]);

    socket.serverConnect();
    const command = socket.lastEmitted('room:join');
    expect(command.args).toEqual([{ roomId: 'room1', name: 'Алекс', media: ALL_ON }]);

    command.respond({ ok: true, self: alex, participants: [maria, alex], messages: [joinedMaria] });

    expect(t.actions.slice(-2)).toEqual([
      { type: 'JOIN_SUCCEEDED', self: alex, participants: [maria, alex], messages: [joinedMaria] },
      { type: 'PEER_STATUS_CHANGED', participantId: maria.id, status: 'connecting' },
    ]);
    expect(t.getState().phase).toEqual({ kind: 'joined' });
    expect(t.session.roomId).toBe('room1');
    // Состояние не менялось с room:join — media:update не нужен.
    expect(t.mediaUpdates(socket)).toEqual([]);
  });

  it('captures media before creating the socket', async () => {
    const t = setup();
    t.devices.deferNext();

    t.session.join('room1', 'Алекс');
    await flushMicrotasks();

    expect(t.devices.pending).toHaveLength(1);
    expect(t.sockets).toEqual([]);
    // Ожидание разрешения не съедает таймаут подключения.
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2);
    expect(t.types()).toEqual(['JOIN_REQUESTED']);

    t.devices.pending[0]!.grant();
    await flushMicrotasks();

    expect(t.sockets).toHaveLength(1);
    t.lastSocket().serverConnect();
    expect(t.lastSocket().lastEmitted('room:join').args[0]).toMatchObject({ media: ALL_ON });
  });

  it('joins with everything off when access is denied', async () => {
    const devices = new FakeMediaDevices();
    devices.rejectWith('NotAllowedError');
    const t = setup(devices);

    const socket = await t.startJoin();
    socket.serverConnect();

    expect(socket.lastEmitted('room:join').args[0]).toMatchObject({
      media: { audio: false, video: false },
    });
    expect(t.getState().localMedia).toMatchObject({ audio: 'denied', video: 'denied' });
    expect(t.getState().notice?.tone).toBe('error');
  });

  it('subscribes to all events before connect()', async () => {
    const t = setup();
    const socket = await t.startJoin();

    expect(socket.listenersAtConnect).toEqual(
      expect.arrayContaining([
        'participant:joined',
        'participant:left',
        'participant:media',
        'chat:message',
        'connect_error',
        'disconnect',
        'connect',
      ]),
    );
  });

  it('dispatches participant events after joining', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    socket.serverEmit('participant:joined', { participant: boris });
    socket.serverEmit('participant:left', { participantId: maria.id });

    expect(t.actions.slice(-3)).toEqual([
      { type: 'PARTICIPANT_JOINED', participant: boris },
      { type: 'PEER_STATUS_CHANGED', participantId: boris.id, status: 'connecting' },
      { type: 'PARTICIPANT_LEFT', participantId: maria.id },
    ]);
    expect(selectParticipants(t.getState())).toEqual([alex, boris]);
  });

  it('keeps ack and a following event in order (no "ghost" participants)', async () => {
    const t = setup();
    const socket = await t.startJoin();
    socket.serverConnect();

    // Ack и participant:left пришли одной пачкой и обрабатываются синхронно друг за другом.
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [maria, alex], messages: [] });
    socket.serverEmit('participant:left', { participantId: maria.id });

    expect(selectParticipants(t.getState())).toEqual([alex]);
  });

  it('ignores a second join while joining (double click)', async () => {
    const t = setup();
    t.session.join('room1', 'Алекс');
    t.session.join('room1', 'Алекс');
    await flushMicrotasks();

    expect(t.sockets).toHaveLength(1);
    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.types()).toEqual(['JOIN_REQUESTED', 'JOIN_CONNECTING']);
  });

  it('ignores join while already joined', async () => {
    const t = setup();
    await t.joinSuccessfully();
    t.session.join('room2', 'Алекс');
    await flushMicrotasks();

    expect(t.sockets).toHaveLength(1);
    expect(t.session.roomId).toBe('room1');
  });

  describe('failures', () => {
    it('ROOM_FULL → stopAll, JOIN_FAILED(ROOM_FULL) and disconnect', async () => {
      const t = setup();
      const socket = await t.startJoin();
      socket.serverConnect();
      expect(t.liveTracks()).toHaveLength(2);

      socket.lastEmitted('room:join').respond({ ok: false, error: { code: 'ROOM_FULL' } });

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'ROOM_FULL' });
      expect(socket.connected).toBe(false);
      expect(t.getState()).toMatchObject({ displayName: 'Алекс', roomId: 'room1' });
      // Лампочка гаснет: все треки остановлены, статусы off.
      expect(t.liveTracks()).toEqual([]);
      expect(t.getState().localMedia).toMatchObject({ audio: 'off', video: 'off' });
    });

    it('«Повторить вход» after ROOM_FULL captures media again', async () => {
      const t = setup();
      const socket = await t.startJoin();
      socket.serverConnect();
      socket.lastEmitted('room:join').respond({ ok: false, error: { code: 'ROOM_FULL' } });

      await t.joinSuccessfully();

      expect(t.devices.getUserMedia).toHaveBeenCalledTimes(2);
      expect(t.liveTracks()).toHaveLength(2);
      expect(t.getState().localMedia).toMatchObject({ audio: 'on', video: 'on' });
    });

    it.each<[ServerErrorCode, JoinFailure]>([
      ['INVALID_NAME', 'INVALID_NAME'],
      ['INVALID_PAYLOAD', 'INTERNAL'],
      ['INVALID_ROOM_ID', 'INTERNAL'],
      ['ALREADY_JOINED', 'INTERNAL'],
      ['INVALID_MESSAGE', 'INTERNAL'],
      ['RATE_LIMITED', 'INTERNAL'],
      ['NOT_IN_ROOM', 'INTERNAL'],
      ['INTERNAL', 'INTERNAL'],
    ])('maps %s to JOIN_FAILED(%s)', async (code, reason) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const t = setup();
      const socket = await t.startJoin();
      socket.serverConnect();

      socket.lastEmitted('room:join').respond({ ok: false, error: { code } });

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason });
      expect(t.liveTracks()).toEqual([]);
    });

    it('connect_error → SERVER_UNAVAILABLE', async () => {
      const t = setup();
      const socket = await t.startJoin();

      socket.serverConnectError();

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      expect(socket.disconnectCalls).toBe(1);
      expect(t.liveTracks()).toEqual([]);
    });

    it('connect timeout → SERVER_UNAVAILABLE; a late connect sends nothing', async () => {
      const t = setup();
      const socket = await t.startJoin();

      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
      expect(t.types()).toEqual(['JOIN_REQUESTED', 'JOIN_CONNECTING']);
      vi.advanceTimersByTime(1);

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      socket.serverConnect();
      expect(socket.emitted).toEqual([]);
    });

    it('does not fire the connect timeout after a successful join', async () => {
      const t = setup();
      await t.joinSuccessfully();

      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + ACK_TIMEOUT_MS);

      expect(t.types()).toEqual([
        'JOIN_REQUESTED',
        'JOIN_CONNECTING',
        'JOIN_SUCCEEDED',
        'PEER_STATUS_CHANGED',
      ]);
    });

    it('ack timeout → SERVER_UNAVAILABLE; a late ack is ignored', async () => {
      const t = setup();
      const socket = await t.startJoin();
      socket.serverConnect();
      const command = socket.lastEmitted('room:join');

      vi.advanceTimersByTime(ACK_TIMEOUT_MS);

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      command.respond({ ok: true, self: alex, participants: [alex], messages: [] });
      expect(t.getState().phase).toEqual({ kind: 'failed', reason: 'SERVER_UNAVAILABLE' });
    });

    it('server disconnect while joining → SERVER_UNAVAILABLE', async () => {
      const t = setup();
      const socket = await t.startJoin();
      socket.serverConnect();

      socket.serverDisconnect('transport close');

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
    });

    it('a retry after a failure uses a new socket', async () => {
      const t = setup();
      const socket = await t.startJoin();
      socket.serverConnectError();

      await t.joinSuccessfully();

      expect(t.sockets).toHaveLength(2);
      expect(t.getState().phase).toEqual({ kind: 'joined' });
    });
  });
});

describe('RoomSession.joinWithoutMedia', () => {
  it('stops waiting for the permission prompt: statuses off, connects at once', async () => {
    const t = setup();
    t.devices.deferNext();
    t.session.join('room1', 'Алекс');
    await flushMicrotasks();
    expect(t.getState().localMedia).toMatchObject({ audio: 'acquiring', video: 'acquiring' });

    t.session.joinWithoutMedia();

    expect(t.getState().localMedia).toMatchObject({ audio: 'off', video: 'off' });
    expect(t.getState().joinStep).toBe('connecting');
    const socket = t.lastSocket();
    socket.serverConnect();
    expect(socket.lastEmitted('room:join').args[0]).toMatchObject({
      media: { audio: false, video: false },
    });
  });

  it('stops tracks from a late answer and does not connect twice', async () => {
    const t = setup();
    t.devices.deferNext();
    t.session.join('room1', 'Алекс');
    await flushMicrotasks();
    t.session.joinWithoutMedia();

    t.devices.pending[0]!.grant();
    await flushMicrotasks();

    expect(t.sockets).toHaveLength(1);
    expect(t.devices.createdTracks).toHaveLength(2);
    expect(t.liveTracks()).toEqual([]);
    expect(t.getState().localMedia).toMatchObject({ audio: 'off', video: 'off' });
    expect(t.types().filter((type) => type === 'JOIN_CONNECTING')).toHaveLength(1);
  });

  it('lets the user turn the camera on later even if the prompt never gets an answer', async () => {
    const t = setup();
    t.devices.deferNext();
    t.session.join('room1', 'Алекс');
    await flushMicrotasks();
    t.session.joinWithoutMedia();
    const socket = t.lastSocket();
    socket.serverConnect();
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [alex], messages: [] });

    t.session.toggleVideo();
    await flushMicrotasks();

    expect(t.getState().localMedia.video).toBe('on');
    expect(t.mediaUpdates(socket)).toEqual([{ audio: false, video: true }]);
  });

  it('does nothing when not waiting for media', async () => {
    const t = setup();
    t.session.joinWithoutMedia();
    expect(t.actions).toEqual([]);

    await t.startJoin();
    t.session.joinWithoutMedia();
    expect(t.sockets).toHaveLength(1);
  });
});

describe('RoomSession: publishing media state', () => {
  it('toggleAudio sends media:update and PARTICIPANT_MEDIA is not needed for self', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    t.session.toggleAudio();
    await flushMicrotasks();

    expect(t.tracks().audio?.enabled).toBe(false);
    expect(t.getState().localMedia.audio).toBe('off');
    expect(t.mediaUpdates(socket)).toEqual([{ audio: false, video: true }]);

    t.session.toggleAudio();
    await flushMicrotasks();
    expect(t.mediaUpdates(socket)).toEqual([
      { audio: false, video: true },
      { audio: true, video: true },
    ]);
  });

  it('toggleVideo turns the camera off and on; acquiring does not produce a duplicate', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    const firstVideo = t.tracks().video;

    t.session.toggleVideo();
    await flushMicrotasks();
    expect(firstVideo?.readyState).toBe('ended');
    expect(t.getState().localMedia.video).toBe('off');

    t.session.toggleVideo();
    await flushMicrotasks();
    expect(t.getState().localMedia.video).toBe('on');

    // off → acquiring (публично то же false) → on: ровно два сообщения.
    expect(t.mediaUpdates(socket)).toEqual([
      { audio: true, video: false },
      { audio: true, video: true },
    ]);
  });

  it('bumps videoTrackVersion when the video track changes', async () => {
    const t = setup();
    await t.joinSuccessfully();

    t.session.toggleVideo();
    await flushMicrotasks();
    t.session.toggleVideo();
    await flushMicrotasks();

    expect(t.getState().localMedia.videoTrackVersion).toBe(2);
  });

  it('deduplicates by the last sent state', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    t.session.publishMediaState({ audio: true, video: true }); // совпадает с room:join
    t.session.publishMediaState({ audio: false, video: true });
    t.session.publishMediaState({ audio: false, video: true });

    expect(t.mediaUpdates(socket)).toEqual([{ audio: false, video: true }]);
  });

  it('does not send media:update before joined or after leaving', async () => {
    const t = setup();
    t.session.publishMediaState({ audio: false, video: false });

    const socket = await t.startJoin();
    socket.serverConnect();
    t.session.publishMediaState({ audio: false, video: false });
    expect(t.mediaUpdates(socket)).toEqual([]);

    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [alex], messages: [] });
    t.session.leave();
    t.session.publishMediaState({ audio: false, video: false });
    expect(t.mediaUpdates(socket)).toEqual([]);
  });

  it('sends the difference right after JOIN_SUCCEEDED if the state changed during joining', async () => {
    const t = setup();
    const socket = await t.startJoin();
    socket.serverConnect();
    const command = socket.lastEmitted('room:join');
    expect(command.args[0]).toMatchObject({ media: ALL_ON });

    // Камера пропала между room:join и ack.
    t.tracks().video!.dispatchEnded();
    await flushMicrotasks();
    expect(t.mediaUpdates(socket)).toEqual([]);

    command.respond({ ok: true, self: alex, participants: [alex], messages: [] });

    expect(t.mediaUpdates(socket)).toEqual([{ audio: true, video: false }]);
  });

  it('toggles are ignored outside joined', async () => {
    const t = setup();
    t.session.toggleAudio();
    t.session.toggleVideo();
    await flushMicrotasks();

    expect(t.devices.getUserMedia).not.toHaveBeenCalled();
  });

  it('dispatches participant:media as PARTICIPANT_MEDIA_CHANGED', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    socket.serverEmit('participant:media', {
      participantId: maria.id,
      media: { audio: false, video: true },
    });

    expect(t.actions.at(-1)).toEqual({
      type: 'PARTICIPANT_MEDIA_CHANGED',
      participantId: maria.id,
      media: { audio: false, video: true },
    });
    expect(t.getState().participantsById[maria.id]?.media).toEqual({ audio: false, video: true });
  });

  it('ignores participant:media of a stale socket', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    t.session.leave();
    const count = t.actions.length;

    socket.serverEmit('participant:media', { participantId: maria.id, media: ALL_ON });

    expect(t.actions).toHaveLength(count);
  });
});

describe('RoomSession: connection loss', () => {
  it.each(['transport close', 'ping timeout', 'io server disconnect', 'transport error'])(
    'disconnect(%s) in joined → CONNECTION_LOST and devices are released',
    async (reason) => {
      const t = setup();
      const socket = await t.joinSuccessfully();

      socket.serverDisconnect(reason);

      expect(t.actions.at(-1)).toEqual({ type: 'CONNECTION_LOST' });
      expect(t.getState().phase).toEqual({ kind: 'connection-lost' });
      expect(t.liveTracks()).toEqual([]);
    },
  );

  it('ignores events of the lost socket and allows joining again', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    socket.serverDisconnect();
    const count = t.actions.length;

    socket.serverEmit('participant:joined', { participant: boris });
    expect(t.actions).toHaveLength(count);

    await t.joinSuccessfully();
    expect(t.sockets).toHaveLength(2);
  });
});

describe('RoomSession.leave', () => {
  it('in joined: releases devices, dispatches LEFT_ROOM, sends room:leave and disconnects after the ack', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    t.session.leave();

    expect(t.actions.at(-1)).toEqual({ type: 'LEFT_ROOM' });
    expect(t.session.roomId).toBeNull();
    expect(t.liveTracks()).toEqual([]);
    expect(t.getState().localMedia).toMatchObject({ audio: 'off', video: 'off' });
    const command = socket.lastEmitted('room:leave');
    expect(socket.connected).toBe(true);

    command.respond({ ok: true });

    expect(socket.connected).toBe(false);
    // Отключение по нашей инициативе не считается обрывом.
    expect(t.types()).not.toContain('CONNECTION_LOST');
    // Статусы off после выхода серверу уже не отправляются.
    expect(t.mediaUpdates(socket)).toEqual([]);
  });

  it('disconnects after LEAVE_ACK_TIMEOUT_MS if the ack never comes', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    t.session.leave();

    vi.advanceTimersByTime(LEAVE_ACK_TIMEOUT_MS - 1);
    expect(socket.connected).toBe(true);
    vi.advanceTimersByTime(1);

    expect(socket.connected).toBe(false);
  });

  it('ignores events that arrive after leaving', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    t.session.leave();
    const count = t.actions.length;

    socket.serverEmit('participant:joined', { participant: boris });
    socket.serverDisconnect();

    expect(t.actions).toHaveLength(count);
  });

  it('while acquiring media: stops late tracks and never connects', async () => {
    const t = setup();
    t.devices.deferNext();
    t.session.join('room1', 'Алекс');
    await flushMicrotasks();

    t.session.leave();
    t.devices.pending[0]!.grant();
    await flushMicrotasks();

    expect(t.types()).toEqual(['JOIN_REQUESTED', 'LEFT_ROOM']);
    expect(t.sockets).toEqual([]);
    expect(t.liveTracks()).toEqual([]);
    expect(t.getState().localMedia).toMatchObject({ audio: 'off', video: 'off' });
  });

  it('leave and a new join during a pending capture: only the new join connects', async () => {
    const t = setup();
    t.devices.deferNext();
    t.session.join('room1', 'Алекс');
    await flushMicrotasks();
    t.session.leave();

    const socket = await t.startJoin('room2', 'Алекс');
    t.devices.pending[0]!.grant();
    await flushMicrotasks();

    expect(t.sockets).toEqual([socket]);
    socket.serverConnect();
    expect(socket.lastEmitted('room:join').args[0]).toMatchObject({ roomId: 'room2' });
    expect(t.liveTracks()).toHaveLength(2);
  });

  it('while connecting: disconnects at once and ignores the late connect', async () => {
    const t = setup();
    const socket = await t.startJoin();

    t.session.leave();

    expect(t.types()).toEqual(['JOIN_REQUESTED', 'JOIN_CONNECTING', 'LEFT_ROOM']);
    expect(socket.disconnectCalls).toBe(1);
    socket.serverConnect();
    expect(socket.emitted).toEqual([]);
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(t.types()).toEqual(['JOIN_REQUESTED', 'JOIN_CONNECTING', 'LEFT_ROOM']);
  });

  it('from an error screen: resets state to idle', async () => {
    const t = setup();
    const socket = await t.startJoin();
    socket.serverConnectError();

    t.session.leave();

    expect(t.getState()).toMatchObject({
      phase: { kind: 'idle' },
      roomId: null,
      displayName: 'Алекс',
    });
  });
});

describe('RoomSession.handlePageHide', () => {
  it('in joined: disconnects, releases devices and dispatches CONNECTION_LOST', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    t.session.handlePageHide();

    expect(socket.connected).toBe(false);
    expect(t.liveTracks()).toEqual([]);
    expect(t.actions.at(-1)).toEqual({ type: 'CONNECTION_LOST' });
  });

  it('while joining: disconnects and dispatches JOIN_FAILED(SERVER_UNAVAILABLE)', async () => {
    const t = setup();
    const socket = await t.startJoin();

    t.session.handlePageHide();

    expect(socket.disconnectCalls).toBe(1);
    expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
  });

  it('in idle: does nothing', () => {
    const t = setup();
    t.session.handlePageHide();
    expect(t.actions).toEqual([]);
  });
});

describe('RoomSession.dispose', () => {
  it('disconnects and releases devices without session actions, allows joining again', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    const types = t.types();

    t.session.dispose();

    expect(socket.connected).toBe(false);
    expect(t.liveTracks()).toEqual([]);
    expect(t.types()).toEqual(types);
    // Session снова в idle; reducer всё ещё в joined, поэтому смотрим на сам сокет.
    await t.startJoin();
    expect(t.sockets).toHaveLength(2);
  });
});

describe('RoomSession: chat', () => {
  it('puts the history from the join ack into state', async () => {
    const t = setup();
    await t.joinSuccessfully([maria, alex], [joinedMaria, helloFromMaria]);

    expect(t.getState().chat.messages).toEqual([joinedMaria, helloFromMaria]);
  });

  it('dispatches chat:message as CHAT_MESSAGE_RECEIVED', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    socket.serverEmit('chat:message', { message: helloFromMaria });

    expect(t.actions.at(-1)).toEqual({ type: 'CHAT_MESSAGE_RECEIVED', message: helloFromMaria });
    expect(t.getState().chat.messages).toEqual([helloFromMaria]);
  });

  it('ignores chat:message of a stale socket', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    t.session.leave();
    const count = t.actions.length;

    socket.serverEmit('chat:message', { message: helloFromMaria });

    expect(t.actions).toHaveLength(count);
  });

  describe('sendChatMessage', () => {
    it('emits chat:send and resolves true on ok without dispatching', async () => {
      const t = setup();
      const socket = await t.joinSuccessfully();
      const count = t.actions.length;

      const result = t.session.sendChatMessage('Привет');
      const command = socket.lastEmitted('chat:send');
      expect(command.args).toEqual([{ text: 'Привет' }]);
      command.respond({ ok: true, messageId: 'm-9' });

      await expect(result).resolves.toBe(true);
      expect(t.actions).toHaveLength(count);
    });

    it.each<[ServerErrorCode, string]>([
      ['INVALID_MESSAGE', 'Сообщение пустое или слишком длинное'],
      ['RATE_LIMITED', 'Слишком часто. Подождите секунду'],
      ['INTERNAL', 'Не удалось отправить сообщение'],
    ])('%s → resolves false and shows «%s»', async (code, text) => {
      const t = setup();
      const socket = await t.joinSuccessfully();

      const result = t.session.sendChatMessage('x');
      socket.lastEmitted('chat:send').respond({ ok: false, error: { code } });

      await expect(result).resolves.toBe(false);
      expect(t.actions.at(-1)).toMatchObject({ type: 'CHAT_SEND_FAILED' });
      expect(t.getState().notice).toMatchObject({ text, tone: 'error' });
    });

    it('NOT_IN_ROOM → resolves false silently', async () => {
      const t = setup();
      const socket = await t.joinSuccessfully();

      const result = t.session.sendChatMessage('x');
      socket.lastEmitted('chat:send').respond({ ok: false, error: { code: 'NOT_IN_ROOM' } });

      await expect(result).resolves.toBe(false);
      expect(t.getState().notice).toBeNull();
    });

    it('ack timeout → CHAT_SEND_FAILED(TIMEOUT); a late ack is ignored', async () => {
      const t = setup();
      const socket = await t.joinSuccessfully();

      const result = t.session.sendChatMessage('x');
      const command = socket.lastEmitted('chat:send');
      vi.advanceTimersByTime(ACK_TIMEOUT_MS - 1);
      expect(t.types()).not.toContain('CHAT_SEND_FAILED');
      vi.advanceTimersByTime(1);

      await expect(result).resolves.toBe(false);
      expect(t.actions.at(-1)).toEqual({ type: 'CHAT_SEND_FAILED', code: 'TIMEOUT' });
      expect(t.getState().notice).toMatchObject({ text: 'Не удалось отправить сообщение' });

      const count = t.actions.length;
      command.respond({ ok: true, messageId: 'late' });
      expect(t.actions).toHaveLength(count);
    });

    it('resolves false without emitting when not joined', async () => {
      const t = setup();
      await expect(t.session.sendChatMessage('x')).resolves.toBe(false);

      const socket = await t.startJoin();
      socket.serverConnect();
      await expect(t.session.sendChatMessage('x')).resolves.toBe(false);
      expect(socket.emitted.map((c) => c.event)).toEqual(['room:join']);
    });

    it('does not show a notice for an ack that arrives after leaving', async () => {
      const t = setup();
      const socket = await t.joinSuccessfully();
      const result = t.session.sendChatMessage('x');
      t.session.leave();
      const count = t.actions.length;

      vi.advanceTimersByTime(ACK_TIMEOUT_MS);

      await expect(result).resolves.toBe(false);
      expect(t.actions).toHaveLength(count);
      expect(socket.lastEmitted('chat:send')).toBeDefined();
    });
  });

  it.each<[ServerErrorCode, ChatSendFailure]>([
    ['INVALID_MESSAGE', 'INVALID_MESSAGE'],
    ['RATE_LIMITED', 'RATE_LIMITED'],
    ['NOT_IN_ROOM', 'NOT_IN_ROOM'],
    ['INTERNAL', 'INTERNAL'],
    ['INVALID_PAYLOAD', 'INTERNAL'],
    ['INVALID_NAME', 'INTERNAL'],
    ['INVALID_ROOM_ID', 'INTERNAL'],
    ['ALREADY_JOINED', 'INTERNAL'],
    ['ROOM_FULL', 'INTERNAL'],
  ])('mapChatSendError(%s) → %s', (code, failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mapChatSendError(code)).toBe(failure);
  });
});

describe('RoomSession: WebRTC peers (stage 4)', () => {
  const OFFER: SignalData = { type: 'offer', sdp: fakeOfferSdp() };
  const ANSWER: SignalData = { type: 'answer', sdp: 'v=0\r\ns=answer\r\n' };

  const signals = (socket: FakeSocket) =>
    socket.emitted.filter((c) => c.event === 'signal').map((c) => c.args[0]);
  const peerActions = (actions: AppAction[]) =>
    actions.filter((a) => a.type === 'PEER_STATUS_CHANGED');

  it('JOIN_SUCCEEDED → connecting for every remote participant, no connection yet', async () => {
    const t = setup();

    await t.joinSuccessfully([maria, boris, alex]);

    expect(peerActions(t.actions)).toEqual([
      { type: 'PEER_STATUS_CHANGED', participantId: maria.id, status: 'connecting' },
      { type: 'PEER_STATUS_CHANGED', participantId: boris.id, status: 'connecting' },
    ]);
    expect(t.getState().peers).toEqual({
      [maria.id]: { status: 'connecting' },
      [boris.id]: { status: 'connecting' },
    });
    // Я вошёл последним — только отвечаю (I1), сессии создаются по offer.
    expect(t.pcs.instances).toEqual([]);
  });

  it('participant:joined → offerer: connecting, then an offer to the newcomer over the socket', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    socket.serverEmit('participant:joined', { participant: boris });
    await flushMicrotasks();

    expect(t.getState().peers[boris.id]).toEqual({ status: 'connecting' });
    expect(t.pcs.instances).toHaveLength(1);
    expect(t.pcs.last.configuration).toMatchObject({
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    expect(signals(socket)).toEqual([
      { to: boris.id, data: { type: 'offer', sdp: t.pcs.last.localDescription!.sdp } },
    ]);

    socket.serverEmit('signal', { from: boris.id, data: ANSWER });
    await flushMicrotasks();
    expect(t.pcs.last.remoteDescription).toMatchObject({ type: 'answer' });
  });

  it('offer from an old-timer → answerer with local tracks, answer back to the sender', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();

    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    await flushMicrotasks();

    const pc = t.pcs.last;
    expect(pc.getTransceivers().map((tx) => tx.sender.track)).toEqual([
      t.tracks().audio,
      t.tracks().video,
    ]);
    expect(signals(socket)).toEqual([
      { to: maria.id, data: { type: 'answer', sdp: pc.localDescription!.sdp } },
    ]);
    expect(t.session.peers.getRemoteStream(maria.id)).not.toBeNull();
  });

  it('forwards ICE status changes to state', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    await flushMicrotasks();

    t.pcs.last.setIceConnectionState('connected');
    expect(t.getState().peers[maria.id]).toEqual({ status: 'connected' });
    t.pcs.last.setIceConnectionState('disconnected');
    expect(t.getState().peers[maria.id]).toEqual({ status: 'unstable' });
  });

  it('participant:left closes the connection and removes the peer from state', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    await flushMicrotasks();
    const pc = t.pcs.last;

    socket.serverEmit('participant:left', { participantId: maria.id });

    expect(pc.signalingState).toBe('closed');
    expect(t.getState().peers).toEqual({});
    expect(t.session.peers.getRemoteStream(maria.id)).toBeNull();
    expect(peerActions(t.actions).map((a) => a.status)).not.toContain('closed');
  });

  it('camera off detaches the track from the connection before stopping it', async () => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    await flushMicrotasks();
    const camera = t.tracks().video!;
    const videoTx = t.pcs.last.getTransceivers()[1]!;
    const replace = vi.spyOn(videoTx.sender, 'replaceTrack');

    t.session.toggleVideo();
    await flushMicrotasks();

    expect(replace).toHaveBeenCalledWith(null);
    expect(videoTx.sender.track).toBeNull();
    expect(replace.mock.invocationCallOrder[0]).toBeLessThan(
      camera.stop.mock.invocationCallOrder[0]!,
    );
    expect(t.pcs.instances).toHaveLength(1);
    expect(signals(socket).map((s) => (s as { data: SignalData }).data.type)).toEqual(['answer']);
  });

  it('ignores signal and participant:joined before the join ack', async () => {
    const t = setup();
    const socket = await t.startJoin();
    socket.serverConnect();

    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    socket.serverEmit('participant:joined', { participant: boris });
    await flushMicrotasks();

    expect(t.pcs.instances).toEqual([]);
  });

  it('ignores signals after leaving and from a stale socket', async () => {
    const t = setup();
    const first = await t.joinSuccessfully();
    first.serverDisconnect();
    first.serverEmit('signal', { from: maria.id, data: OFFER });

    const second = await t.joinSuccessfully();
    t.session.leave();
    second.serverEmit('signal', { from: maria.id, data: OFFER });
    second.serverEmit('participant:joined', { participant: boris });
    await flushMicrotasks();

    expect(t.pcs.instances).toEqual([]);
  });

  it.each<[string, (t: ReturnType<typeof setup>, socket: FakeSocket) => void]>([
    ['leave()', (t) => t.session.leave()],
    ['connection loss', (_t, socket) => socket.serverDisconnect()],
    ['pagehide', (t) => t.session.handlePageHide()],
  ])('%s closes all connections before releasing devices', async (_label, exit) => {
    const t = setup();
    const socket = await t.joinSuccessfully();
    socket.serverEmit('signal', { from: maria.id, data: OFFER });
    socket.serverEmit('participant:joined', { participant: boris });
    await flushMicrotasks();
    const [answerer, offerer] = t.pcs.instances;
    const close = vi.spyOn(offerer!, 'close');
    const camera = t.tracks().video!;

    exit(t, socket);

    expect(answerer!.signalingState).toBe('closed');
    expect(offerer!.signalingState).toBe('closed');
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      camera.stop.mock.invocationCallOrder[0]!,
    );
    expect(t.getState().peers).toEqual({});
    expect(t.session.peers.getRemoteStream(maria.id)).toBeNull();
  });

  it('works again after leaving: a new join creates new connections', async () => {
    const t = setup();
    const first = await t.joinSuccessfully();
    first.serverEmit('participant:joined', { participant: boris });
    await flushMicrotasks();
    t.session.leave();

    const second = await t.joinSuccessfully();
    second.serverEmit('participant:joined', { participant: boris });
    await flushMicrotasks();
    // Подписка на смену треков восстановлена: выключение камеры доходит до нового соединения.
    t.session.toggleVideo();
    await flushMicrotasks();

    expect(t.pcs.instances).toHaveLength(2);
    expect(t.pcs.last.getTransceivers()[1]!.sender.track).toBeNull();
    expect(signals(second)).toHaveLength(1);
  });
});

describe('shouldLeaveOnNavigation', () => {
  it.each<[string, string | null, boolean]>([
    ['/', 'room1', true],
    ['/r/room2', 'room1', true],
    ['/r/<bad>', 'room1', true],
    ['/r/room1', 'room1', false],
    ['/', null, false],
    ['/r/room1', null, false],
  ])('pathname %s with session room %s → %s', (pathname, roomId, expected) => {
    expect(shouldLeaveOnNavigation(pathname, roomId)).toBe(expected);
  });
});
