import type { ParticipantDTO } from '@vcr/shared';

export interface ParticipantListProps {
  /** Уже в порядке входа (joinedAt). */
  participants: ParticipantDTO[];
  selfId: string | null;
}

/** Список участников; заголовок со счётчиком — название вкладки в RoomSidebar. */
export function ParticipantList({ participants, selfId }: ParticipantListProps) {
  return (
    <ul className="participants">
      {participants.map((participant) => (
        // Ключ по id: имена могут совпадать (FR-30).
        <li key={participant.id}>
          {/* Имя — только текстовый узел React: разметка в имени экранируется (FR-39). */}
          <span className="participants__name">{participant.name}</span>
          {participant.id === selfId && <span className="participants__self"> (вы)</span>}
        </li>
      ))}
    </ul>
  );
}
