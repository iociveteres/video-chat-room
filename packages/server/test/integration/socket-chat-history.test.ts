import {
  CHAT_HISTORY_LIMIT,
  MAX_PARTICIPANTS,
  type ChatMessage,
  type ParticipantDTO,
  type SystemEvent,
} from '@vcr/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppServerOptions } from '../../src/app';
import {
  connectClient,
  connectClients,
  disconnectAll,
  join,
  joinOk,
  leave,
  recordChat,
  sendChat,
  type TestClient,
} from '../helpers/socketClient';
import { startTestServer, type TestServer } from '../helpers/startTestServer';

type TimelineEntry =
  | { type: 'participant:joined'; participant: ParticipantDTO }
  | { type: 'participant:left'; participantId: string }
  | { type: 'chat:message'; message: ChatMessage };

/** participant:* и chat:message одного клиента в общем порядке получения. */
function recordTimeline(client: TestClient): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  client.on('participant:joined', ({ participant }) =>
    timeline.push({ type: 'participant:joined', participant }),
  );
  client.on('participant:left', ({ participantId }) =>
    timeline.push({ type: 'participant:left', participantId }),
  );
  client.on('chat:message', ({ message }) => timeline.push({ type: 'chat:message', message }));
  return timeline;
}

function systemMessage(event: SystemEvent, p: ParticipantDTO) {
  return {
    kind: 'system',
    id: expect.any(String) as string,
    ts: expect.any(Number) as number,
    event,
    participantId: p.id,
    participantName: p.name,
  };
}

/** Короткая сводка сообщения для сравнения порядка. */
function describeMessage(message: ChatMessage): string {
  return message.kind === 'user'
    ? `${message.authorName}: ${message.text}`
    : `${message.participantName} ${message.event}`;
}

