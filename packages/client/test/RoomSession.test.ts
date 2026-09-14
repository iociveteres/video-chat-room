import {
  ACK_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  type ChatMessage,
  type ParticipantDTO,
  type ServerErrorCode,
} from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_ACK_TIMEOUT_MS, mapChatSendError, RoomSession } from '../src/session/RoomSession';
import { shouldLeaveOnNavigation } from '../src/session/navigation';
import type { AppAction, ChatSendFailure, JoinFailure } from '../src/state/actions';
import { appReducer, initialAppState, type AppState } from '../src/state/appReducer';
import { selectParticipants } from '../src/state/selectors';
import { FakeSocket } from './helpers/FakeSocket';

const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 1_000 };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 2_000 };
const boris: ParticipantDTO = { id: 'p-boris', name: 'Борис', joinedAt: 3_000 };

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

function setup() {
  const actions: AppAction[] = [];
  let state: AppState = initialAppState;
  const sockets: FakeSocket[] = [];
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
  });

  const lastSocket = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket created');
    return socket;
  };

  /** Проводит вход до успешного ack. */
  const joinSuccessfully = (
    participants: ParticipantDTO[] = [maria, alex],
    messages: ChatMessage[] = [],
  ) => {
    session.join('room1', 'Алекс');
    const socket = lastSocket();
    socket.serverConnect();
    socket.lastEmitted('room:join').respond({ ok: true, self: alex, participants, messages });
    return socket;
  };

  return {
    session,
    actions,
    sockets,
    lastSocket,
    joinSuccessfully,
    getState: () => state,
    types: () => actions.map((a) => a.type),
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
  it('connects, sends room:join and dispatches JOIN_SUCCEEDED', () => {
    const t = setup();

    t.session.join('room1', 'Алекс');

    expect(t.actions).toEqual([{ type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' }]);
    const socket = t.lastSocket();
    expect(socket.connectCalls).toBe(1);
    expect(socket.emitted).toEqual([]);

    socket.serverConnect();
    const command = socket.lastEmitted('room:join');
    expect(command.args).toEqual([{ roomId: 'room1', name: 'Алекс' }]);

    command.respond({ ok: true, self: alex, participants: [maria, alex], messages: [joinedMaria] });

    expect(t.actions.at(-1)).toEqual({
      type: 'JOIN_SUCCEEDED',
      self: alex,
      participants: [maria, alex],
      messages: [joinedMaria],
    });
    expect(t.getState().phase).toEqual({ kind: 'joined' });
    expect(t.session.roomId).toBe('room1');
  });

  it('subscribes to all events before connect()', () => {
    const t = setup();
    t.session.join('room1', 'Алекс');

    expect(t.lastSocket().listenersAtConnect).toEqual(
      expect.arrayContaining([
        'participant:joined',
        'participant:left',
        'chat:message',
        'connect_error',
        'disconnect',
        'connect',
      ]),
    );
  });

  it('dispatches participant events after joining', () => {
    const t = setup();
    const socket = t.joinSuccessfully();

    socket.serverEmit('participant:joined', { participant: boris });
    socket.serverEmit('participant:left', { participantId: maria.id });

    expect(t.actions.slice(-2)).toEqual([
      { type: 'PARTICIPANT_JOINED', participant: boris },
      { type: 'PARTICIPANT_LEFT', participantId: maria.id },
    ]);
    expect(selectParticipants(t.getState())).toEqual([alex, boris]);
  });

  it('keeps ack and a following event in order (no "ghost" participants)', () => {
    const t = setup();
    t.session.join('room1', 'Алекс');
    const socket = t.lastSocket();
    socket.serverConnect();

    // Ack и participant:left пришли одной пачкой и обрабатываются синхронно друг за другом.
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [maria, alex], messages: [] });
    socket.serverEmit('participant:left', { participantId: maria.id });

    expect(selectParticipants(t.getState())).toEqual([alex]);
  });

  it('ignores a second join while joining (double click)', () => {
    const t = setup();
    t.session.join('room1', 'Алекс');
    t.session.join('room1', 'Алекс');

    expect(t.sockets).toHaveLength(1);
    expect(t.types()).toEqual(['JOIN_REQUESTED']);
  });

  it('ignores join while already joined', () => {
    const t = setup();
    t.joinSuccessfully();
    t.session.join('room2', 'Алекс');

    expect(t.sockets).toHaveLength(1);
    expect(t.session.roomId).toBe('room1');
  });

  describe('failures', () => {
    it('ROOM_FULL → JOIN_FAILED(ROOM_FULL) and disconnect', () => {
      const t = setup();
      t.session.join('room1', 'Алекс');
      const socket = t.lastSocket();
      socket.serverConnect();

      socket.lastEmitted('room:join').respond({ ok: false, error: { code: 'ROOM_FULL' } });

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'ROOM_FULL' });
      expect(socket.connected).toBe(false);
      expect(t.getState()).toMatchObject({ displayName: 'Алекс', roomId: 'room1' });
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
    ])('maps %s to JOIN_FAILED(%s)', (code, reason) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const t = setup();
      t.session.join('room1', 'Алекс');
      t.lastSocket().serverConnect();

      t.lastSocket().lastEmitted('room:join').respond({ ok: false, error: { code } });

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason });
    });

    it('connect_error → SERVER_UNAVAILABLE', () => {
      const t = setup();
      t.session.join('room1', 'Алекс');

      t.lastSocket().serverConnectError();

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      expect(t.lastSocket().disconnectCalls).toBe(1);
    });

    it('connect timeout → SERVER_UNAVAILABLE; a late connect sends nothing', () => {
      const t = setup();
      t.session.join('room1', 'Алекс');
      const socket = t.lastSocket();

      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
      expect(t.types()).toEqual(['JOIN_REQUESTED']);
      vi.advanceTimersByTime(1);

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      socket.serverConnect();
      expect(socket.emitted).toEqual([]);
    });

    it('does not fire the connect timeout after a successful join', () => {
      const t = setup();
      t.joinSuccessfully();

      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + ACK_TIMEOUT_MS);

      expect(t.types()).toEqual(['JOIN_REQUESTED', 'JOIN_SUCCEEDED']);
    });

    it('ack timeout → SERVER_UNAVAILABLE; a late ack is ignored', () => {
      const t = setup();
      t.session.join('room1', 'Алекс');
      const socket = t.lastSocket();
      socket.serverConnect();
      const command = socket.lastEmitted('room:join');

      vi.advanceTimersByTime(ACK_TIMEOUT_MS);

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      command.respond({ ok: true, self: alex, participants: [alex], messages: [] });
      expect(t.getState().phase).toEqual({ kind: 'failed', reason: 'SERVER_UNAVAILABLE' });
    });

    it('server disconnect while joining → SERVER_UNAVAILABLE', () => {
      const t = setup();
      t.session.join('room1', 'Алекс');
      t.lastSocket().serverConnect();

      t.lastSocket().serverDisconnect('transport close');

      expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
    });

    it('a retry after a failure uses a new socket', () => {
      const t = setup();
      t.session.join('room1', 'Алекс');
      t.lastSocket().serverConnectError();

      t.joinSuccessfully();

      expect(t.sockets).toHaveLength(2);
      expect(t.getState().phase).toEqual({ kind: 'joined' });
    });
  });
});

