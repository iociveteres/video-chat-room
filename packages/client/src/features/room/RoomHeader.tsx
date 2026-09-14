import { CopyLinkButton } from './CopyLinkButton';

export interface RoomHeaderProps {
  roomId: string;
}

/** «Выйти» переехал в панель управления под видео (TDD этапа 3 §14, п. 5). */
export function RoomHeader({ roomId }: RoomHeaderProps) {
  // Каноничная ссылка на комнату, без случайных query/hash из адресной строки.
  const url = `${window.location.origin}/r/${roomId}`;

  return (
    <header className="room-header">
      <h1>
        Комната <code>{roomId}</code>
      </h1>
      <div className="room-header__actions">
        <CopyLinkButton url={url} />
      </div>
    </header>
  );
}
