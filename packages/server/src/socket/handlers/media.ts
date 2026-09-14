import { adapterRoom } from '../adapterRoom';
import { getMembership } from '../getMembership';
import { safeHandler } from '../safeHandler';
import { MediaStateSchema } from '../schemas';
import type { AppSocket, HandlerContext } from '../types';

export function registerMediaHandlers(ctx: HandlerContext, socket: AppSocket): void {
  // Fire-and-forget без ack: состояние идемпотентно, последнее значение побеждает,
  // а Socket.io сохраняет порядок событий одного сокета (TDD этапа 3 §4.2).
  socket.on(
    'media:update',
    safeHandler(ctx, socket, 'media:update', (raw: unknown) => {
      const member = getMembership(ctx, socket);
      if (!member) return; // вне комнаты — молча
      const parsed = MediaStateSchema.safeParse(raw);
      if (!parsed.success) return;

      const { roomId, participant } = member;
      // Повтор того же значения не рассылается.
      if (!ctx.registry.updateMedia(roomId, participant.id, parsed.data)) return;

      // participantId — из сокета, а не из payload: чужое состояние подделать нельзя.
      socket
        .to(adapterRoom(roomId))
        .emit('participant:media', { participantId: participant.id, media: parsed.data });
      ctx.logger.debug('Participant media updated', { roomId, participantId: participant.id });
    }),
  );
}