describe('chat history and system messages', () => {
  let t: TestServer;

  async function start(opts: Omit<AppServerOptions, 'port'> = {}) {
    t = await startTestServer(opts);
    return t;
  }

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  describe('joining', () => {
    it('the first participant gets only its own participant-joined in the history', async () => {
      await start();
      const client = await connectClient(t.url);

      const ack = await joinOk(client, 'room1', 'Алекс');

      expect(ack.messages).toEqual([systemMessage('participant-joined', ack.self)]);
    });

    it('others get participant:joined and then the system chat:message', async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1', 'Алекс');
      const aTimeline = recordTimeline(a!);

      const ackB = await joinOk(b!, 'room1', 'Борис');

      await vi.waitFor(() => {
        expect(aTimeline).toEqual([
          { type: 'participant:joined', participant: ackB.self },
          { type: 'chat:message', message: ackB.messages.at(-1) },
        ]);
      });
      expect(ackB.messages.at(-1)).toEqual(systemMessage('participant-joined', ackB.self));
    });

    it('a late participant gets the whole history in order without a duplicate of its own join', async () => {
      await start();
      const [a, b, c] = await connectClients(t.url, 3);
      await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      await sendChat(a!, 'Привет');
      await sendChat(b!, 'Привет, Алекс');
      await leave(b!);
      await sendChat(a!, 'Борис ушёл');
      const cTimeline = recordTimeline(c!);

      const ackC = await joinOk(c!, 'room1', 'Вера');

      expect(ackC.messages.map(describeMessage)).toEqual([
        'Алекс participant-joined',
        'Борис participant-joined',
        'Алекс: Привет',
        'Борис: Привет, Алекс',
        'Борис participant-left',
        'Алекс: Борис ушёл',
        'Вера participant-joined',
      ]);
      expect(new Set(ackC.messages.map((m) => m.id)).size).toBe(ackC.messages.length);
      expect(ackC.messages.map((m) => m.ts)).toEqual(
        [...ackC.messages.map((m) => m.ts)].sort((x, y) => x - y),
      );

      // Всё, что появилось после входа, приходит событием; своё joined повторно не приходит.
      await sendChat(a!, 'Привет, Вера');
      await vi.waitFor(() => {
        expect(cTimeline).toHaveLength(1);
      });
      expect(cTimeline).toMatchObject([
        { type: 'chat:message', message: { kind: 'user', text: 'Привет, Вера' } },
      ]);
    });

    it('existing participants and the newcomer end up with the same history', async () => {
      await start();
      const [a, b, c] = await connectClients(t.url, 3);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      const aMessages = recordChat(a!);
      await joinOk(b!, 'room1', 'Борис');
      await sendChat(b!, 'раз');
      await sendChat(a!, 'два');

      const ackC = await joinOk(c!, 'room1', 'Вера');

      await vi.waitFor(() => {
        expect([...ackA.messages, ...aMessages]).toEqual(ackC.messages);
      });
    });

    it('does not add a system message for a rejected join', async () => {
      await start();
      const clients = await connectClients(t.url, MAX_PARTICIPANTS + 1);
      for (const client of clients.slice(0, MAX_PARTICIPANTS)) await joinOk(client, 'room1');
      await join(clients[0]!, 'room2'); // ALREADY_JOINED

      expect(await join(clients[MAX_PARTICIPANTS]!, 'room1')).toMatchObject({ ok: false });

      expect(getRoomMessages(t, 'room1')).toHaveLength(MAX_PARTICIPANTS);
      expect(t.server.registry.getRoom('room2')).toBeUndefined();
    });
  });

  describe('leaving', () => {
    it.each([
      ['disconnect', (client: TestClient) => client.disconnect()],
      ['room:leave', (client: TestClient) => void leave(client)],
    ])(
      'on %s the others get participant:left and then the system participant-left',
      async (_label, exit) => {
        await start();
        const [a, b] = await connectClients(t.url, 2);
        await joinOk(a!, 'room1', 'Алекс');
        const ackB = await joinOk(b!, 'room1', 'Борис');
        const aTimeline = recordTimeline(a!);
        const bMessages = recordChat(b!);
        // participant-joined Бориса мог прийти Алексу уже после подписки — ждём и отбрасываем.
        await sendChat(a!, 'маркер');
        await vi.waitFor(() => {
          expect(aTimeline.at(-1)).toMatchObject({ message: { text: 'маркер' } });
          expect(bMessages.at(-1)).toMatchObject({ text: 'маркер' });
        });
        aTimeline.length = 0;
        bMessages.length = 0;

        exit(b!);

        await vi.waitFor(() => {
          expect(aTimeline).toEqual([
            { type: 'participant:left', participantId: ackB.self.id },
            { type: 'chat:message', message: systemMessage('participant-left', ackB.self) },
          ]);
        });
        // Ушедший своё сообщение о выходе не получает.
        expect(bMessages).toEqual([]);
        expect(getRoomMessages(t, 'room1').at(-1)).toEqual(
          systemMessage('participant-left', ackB.self),
        );
      },
    );

    it('keeps messages of a participant who left signed with their name', async () => {
      await start();
      const [a, b, c] = await connectClients(t.url, 3);
      await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      await sendChat(b!, 'я ненадолго');
      b!.disconnect();
      await vi.waitFor(() => {
        expect(t.server.registry.listParticipants('room1')).toHaveLength(1);
      });

      const ackC = await joinOk(c!, 'room1', 'Вера');

      expect(ackC.messages).toContainEqual(
        expect.objectContaining({ kind: 'user', authorName: 'Борис', text: 'я ненадолго' }),
      );
    });

    it('drops the history with the room: after everyone left a new join sees only its own join', async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      await sendChat(a!, 'до свидания');
      await leave(a!);
      b!.disconnect();
      await vi.waitFor(() => {
        expect(t.server.registry.getRoom('room1')).toBeUndefined();
      });

      const ack = await joinOk(a!, 'room1', 'Алекс');

      expect(ack.messages).toEqual([systemMessage('participant-joined', ack.self)]);
    });
  });

  it(`a newcomer gets the last ${CHAT_HISTORY_LIMIT} messages after 205 were sent`, async () => {
    await start({ chatRateLimit: false });
    const [a, c] = await connectClients(t.url, 2);
    await joinOk(a!, 'room1', 'Алекс');
    const sent = await Promise.all(
      Array.from({ length: 205 }, (_, i) => sendChat(a!, `#${i + 1}`)),
    );
    expect(sent.every((r) => r.ok)).toBe(true);

    const ackC = await joinOk(c!, 'room1', 'Вера');

    // Алекс joined + 205 сообщений + Вера joined = 207, старейшие 7 вытеснены.
    expect(ackC.messages).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(ackC.messages[0]).toMatchObject({ kind: 'user', text: '#7' });
    expect(ackC.messages.at(-2)).toMatchObject({ kind: 'user', text: '#205' });
    expect(ackC.messages.at(-1)).toEqual(systemMessage('participant-joined', ackC.self));
  });
});

function getRoomMessages(t: TestServer, roomId: string) {
  return t.server.registry.getRoom(roomId)?.messages ?? [];
}
