import { generateRoomId } from '@vcr/shared';
import { navigate } from '../../app/router';
import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { NameForm } from './NameForm';

export function LobbyPage() {
  const { displayName } = useAppState();
  const session = useRoomSession();

  // Вход — из обработчика submit, а не из useEffect: StrictMode выполняет эффекты дважды,
  // что дало бы два сокета (TDD §4.3).
  const createRoom = (name: string) => {
    const roomId = generateRoomId();
    session.join(roomId, name);
    navigate(`/r/${roomId}`);
  };

  return (
    <main className="screen">
      <h1>Видеочат</h1>
      <p>Введите имя и создайте комнату — ссылкой на неё можно поделиться с остальными.</p>
      <NameForm
        submitLabel="Создать комнату"
        initialName={displayName ?? ''}
        onSubmit={createRoom}
      />
    </main>
  );
}
