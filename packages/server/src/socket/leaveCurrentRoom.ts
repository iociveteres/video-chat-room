import { adapterRoom } from './adapterRoom';
import type { AppSocket, HandlerContext } from './types';

/** Идемпотентный выход из текущей комнаты: вызывается из room:leave и из disconnect. */
export function leaveCurrentRoom(ctx: HandlerContext, socket: AppSocket, reason: string): void {
  const { roomId, participantId } = socket.data;
  if (!roomId || !participantId) return;

  socket.data.roomId = undefined;
  socket.data.participantId = undefined;
  const result = ctx.registry.leave(roomId, participantId);
  // In-memory адаптер выполняет leave синхронно.
  void socket.leave(adapterRoom(roomId));

  if (!result) return;
  ctx.logger.info('Participant left', { roomId, participantId, reason });
  // Из удалённой комнаты уведомлять некого: история удалена вместе с ней.
  if (!result.roomDeleted) {
    // Одно и то же сообщение для room:leave и обрыва: сервер их не различает (FR-31).
    const leftMessage = ctx.chat.appendSystemMessage(
      roomId,
      'participant-left',
      result.participant,
    );
    ctx.io.to(adapterRoom(roomId)).emit('participant:left', { participantId });
    ctx.io.to(adapterRoom(roomId)).emit('chat:message', { message: leftMessage });
  }
}