describe('RoomSession: connection loss', () => {
  it.each(['transport close', 'ping timeout', 'io server disconnect', 'transport error'])(
    'disconnect(%s) in joined → CONNECTION_LOST',
    (reason) => {
      const t = setup();
      const socket = t.joinSuccessfully();

      socket.serverDisconnect(reason);

      expect(t.actions.at(-1)).toEqual({ type: 'CONNECTION_LOST' });
      expect(t.getState().phase).toEqual({ kind: 'connection-lost' });
    },
  );

  it('ignores events of the lost socket and allows joining again', () => {
    const t = setup();
    const socket = t.joinSuccessfully();
    socket.serverDisconnect();
    const count = t.actions.length;

    socket.serverEmit('participant:joined', { participant: boris });
    expect(t.actions).toHaveLength(count);

    t.joinSuccessfully();
    expect(t.sockets).toHaveLength(2);
  });
});

describe('RoomSession.leave', () => {
  it('in joined: dispatches LEFT_ROOM, sends room:leave and disconnects after the ack', () => {
    const t = setup();
    const socket = t.joinSuccessfully();

    t.session.leave();

    expect(t.actions.at(-1)).toEqual({ type: 'LEFT_ROOM' });
    expect(t.session.roomId).toBeNull();
    const command = socket.lastEmitted('room:leave');
    expect(socket.connected).toBe(true);

    command.respond({ ok: true });

    expect(socket.connected).toBe(false);
    // Отключение по нашей инициативе не считается обрывом.
    expect(t.types()).not.toContain('CONNECTION_LOST');
  });

  it('disconnects after LEAVE_ACK_TIMEOUT_MS if the ack never comes', () => {
    const t = setup();
    const socket = t.joinSuccessfully();
    t.session.leave();

    vi.advanceTimersByTime(LEAVE_ACK_TIMEOUT_MS - 1);
    expect(socket.connected).toBe(true);
    vi.advanceTimersByTime(1);

    expect(socket.connected).toBe(false);
  });

  it('ignores events that arrive after leaving', () => {
    const t = setup();
    const socket = t.joinSuccessfully();
    t.session.leave();
    const count = t.actions.length;

    socket.serverEmit('participant:joined', { participant: boris });
    socket.serverDisconnect();

    expect(t.actions).toHaveLength(count);
  });

  it('while joining: disconnects at once and ignores the late connect', () => {
    const t = setup();
    t.session.join('room1', 'Алекс');
    const socket = t.lastSocket();

    t.session.leave();

    expect(t.types()).toEqual(['JOIN_REQUESTED', 'LEFT_ROOM']);
    expect(socket.disconnectCalls).toBe(1);
    socket.serverConnect();
    expect(socket.emitted).toEqual([]);
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(t.types()).toEqual(['JOIN_REQUESTED', 'LEFT_ROOM']);
  });

  it('from an error screen: resets state to idle', () => {
    const t = setup();
    t.session.join('room1', 'Алекс');
    t.lastSocket().serverConnectError();

    t.session.leave();

    expect(t.getState()).toMatchObject({
      phase: { kind: 'idle' },
      roomId: null,
      displayName: 'Алекс',
    });
  });
});

