import { getMembership } from '../getMembership';
import { safeHandler } from '../safeHandler';
import { SignalSchema } from '../schemas';
import type { AppSocket, HandlerContext } from '../types';

export function registerSignalHandlers(ctx: HandlerContext, socket: AppSocket): void {
  // Relay без состояния и без ack (TDD этапа 4 §6.3). Socket.io сохраняет порядок событий
  // одного сокета, поэтому offer дойдёт до адресата раньше кандидатов того же отправителя.
  // SDP и кандидаты не логируются: в них IP-адреса и DTLS fingerprint (TDD §10).
  socket.on(
    'signal',
    safeHandler(ctx, socket, 'signal', (raw: unknown) => {
      const member = getMembership(ctx, socket);
      if (!member) return; // вне комнаты — молча
      const { roomId, participant } = member;
      const log = { roomId, participantId: participant.id };

      const parsed = SignalSchema.safeParse(raw);
      if (!parsed.success) {
        return ctx.logger.debug('Signal dropped', { ...log, reason: 'invalid' });
      }
      const { to, data } = parsed.data;
      const dropped = { ...log, signalType: data.type };
      if (to === participant.id) {
        return ctx.logger.debug('Signal dropped', { ...dropped, reason: 'self' });
      }

      // Адресат вышел или в другой комнате: вышедший адресат — нормальная гонка.
      const target = ctx.registry.getParticipant(roomId, to);
      if (!target) {
        return ctx.logger.debug('Signal dropped', { ...dropped, reason: 'target-not-found' });
      }

      // I1, защита в глубину: offer только от вошедшего раньше, answer — наоборот.
      if (
        (data.type === 'offer' && participant.joinSeq > target.joinSeq) ||
        (data.type === 'answer' && participant.joinSeq < target.joinSeq)
      ) {
        return ctx.logger.warn('Signal dropped', { ...dropped, reason: 'role-violation' });
      }

      // Бакет проверяется последним: отброшенные сообщения токены не тратят.
      if (!participant.signalBucket.tryTake()) {
        return ctx.logger.warn('Signal dropped', { ...dropped, reason: 'rate-limited' });
      }

      // from — из сокета, а не из payload: подделать отправителя нельзя.
      ctx.io.to(target.socketId).emit('signal', { from: participant.id, data });
    }),
  );
}
