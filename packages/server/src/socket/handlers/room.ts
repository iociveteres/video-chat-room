import { randomUUID } from 'node:crypto';
import { isValidRoomId, validateName, type Ack, type JoinAck } from '@vcr/shared';
import { toParticipantDTO } from '../../rooms/RoomRegistry';
import { ackError } from '../ack';
import { adapterRoom } from '../adapterRoom';
import { leaveCurrentRoom } from '../leaveCurrentRoom';
import { safeHandler } from '../safeHandler';
import { JoinRequestSchema } from '../schemas';
import type { AppSocket, HandlerContext } from '../types';

export function registerRoomHandlers(ctx: HandlerContext, socket: AppSocket): void {
  // Payload приходит от недоверенного клиента, поэтому аргументы — unknown, а не типы контракта.
  socket.on(
    'room:join',
    safeHandler(ctx, socket, 'room:join', (raw: unknown, ackArg: unknown) => {
      if (typeof ackArg !== 'function') return; // клиент без ack — игнорируем
      const ack = ackArg as (res: JoinAck) => void;

      const parsed = JoinRequestSchema.safeParse(raw);
      if (!parsed.success) return ack(ackError('INVALID_PAYLOAD'));
      const { roomId } = parsed.data;
      if (!isValidRoomId(roomId)) return ack(ackError('INVALID_ROOM_ID'));
      const name = validateName(parsed.data.name);
      if (!name.ok) return ack(ackError('INVALID_NAME'));
      if (socket.data.roomId) return ack(ackError('ALREADY_JOINED'));

      // ── Атомарная секция: НЕТ await ───────────────────────────────────────────
      // Проверка лимита и добавление происходят в синхронном registry.join (TDD §4.2.1).
      const result = ctx.registry.join(roomId, {
        id: randomUUID(),
        socketId: socket.id,
        name: name.value,
        chatBucket: ctx.createChatBucket(),
        signalBucket: ctx.createSignalBucket(),
        media: parsed.data.media,
      });
      if (!result.ok) return ack(ackError('ROOM_FULL'));
      socket.data.roomId = roomId;
      socket.data.participantId = result.participant.id;
      // In-memory адаптер выполняет join синхронно.
      void socket.join(adapterRoom(roomId));
      // ──────────────────────────────────────────────────────────────────────────

      const self = toParticipantDTO(result.participant);
      ctx.logger.info('Participant joined', { roomId, participantId: self.id });
      // Снимок истории берётся в том же синхронном блоке, что и socket.join: всё более раннее
      // попадает в ack, всё более позднее придёт новичку событием — без дыр и дублей (TDD §4.2).
      const joinedMessage = ctx.chat.appendSystemMessage(
        roomId,
        'participant-joined',
        result.participant,
      );
      // Порядок «ack новичку → broadcast остальным» зафиксирован контрактом (этап 4 строит на нём offer).
      ack({
        ok: true,
        self,
        participants: ctx.registry.listParticipants(roomId),
        messages: ctx.chat.getHistory(roomId),
      });
      // socket.to исключает новичка: своё participant-joined он получает только в истории.
      socket.to(adapterRoom(roomId)).emit('participant:joined', { participant: self });
      socket.to(adapterRoom(roomId)).emit('chat:message', { message: joinedMessage });
    }),
  );

  socket.on(
    'room:leave',
    safeHandler(ctx, socket, 'room:leave', (ackArg: unknown) => {
      leaveCurrentRoom(ctx, socket, 'client leave');
      if (typeof ackArg === 'function') (ackArg as (res: Ack) => void)({ ok: true });
    }),
  );

  socket.on(
    'disconnect',
    safeHandler(ctx, socket, 'disconnect', (reason: string) => {
      leaveCurrentRoom(ctx, socket, reason);
    }),
  );
}
