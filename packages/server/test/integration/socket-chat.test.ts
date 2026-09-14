import { CHAT_RATE_LIMIT, MESSAGE_MAX_LENGTH, type ChatSendAck } from '@vcr/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppServerOptions } from '../../src/app';
import { createLogger } from '../../src/logger';
import {
  connectClient,
  connectClients,
  disconnectAll,
  joinOk,
  leave,
  rawSendChat,
  recordChat,
  sendChat,
  userMessages,
  type RawEmitter,
} from '../helpers/socketClient';
import { startTestServer, type TestServer } from '../helpers/startTestServer';

function countCodes(results: ChatSendAck[]) {
  return {
    ok: results.filter((r) => r.ok).length,
    rateLimited: results.filter((r) => !r.ok && r.error.code === 'RATE_LIMITED').length,
  };
}

describe('chat:send', () => {
  let t: TestServer;

  async function start(opts: Omit<AppServerOptions, 'port'> = {}) {
    t = await startTestServer(opts);
    return t;
  }

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  describe('delivery', () => {
    it('broadcasts the same message to all participants, sender included, and acks it', async () => {
      await start();
      const [a, b, c] = await connectClients(t.url, 3);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      await joinOk(c!, 'room1', 'Вера');
      const [aMessages, bMessages, cMessages] = [a!, b!, c!].map(recordChat);

      const ack = await sendChat(a!, 'Привет всем');

      expect(ack).toEqual({ ok: true, messageId: expect.any(String) as string });
      const expected = {
        kind: 'user',
        id: ack.ok ? ack.messageId : '',
        ts: expect.any(Number) as number,
        authorId: ackA.self.id,
        authorName: 'Алекс',
        text: 'Привет всем',
      };
      await vi.waitFor(() => {
        for (const messages of [aMessages!, bMessages!, cMessages!]) {
          expect(userMessages(messages)).toEqual([expected]);
        }
      });
      // Все получили один и тот же объект, включая серверное время.
      expect(userMessages(bMessages!)).toEqual(userMessages(aMessages!));
      expect(userMessages(cMessages!)).toEqual(userMessages(aMessages!));
    });

    it('delivers the sender its own message before the ack', async () => {
      await start();
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');
      const messages = recordChat(client);

      const ack = await sendChat(client, 'раз');

      expect(userMessages(messages).map((m) => m.id)).toEqual([ack.ok && ack.messageId]);
    });

    it('stores and broadcasts the normalized text without HTML escaping', async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');
      const bMessages = recordChat(b!);

      await sendChat(a!, '  <img src=x onerror=alert(1)>\r\n‮строка  ');

      const text = '<img src=x onerror=alert(1)>\nстрока';
      await vi.waitFor(() => {
        expect(userMessages(bMessages)).toMatchObject([{ text }]);
      });
      expect(userMessages(getRoomMessages(t, 'room1'))).toMatchObject([{ text }]);
    });

    it('keeps the order of messages from different participants', async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');
      const aMessages = recordChat(a!);
      const bMessages = recordChat(b!);

      await sendChat(a!, '1');
      await sendChat(b!, '2');
      await sendChat(a!, '3');

      await vi.waitFor(() => {
        expect(userMessages(aMessages).map((m) => m.text)).toEqual(['1', '2', '3']);
        expect(userMessages(bMessages).map((m) => m.text)).toEqual(['1', '2', '3']);
      });
    });

    it('isolates rooms: a client in Y does not receive messages from X', async () => {
      await start();
      const [x1, x2, y1] = await connectClients(t.url, 3);
      await joinOk(x1!, 'X');
      await joinOk(y1!, 'Y');
      const yMessages = recordChat(y1!);
      const x2Messages = recordChat(x2!);

      await sendChat(x1!, 'только для X');
      await joinOk(x2!, 'X');
      await sendChat(y1!, 'для Y');

      await vi.waitFor(() => {
        expect(userMessages(yMessages).map((m) => m.text)).toEqual(['для Y']);
      });
      // x2 вошёл после сообщения — оно не приходит событием и не пришло из чужой комнаты.
      expect(userMessages(x2Messages)).toEqual([]);
    });
  });

  describe('validation', () => {
    it.each([
      ['empty text', { text: '' }, 'INVALID_MESSAGE'],
      ['whitespace text', { text: ' \n\t ' }, 'INVALID_MESSAGE'],
      ['bidi-only text', { text: '‮⁦' }, 'INVALID_MESSAGE'],
      ['text over the limit', { text: 'a'.repeat(MESSAGE_MAX_LENGTH + 1) }, 'INVALID_MESSAGE'],
      ['text over the raw ceiling', { text: 'a'.repeat(8001) }, 'INVALID_PAYLOAD'],
      ['non-string text', { text: 1 }, 'INVALID_PAYLOAD'],
      ['missing text', {}, 'INVALID_PAYLOAD'],
      ['null payload', null, 'INVALID_PAYLOAD'],
      ['string payload', 'hello', 'INVALID_PAYLOAD'],
      ['extra field', { text: 'hi', extra: true }, 'INVALID_PAYLOAD'],
      ['forged author', { text: 'hi', authorName: 'Админ' }, 'INVALID_PAYLOAD'],
    ])('rejects %s with %s and broadcasts nothing', async (_label, payload, code) => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');
      const bMessages = recordChat(b!);

      expect(await rawSendChat(a!, payload)).toEqual({ ok: false, error: { code } });

      // Следующее валидное сообщение приходит первым — значит, отклонённое не рассылалось.
      await sendChat(a!, 'после');
      await vi.waitFor(() => {
        expect(userMessages(bMessages).map((m) => m.text)).toEqual(['после']);
      });
      expect(userMessages(getRoomMessages(t, 'room1')).map((m) => m.text)).toEqual(['после']);
    });

    it('accepts exactly MESSAGE_MAX_LENGTH code points', async () => {
      await start();
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');

      expect(await sendChat(client, '😀'.repeat(MESSAGE_MAX_LENGTH))).toMatchObject({ ok: true });
    });

    it('ignores the author from the payload even for a valid shape', async () => {
      await start();
      const client = await connectClient(t.url);
      const { self } = await joinOk(client, 'room1', 'Алекс');

      await sendChat(client, 'hi');

      expect(userMessages(getRoomMessages(t, 'room1'))).toMatchObject([
        { authorId: self.id, authorName: 'Алекс' },
      ]);
    });

    it('rejects chat:send before room:join with NOT_IN_ROOM', async () => {
      await start();
      const client = await connectClient(t.url);

      expect(await sendChat(client, 'hi')).toEqual({ ok: false, error: { code: 'NOT_IN_ROOM' } });
    });

    it('checks membership before the payload shape', async () => {
      await start();
      const client = await connectClient(t.url);

      expect(await rawSendChat(client, { text: 1 })).toEqual({
        ok: false,
        error: { code: 'NOT_IN_ROOM' },
      });
    });

    it('rejects chat:send after room:leave with NOT_IN_ROOM', async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');
      await leave(b!);

      expect(await sendChat(b!, 'hi')).toEqual({ ok: false, error: { code: 'NOT_IN_ROOM' } });
      expect(userMessages(getRoomMessages(t, 'room1'))).toEqual([]);
    });

    it('ignores chat:send without an ack function', async () => {
      await start();
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');
      (client as unknown as RawEmitter).emit('chat:send', { text: 'без ack' });

      // Следующая команда обрабатывается после предыдущей.
      await sendChat(client, 'с ack');
      expect(userMessages(getRoomMessages(t, 'room1')).map((m) => m.text)).toEqual(['с ack']);
    });
  });

  describe('rate limit', () => {
    it(`10 synchronous sends → ${CHAT_RATE_LIMIT.burst} ok and the rest RATE_LIMITED`, async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');
      const bMessages = recordChat(b!);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => sendChat(a!, `#${i}`)),
      );

      expect(countCodes(results)).toEqual({
        ok: CHAT_RATE_LIMIT.burst,
        rateLimited: 10 - CHAT_RATE_LIMIT.burst,
      });
      expect(results.slice(CHAT_RATE_LIMIT.burst)).toEqual(
        Array(10 - CHAT_RATE_LIMIT.burst).fill({ ok: false, error: { code: 'RATE_LIMITED' } }),
      );
      await vi.waitFor(() => {
        expect(userMessages(bMessages)).toHaveLength(CHAT_RATE_LIMIT.burst);
      });
      expect(userMessages(getRoomMessages(t, 'room1'))).toHaveLength(CHAT_RATE_LIMIT.burst);
    });

    it('limits each participant independently', async () => {
      await start();
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');

      await Promise.all(Array.from({ length: CHAT_RATE_LIMIT.burst }, () => sendChat(a!, 'a')));

      expect(await sendChat(a!, 'a')).toEqual({ ok: false, error: { code: 'RATE_LIMITED' } });
      expect(await sendChat(b!, 'b')).toMatchObject({ ok: true });
    });

    it('does not spend tokens on invalid messages', async () => {
      await start();
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');

      await Promise.all(Array.from({ length: 10 }, () => sendChat(client, '   ')));
      const results = await Promise.all(
        Array.from({ length: CHAT_RATE_LIMIT.burst }, () => sendChat(client, 'ok')),
      );

      expect(countCodes(results)).toEqual({ ok: CHAT_RATE_LIMIT.burst, rateLimited: 0 });
    });

    it('honours a custom chatRateLimit', async () => {
      await start({ chatRateLimit: { burst: 2, refillPerSecond: 1 } });
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');

      const results = await Promise.all(Array.from({ length: 3 }, () => sendChat(client, 'x')));

      expect(countCodes(results)).toEqual({ ok: 2, rateLimited: 1 });
    });

    it('can be disabled with chatRateLimit: false', async () => {
      await start({ chatRateLimit: false });
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');

      const results = await Promise.all(Array.from({ length: 50 }, () => sendChat(client, 'x')));

      expect(countCodes(results)).toEqual({ ok: 50, rateLimited: 0 });
    });
  });

  it('does not log message texts', async () => {
    const lines: string[] = [];
    await start({ logger: createLogger('debug', (_level, line) => lines.push(line)) });
    const client = await connectClient(t.url);
    await joinOk(client, 'room1');

    const ack = await sendChat(client, 'секретный текст');

    if (!ack.ok) throw new Error('send failed');
    const sent = lines.find((line) => line.includes('Chat message sent'));
    expect(sent).toContain(ack.messageId);
    expect(sent).toContain('"length":15');
    expect(lines.join('\n')).not.toContain('секретный');
  });
});

function getRoomMessages(t: TestServer, roomId: string) {
  return t.server.registry.getRoom(roomId)?.messages ?? [];
}
