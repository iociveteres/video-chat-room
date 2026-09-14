import { CHAT_HISTORY_LIMIT, CHAT_RATE_LIMIT } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import { ChatService } from '../../src/chat/ChatService';
import { TokenBucket } from '../../src/chat/TokenBucket';
import { RoomRegistry } from '../../src/rooms/RoomRegistry';
import type { Participant } from '../../src/rooms/types';

function setup(opts: { historyLimit?: number } = {}) {
  let clock = 5_000;
  let messageSeq = 0;
  const registry = new RoomRegistry();
  const chat = new ChatService({
    registry,
    historyLimit: opts.historyLimit,
    now: () => clock++,
    newId: () => `m${++messageSeq}`,
  });

  let participantSeq = 0;
  const join = (roomId: string, name: string): Participant => {
    participantSeq += 1;
    const result = registry.join(roomId, {
      id: `p${participantSeq}`,
      socketId: `s${participantSeq}`,
      name,
      media: { audio: true, video: true },
      chatBucket: new TokenBucket({
        capacity: CHAT_RATE_LIMIT.burst,
        refillPerSecond: CHAT_RATE_LIMIT.refillPerSecond,
      }),
    });
    if (!result.ok) throw new Error('join failed');
    return result.participant;
  };

  return { registry, chat, join };
}

describe('ChatService', () => {
  it('appends a user message with server id, time and author snapshot', () => {
    const { chat, join } = setup();
    const alex = join('r1', 'Алекс');

    const message = chat.appendUserMessage('r1', alex, 'Привет');

    expect(message).toEqual({
      kind: 'user',
      id: 'm1',
      ts: 5_000,
      authorId: alex.id,
      authorName: 'Алекс',
      text: 'Привет',
    });
    expect(chat.getHistory('r1')).toEqual([message]);
  });

  it.each(['participant-joined', 'participant-left'] as const)(
    'appends a %s system message',
    (event) => {
      const { chat, join } = setup();
      const maria = join('r1', 'Мария');

      expect(chat.appendSystemMessage('r1', event, maria)).toEqual({
        kind: 'system',
        id: 'm1',
        ts: 5_000,
        event,
        participantId: maria.id,
        participantName: 'Мария',
      });
    },
  );

  it('keeps user and system messages in insertion order', () => {
    const { chat, join } = setup();
    const alex = join('r1', 'Алекс');
    const maria = join('r1', 'Мария');

    chat.appendSystemMessage('r1', 'participant-joined', alex);
    chat.appendUserMessage('r1', alex, 'раз');
    chat.appendSystemMessage('r1', 'participant-joined', maria);
    chat.appendUserMessage('r1', maria, 'два');
    chat.appendSystemMessage('r1', 'participant-left', alex);

    const history = chat.getHistory('r1');
    expect(history.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(history.map((m) => m.ts)).toEqual([5_000, 5_001, 5_002, 5_003, 5_004]);
  });

  it('defaults the limit to CHAT_HISTORY_LIMIT: the next message evicts the oldest', () => {
    const { chat, join } = setup();
    const alex = join('r1', 'Алекс');
    for (let i = 1; i <= CHAT_HISTORY_LIMIT; i++) chat.appendUserMessage('r1', alex, `#${i}`);
    expect(chat.getHistory('r1')).toHaveLength(CHAT_HISTORY_LIMIT);

    chat.appendUserMessage('r1', alex, `#${CHAT_HISTORY_LIMIT + 1}`);

    const history = chat.getHistory('r1');
    expect(history).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(history[0]).toMatchObject({ text: '#2' });
    expect(history.at(-1)).toMatchObject({ text: `#${CHAT_HISTORY_LIMIT + 1}` });
  });

  it('honours an injected historyLimit', () => {
    const { chat, join } = setup({ historyLimit: 2 });
    const alex = join('r1', 'Алекс');

    chat.appendSystemMessage('r1', 'participant-joined', alex);
    chat.appendUserMessage('r1', alex, 'a');
    chat.appendUserMessage('r1', alex, 'b');

    expect(chat.getHistory('r1').map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('returns a copy of the history', () => {
    const { chat, registry, join } = setup();
    const alex = join('r1', 'Алекс');
    const message = chat.appendUserMessage('r1', alex, 'a');

    const history = chat.getHistory('r1');
    history.pop();
    history.push({ ...message, id: 'forged' });

    expect(chat.getHistory('r1')).toEqual([message]);
    expect(registry.getRoom('r1')?.messages).toEqual([message]);
  });

  it('snapshots authorName and participantName', () => {
    const { chat, join } = setup();
    const alex = join('r1', 'Алекс');
    chat.appendSystemMessage('r1', 'participant-joined', alex);
    chat.appendUserMessage('r1', alex, 'a');

    alex.name = 'Другое имя';

    expect(chat.getHistory('r1')).toMatchObject([
      { participantName: 'Алекс' },
      { authorName: 'Алекс' },
    ]);
  });

  it('isolates histories of different rooms', () => {
    const { chat, join } = setup();
    const x = join('x', 'X');
    const y = join('y', 'Y');

    chat.appendUserMessage('x', x, 'in x');
    chat.appendUserMessage('y', y, 'in y');

    expect(chat.getHistory('x').map((m) => m.id)).toEqual(['m1']);
    expect(chat.getHistory('y').map((m) => m.id)).toEqual(['m2']);
  });

  it('drops the history together with the room', () => {
    const { chat, registry, join } = setup();
    const alex = join('r1', 'Алекс');
    chat.appendUserMessage('r1', alex, 'a');

    registry.leave('r1', alex.id);
    expect(chat.getHistory('r1')).toEqual([]);

    const again = join('r1', 'Алекс');
    chat.appendSystemMessage('r1', 'participant-joined', again);
    expect(chat.getHistory('r1').map((m) => m.id)).toEqual(['m2']);
  });

  it('returns [] for an unknown room and throws when appending to it', () => {
    const { chat, join } = setup();
    const alex = join('r1', 'Алекс');

    expect(chat.getHistory('nope')).toEqual([]);
    expect(() => chat.appendUserMessage('nope', alex, 'a')).toThrow(/nope/);
    expect(() => chat.appendSystemMessage('nope', 'participant-left', alex)).toThrow(/nope/);
  });
});
