import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { DeviceToggle } from './DeviceToggle';

export interface ControlBarProps {
  onLeave: () => void;
}

/** Панель управления под видео (PRD §6): микрофон, камера, выход. */
export function ControlBar({ onLeave }: ControlBarProps) {
  const { localMedia } = useAppState();
  const session = useRoomSession();

  return (
    <div className="control-bar" role="toolbar" aria-label="Управление звонком">
      <DeviceToggle kind="audio" status={localMedia.audio} onToggle={() => session.toggleAudio()} />
      <DeviceToggle kind="video" status={localMedia.video} onToggle={() => session.toggleVideo()} />
      <button type="button" className="control-bar__leave" onClick={onLeave}>
        Выйти
      </button>
    </div>
  );
}
