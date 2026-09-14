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
  // Из удалённой комнаты уведомлять некого.
  if (!result.roomDeleted) {
    ctx.io.to(adapterRoom(roomId)).emit('participant:left', { participantId });
  }
}
