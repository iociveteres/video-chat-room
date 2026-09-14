import { MAX_PARTICIPANTS, type ParticipantDTO } from '@vcr/shared';
import type { Participant, Room } from './types';

export type JoinResult =
  { ok: true; room: Room; participant: Participant } | { ok: false; reason: 'ROOM_FULL' };

export interface LeaveResult {
  participant: Participant;
  roomDeleted: boolean;
}

export interface RoomRegistryOptions {
  maxParticipants?: number;
  now?: () => number;
}

export function toParticipantDTO({ id, name, joinedAt }: Participant): ParticipantDTO {
  return { id, name, joinedAt };
}

/**
 * Единственное место, где меняется состояние комнат (in-memory, один процесс).
 * Все методы синхронные: на этом держится атомарность лимита участников (TDD §4.2.1).
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly maxParticipants: number;
  private readonly now: () => number;

  constructor(opts: RoomRegistryOptions = {}) {
    this.maxParticipants = opts.maxParticipants ?? MAX_PARTICIPANTS;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Атомарно: создать комнату при отсутствии → проверить лимит → добавить.
   *
   * ВНИМАНИЕ: метод обязан оставаться синхронным. Node не прервёт синхронный код другим
   * обработчиком, поэтому два одновременных room:join не могут оба пройти проверку лимита.
   * Не добавляйте сюда `await`, не делайте тип возврата Promise и не разносите проверку
   * и добавление по разным шагам — иначе в комнату попадёт лишний участник.
   * Любую асинхронную работу выполняйте ДО вызова join.
   */
  join(roomId: string, input: Omit<Participant, 'joinedAt'>): JoinResult {
    const existing = this.rooms.get(roomId);
    if (existing && existing.participants.size >= this.maxParticipants) {
      return { ok: false, reason: 'ROOM_FULL' };
    }

    const room = existing ?? {
      id: roomId,
      createdAt: this.now(),
      participants: new Map(),
      messages: [],
    };
    if (!existing) this.rooms.set(roomId, room);

    const participant: Participant = { ...input, joinedAt: this.now() };
    room.participants.set(participant.id, participant);
    return { ok: true, room, participant };
  }

  /** Идемпотентно: повторный вызов вернёт null. Удаляет опустевшую комнату. */
  leave(roomId: string, participantId: string): LeaveResult | null {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) return null;

    room.participants.delete(participantId);
    const roomDeleted = room.participants.size === 0;
    if (roomDeleted) this.rooms.delete(roomId);
    return { participant, roomDeleted };
  }

  getRoom(roomId: string): Readonly<Room> | undefined {
    return this.rooms.get(roomId);
  }

  getParticipant(roomId: string, participantId: string): Readonly<Participant> | undefined {
    return this.rooms.get(roomId)?.participants.get(participantId);
  }

  /** Участники в порядке входа (он же порядок joinedAt). Для неизвестной комнаты — []. */
  listParticipants(roomId: string): ParticipantDTO[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.participants.values(), toParticipantDTO) : [];
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}
