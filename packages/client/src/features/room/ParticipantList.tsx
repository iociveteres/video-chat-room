import type { MediaState, ParticipantDTO } from '@vcr/shared';
import { CamOffIcon, MicOffIcon } from '../call/icons';

export interface ParticipantListProps {
  /** Уже в порядке входа (joinedAt). */
  participants: ParticipantDTO[];
  selfId: string | null;
  /** Состояние своих устройств из localMedia: серверная копия отстаёт на сеть. */
  selfMedia?: MediaState;
}

/** Список участников; заголовок со счётчиком — название вкладки в RoomSidebar. */
export function ParticipantList({ participants, selfId, selfMedia }: ParticipantListProps) {
  return (
    <ul className="participants">
      {participants.map((participant) => {
        const isSelf = participant.id === selfId;
        const media = isSelf && selfMedia ? selfMedia : participant.media;
        return (
          // Ключ по id: имена могут совпадать (FR-30).
          <li key={participant.id}>
            {/* Имя — только текстовый узел React: разметка в имени экранируется (FR-39). */}
            <span className="participants__name">{participant.name}</span>
            {isSelf && <span className="participants__self"> (вы)</span>}
            <span className="participants__media">
              {!media.audio && (
                <span role="img" aria-label="Микрофон выключен">
                  <MicOffIcon />
                </span>
              )}
              {!media.video && (
                <span role="img" aria-label="Камера выключена">
                  <CamOffIcon />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
