import { CopyLinkButton } from './CopyLinkButton';

export interface RoomHeaderProps {
  roomId: string;
  onLeave: () => void;
}

export function RoomHeader({ roomId, onLeave }: RoomHeaderProps) {
  // Каноничная ссылка на комнату, без случайных query/hash из адресной строки.
  const url = `${window.location.origin}/r/${roomId}`;

  return (
    <header className="room-header">
      <h1>
        Комната <code>{roomId}</code>
      </h1>
      <div className="room-header__actions">
        <CopyLinkButton url={url} />
        <button type="button" className="button--secondary" onClick={onLeave}>
          Выйти
        </button>
      </div>
    </header>
  );
}
