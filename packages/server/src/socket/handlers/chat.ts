import { validateMessage, type ChatSendAck } from '@vcr/shared';
import { ackError } from '../ack';
import { adapterRoom } from '../adapterRoom';
import { getMembership } from '../getMembership';
import { safeHandler } from '../safeHandler';
import { ChatSendSchema } from '../schemas';
import type { AppSocket, HandlerContext } from '../types';

export function registerChatHandlers(ctx: HandlerContext, socket: AppSocket): void {
  // Payload приходит от недоверенного клиента, поэтому аргументы — unknown, а не типы контракта.
  socket.on(
    'chat:send',
    safeHandler(ctx, socket, 'chat:send', (raw: unknown, ackArg: unknown) => {
      if (typeof ackArg !== 'function') return; // клиент без ack — игнорируем
      const ack = ackArg as (res: ChatSendAck) => void;

      const member = getMembership(ctx, socket);
      if (!member) return ack(ackError('NOT_IN_ROOM'));
      const parsed = ChatSendSchema.safeParse(raw);
      if (!parsed.success) return ack(ackError('INVALID_PAYLOAD'));
      const text = validateMessage(parsed.data.text);
      if (!text.ok) return ack(ackError('INVALID_MESSAGE'));

      const { roomId, participant } = member;
      // Бакет проверяется последним: невалидные попытки токены не тратят.
      if (!participant.chatBucket.tryTake()) {
        ctx.logger.debug('Chat message rate limited', { roomId, participantId: participant.id });
        return ack(ackError('RATE_LIMITED'));
      }

      // Автор берётся из серверного Participant, а не из payload.
      const message = ctx.chat.appendUserMessage(roomId, participant, text.value);
      // Отправителю тоже: один путь рендера и одинаковый порядок у всех (TDD §3).
      ctx.io.to(adapterRoom(roomId)).emit('chat:message', { message });
      ack({ ok: true, messageId: message.id });
      // Текст сообщения не логируется (TDD §10).
      ctx.logger.debug('Chat message sent', {
        roomId,
        participantId: participant.id,
        messageId: message.id,
        length: [...text.value].length,
      });
    }),
  );
}
