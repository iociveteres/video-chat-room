import { CHAT_HISTORY_LIMIT, type ChatMessage, type ParticipantDTO } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import type { AppAction, ChatSendFailure } from '../src/state/actions';
import { appReducer, initialAppState, type AppState } from '../src/state/appReducer';

const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 1_000 };

function userMessage(n: number): ChatMessage {
  return {
    kind: 'user',
    id: `m-${n}`,
    ts: 10_000 + n,
    authorId: alex.id,
    authorName: alex.name,
    text: `#${n}`,
  };
}

const joinedAlex: ChatMessage = {
  kind: 'system',
  id: 'm-joined',
  ts: 9_000,
  event: 'participant-joined',
  participantId: alex.id,
  participantName: alex.name,
};

function reduce(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

const joining = reduce(initialAppState, { type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' });

function joinWith(messages: ChatMessage[]): AppState {
  return appReducer(joining, {
    type: 'JOIN_SUCCEEDED',
    self: alex,
    participants: [alex],
    messages,
  });
}

const received = (message: ChatMessage): AppAction => ({ type: 'CHAT_MESSAGE_RECEIVED', message });

function ids(state: AppState): string[] {
  return state.chat.messages.map((m) => m.id);
}

describe('appReducer: chat', () => {
  describe('JOIN_SUCCEEDED', () => {
    it('replaces the chat with the history from the ack', () => {
      const state = joinWith([joinedAlex, userMessage(1)]);

      expect(state.chat).toEqual({
        messages: [joinedAlex, userMessage(1)],
        messageIds: { [joinedAlex.id]: true, 'm-1': true },
      });
    });

    it('drops duplicate ids from the history', () => {
      const state = joinWith([userMessage(1), userMessage(2), userMessage(1)]);
      expect(ids(state)).toEqual(['m-1', 'm-2']);
    });

    it(`keeps only the last ${CHAT_HISTORY_LIMIT} messages of an oversized history`, () => {
      const history = Array.from({ length: CHAT_HISTORY_LIMIT + 5 }, (_, i) => userMessage(i + 1));

      const state = joinWith(history);

      expect(state.chat.messages).toHaveLength(CHAT_HISTORY_LIMIT);
      expect(state.chat.messages[0]).toEqual(userMessage(6));
      expect(Object.keys(state.chat.messageIds)).toHaveLength(CHAT_HISTORY_LIMIT);
    });
  });

  describe('CHAT_MESSAGE_RECEIVED', () => {
    it('appends a new message in joined', () => {
      const state = reduce(
        joinWith([joinedAlex]),
        received(userMessage(1)),
        received(userMessage(2)),
      );

      expect(ids(state)).toEqual([joinedAlex.id, 'm-1', 'm-2']);
      expect(state.chat.messageIds).toEqual({ [joinedAlex.id]: true, 'm-1': true, 'm-2': true });
    });

    it('ignores an already known id (returns the same state)', () => {
      const state = joinWith([joinedAlex, userMessage(1)]);

      expect(appReducer(state, received(userMessage(1)))).toBe(state);
      expect(appReducer(state, received(joinedAlex))).toBe(state);
    });

    it(`evicts the oldest message past ${CHAT_HISTORY_LIMIT}`, () => {
      const full = joinWith(
        Array.from({ length: CHAT_HISTORY_LIMIT }, (_, i) => userMessage(i + 1)),
      );

      const state = appReducer(full, received(userMessage(CHAT_HISTORY_LIMIT + 1)));

      expect(state.chat.messages).toHaveLength(CHAT_HISTORY_LIMIT);
      expect(state.chat.messages[0]).toEqual(userMessage(2));
      expect(state.chat.messages.at(-1)).toEqual(userMessage(CHAT_HISTORY_LIMIT + 1));
      expect(state.chat.messageIds).not.toHaveProperty('m-1');
      expect(Object.keys(state.chat.messageIds)).toHaveLength(CHAT_HISTORY_LIMIT);
    });

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joining', joining],
      ['failed', reduce(joining, { type: 'JOIN_FAILED', reason: 'ROOM_FULL' })],
      ['connection-lost', reduce(joinWith([]), { type: 'CONNECTION_LOST' })],
    ])('is ignored in %s', (_label, state) => {
      expect(appReducer(state, received(userMessage(1)))).toBe(state);
    });

    it('does not mutate the previous state', () => {
      const before = joinWith([joinedAlex]);
      const snapshot = structuredClone(before);

      appReducer(before, received(userMessage(1)));

      expect(before).toEqual(snapshot);
    });
  });

  describe('clearing', () => {
    const withChat = reduce(joinWith([joinedAlex]), received(userMessage(1)));

    it.each<[string, AppAction]>([
      ['LEFT_ROOM', { type: 'LEFT_ROOM' }],
      ['CONNECTION_LOST', { type: 'CONNECTION_LOST' }],
    ])('%s clears the chat', (_label, action) => {
      expect(appReducer(withChat, action).chat).toEqual({ messages: [], messageIds: {} });
    });

    it('JOIN_FAILED leaves the chat empty', () => {
      const state = appReducer(joining, { type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
      expect(state.chat).toEqual({ messages: [], messageIds: {} });
    });

    it('a rejoin after connection loss starts from the new history only', () => {
      const state = reduce(
        withChat,
        { type: 'CONNECTION_LOST' },
        { type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' },
      );
      expect(state.chat.messages).toEqual([]);

      const rejoined = appReducer(state, {
        type: 'JOIN_SUCCEEDED',
        self: alex,
        participants: [alex],
        messages: [userMessage(1), userMessage(7)],
      });
      expect(ids(rejoined)).toEqual(['m-1', 'm-7']);
    });
  });

  describe('CHAT_SEND_FAILED', () => {
    it.each<[ChatSendFailure, string]>([
      ['INVALID_MESSAGE', 'Сообщение пустое или слишком длинное'],
      ['RATE_LIMITED', 'Слишком часто. Подождите секунду'],
      ['TIMEOUT', 'Не удалось отправить сообщение'],
      ['INTERNAL', 'Не удалось отправить сообщение'],
    ])('%s shows an error notice «%s»', (code, text) => {
      const state = appReducer(joinWith([]), { type: 'CHAT_SEND_FAILED', code });
      expect(state.notice).toEqual({ id: 1, text, tone: 'error' });
    });

    it('NOT_IN_ROOM is ignored silently', () => {
      const state = joinWith([]);
      expect(appReducer(state, { type: 'CHAT_SEND_FAILED', code: 'NOT_IN_ROOM' })).toBe(state);
    });

    it('a repeated failure replaces the notice with a new id', () => {
      const state = reduce(
        joinWith([]),
        { type: 'CHAT_SEND_FAILED', code: 'RATE_LIMITED' },
        { type: 'CHAT_SEND_FAILED', code: 'RATE_LIMITED' },
      );
      expect(state.notice).toEqual({
        id: 2,
        text: 'Слишком часто. Подождите секунду',
        tone: 'error',
      });
    });

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joining', joining],
      ['connection-lost', reduce(joinWith([]), { type: 'CONNECTION_LOST' })],
    ])('is ignored in %s', (_label, state) => {
      expect(appReducer(state, { type: 'CHAT_SEND_FAILED', code: 'TIMEOUT' })).toBe(state);
    });

    it('does not touch the chat', () => {
      const state = joinWith([joinedAlex]);
      expect(appReducer(state, { type: 'CHAT_SEND_FAILED', code: 'TIMEOUT' }).chat).toBe(
        state.chat,
      );
    });
  });

  describe('NOTICE_DISMISSED', () => {
    it('clears the notice', () => {
      const state = reduce(
        joinWith([]),
        { type: 'CHAT_SEND_FAILED', code: 'TIMEOUT' },
        { type: 'NOTICE_DISMISSED' },
      );
      expect(state.notice).toBeNull();
    });

    it('is a no-op without a notice', () => {
      expect(appReducer(initialAppState, { type: 'NOTICE_DISMISSED' })).toBe(initialAppState);
    });
  });

  it('keeps the chat state serializable', () => {
    const state = reduce(joinWith([joinedAlex]), received(userMessage(1)), {
      type: 'CHAT_SEND_FAILED',
      code: 'RATE_LIMITED',
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
