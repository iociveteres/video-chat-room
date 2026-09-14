import type { Participant } from '../rooms/types';
import type { AppSocket, HandlerContext } from './types';

export interface Membership {
  roomId: string;
  participant: Readonly<Participant>;
}

/** Комната и участник текущего сокета; null, если сокет не в комнате или уже вышел. */
export function getMembership(ctx: HandlerContext, socket: AppSocket): Membership | null {
  const { roomId, participantId } = socket.data;
  if (!roomId || !participantId) return null;
  const participant = ctx.registry.getParticipant(roomId, participantId);
  return participant ? { roomId, participant } : null;
}
