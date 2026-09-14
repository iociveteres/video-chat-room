import { navigate } from '../../app/router';
import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { VideoStage } from '../call/VideoStage';
import { ControlBar } from '../controls/ControlBar';
import { NameForm } from '../lobby/NameForm';
import { StatusScreen } from '../status/StatusScreen';
import { MediaAccessBanner } from './MediaAccessBanner';
import { RoomHeader } from './RoomHeader';
import { RoomSidebar } from './RoomSidebar';

export interface RoomPageProps {
  roomId: string;
}

export function RoomPage({ roomId }: RoomPageProps) {
  const state = useAppState();
  const session = useRoomSession();
  const { displayName, phase, joinStep } = state;

  // Все входы — из обработчиков действий пользователя, не из эффектов (TDD §4.3).
  const join = (name: string) => session.join(roomId, name);
  const goHome = () => {
    session.leave();
    navigate('/');
  };

  // Открыли ссылку (имени ещё нет) или вернулись в комнату после выхода: спрашиваем имя.
  const notInThisRoom = phase.kind === 'idle' || state.roomId !== roomId;
  if (displayName === null || notInThisRoom) {
    return (
      <main className="screen">
        <h1>Вход в комнату</h1>
        <NameForm submitLabel="Войти" initialName={displayName ?? ''} onSubmit={join} />
      </main>
    );
  }

  switch (phase.kind) {
    case 'joining':
      return (
        <main className="screen">
          <div className="spinner" aria-hidden="true" />
          <p role="status">Подключаемся к комнате…</p>
          {joinStep === 'acquiring-media' && (
            <>
              <p>Разрешите доступ к камере и микрофону во всплывающем окне браузера</p>
              <button
                type="button"
                className="button--secondary"
                onClick={() => session.joinWithoutMedia()}
              >
                Войти без камеры и микрофона
              </button>
            </>
          )}
        </main>
      );

    case 'joined':
      return (
        <div className="room">
          <div className="room__main">
            <RoomHeader roomId={roomId} />
            <MediaAccessBanner />
            <div className="room__stage">
              <VideoStage />
            </div>
            <ControlBar onLeave={goHome} />
          </div>
          <RoomSidebar />
        </div>
      );

    case 'failed':
      if (phase.reason === 'INVALID_NAME') {
        return (
          <main className="screen">
            <h1>Вход в комнату</h1>
            <NameForm
              submitLabel="Войти"
              initialName={displayName}
              onSubmit={join}
              error="Сервер не принял это имя. Попробуйте другое."
            />
          </main>
        );
      }
      return (
        <StatusScreen reason={phase.reason} onRetry={() => join(displayName)} onHome={goHome} />
      );

    case 'connection-lost':
      return (
        <StatusScreen reason="CONNECTION_LOST" onRetry={() => join(displayName)} onHome={goHome} />
      );
  }
}
