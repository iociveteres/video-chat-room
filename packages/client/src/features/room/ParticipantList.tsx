import { MAX_PARTICIPANTS, type ParticipantDTO } from '@vcr/shared';

export interface ParticipantListProps {
  /** Уже в порядке входа (joinedAt). */
  participants: ParticipantDTO[];
  selfId: string | null;
}

export function ParticipantList({ participants, selfId }: ParticipantListProps) {
  return (
    <section className="participants" aria-labelledby="participants-title">
      <h2 id="participants-title">
        Участники ({participants.length}/{MAX_PARTICIPANTS})
      </h2>
      <ul>
        {participants.map((participant) => (
          // Ключ по id: имена могут совпадать (FR-30).
          <li key={participant.id}>
            {/* Имя — только текстовый узел React: разметка в имени экранируется (FR-39). */}
            <span className="participants__name">{participant.name}</span>
            {participant.id === selfId && <span className="participants__self"> (вы)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