describe('RoomSession.handlePageHide', () => {
  it('in joined: disconnects and dispatches CONNECTION_LOST', () => {
    const t = setup();
    const socket = t.joinSuccessfully();

    t.session.handlePageHide();

    expect(socket.connected).toBe(false);
    expect(t.actions.at(-1)).toEqual({ type: 'CONNECTION_LOST' });
  });

  it('while joining: disconnects and dispatches JOIN_FAILED(SERVER_UNAVAILABLE)', () => {
    const t = setup();
    t.session.join('room1', 'Алекс');

    t.session.handlePageHide();

    expect(t.lastSocket().disconnectCalls).toBe(1);
    expect(t.actions.at(-1)).toEqual({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
  });

  it('in idle: does nothing', () => {
    const t = setup();
    t.session.handlePageHide();
    expect(t.actions).toEqual([]);
  });
});

describe('RoomSession.dispose', () => {
  it('disconnects without dispatching and allows joining again', () => {
    const t = setup();
    const socket = t.joinSuccessfully();
    const count = t.actions.length;

    t.session.dispose();

    expect(socket.connected).toBe(false);
    expect(t.actions).toHaveLength(count);
    // Session снова в idle; reducer всё ещё в joined, поэтому смотрим на сам сокет.
    t.session.join('room1', 'Алекс');
    expect(t.sockets).toHaveLength(2);
  });
});

describe('RoomSession: chat', () => {
  it('puts the history from the join ack into state', () => {
    const t = setup();
    t.joinSuccessfully([maria, alex], [joinedMaria, helloFromMaria]);

    expect(t.getState().chat.messages).toEqual([joinedMaria, helloFromMaria]);
  });

  it('dispatches chat:message as CHAT_MESSAGE_RECEIVED', () => {
    const t = setup();
    const socket = t.joinSuccessfully();

    socket.serverEmit('chat:message', { message: helloFromMaria });

    expect(t.actions.at(-1)).toEqual({ type: 'CHAT_MESSAGE_RECEIVED', message: helloFromMaria });
    expect(t.getState().chat.messages).toEqual([helloFromMaria]);
  });

  it('ignores chat:message of a stale socket', () => {
    const t = setup();
    const socket = t.joinSuccessfully();
    t.session.leave();
    const count = t.actions.length;

    socket.serverEmit('chat:message', { message: helloFromMaria });

    expect(t.actions).toHaveLength(count);
  });

  describe('sendChatMessage', () => {
    it('emits chat:send and resolves true on ok without dispatching', async () => {
      const t = setup();
      const socket = t.joinSuccessfully();
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
      const socket = t.joinSuccessfully();

      const result = t.session.sendChatMessage('x');
      socket.lastEmitted('chat:send').respond({ ok: false, error: { code } });

      await expect(result).resolves.toBe(false);
      expect(t.actions.at(-1)).toMatchObject({ type: 'CHAT_SEND_FAILED' });
      expect(t.getState().notice).toMatchObject({ text, tone: 'error' });
    });

    it('NOT_IN_ROOM → resolves false silently', async () => {
      const t = setup();
      const socket = t.joinSuccessfully();

      const result = t.session.sendChatMessage('x');
      socket.lastEmitted('chat:send').respond({ ok: false, error: { code: 'NOT_IN_ROOM' } });

      await expect(result).resolves.toBe(false);
      expect(t.getState().notice).toBeNull();
    });

    it('ack timeout → CHAT_SEND_FAILED(TIMEOUT); a late ack is ignored', async () => {
      const t = setup();
      const socket = t.joinSuccessfully();

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

      t.session.join('room1', 'Алекс');
      t.lastSocket().serverConnect();
      await expect(t.session.sendChatMessage('x')).resolves.toBe(false);
      expect(t.lastSocket().emitted.map((c) => c.event)).toEqual(['room:join']);
    });

    it('does not show a notice for an ack that arrives after leaving', async () => {
      const t = setup();
      const socket = t.joinSuccessfully();
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
