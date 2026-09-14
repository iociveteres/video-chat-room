import type { DeviceStatus, TrackKind } from '../../media/MediaController';
import { deviceStatusLabel } from '../../media/mediaTexts';
import { CamIcon, CamOffIcon, MicIcon, MicOffIcon, WarningIcon } from '../call/icons';

export interface DeviceToggleProps {
  kind: TrackKind;
  status: DeviceStatus;
  onToggle: () => void;
}

const NAMES: Record<TrackKind, string> = { audio: 'Микрофон', video: 'Камера' };

/** Статусы, при которых устройство недоступно не по воле пользователя. */
function isProblem(status: DeviceStatus): boolean {
  return status !== 'on' && status !== 'off' && status !== 'acquiring';
}

/**
 * Тумблер устройства: aria-pressed — передаётся ли сейчас, title — причина по §8.1.
 * Во время захвата кнопка заблокирована (вместе с очередью controller'а — защита от двойного клика).
 */
export function DeviceToggle({ kind, status, onToggle }: DeviceToggleProps) {
  const on = status === 'on';
  const problem = isProblem(status);
  const Off = kind === 'audio' ? MicOffIcon : CamOffIcon;
  const On = kind === 'audio' ? MicIcon : CamIcon;

  return (
    <button
      type="button"
      className={`device-toggle${on ? '' : ' device-toggle--off'}${problem ? ' device-toggle--problem' : ''}`}
      aria-pressed={on}
      title={deviceStatusLabel(kind, status)}
      disabled={status === 'acquiring'}
      onClick={onToggle}
    >
      <span className="device-toggle__icon" data-icon={on ? 'on' : problem ? 'warning' : 'off'}>
        {on ? <On size={20} /> : <Off size={20} />}
        {problem && (
          <span className="device-toggle__warning">
            <WarningIcon size={12} />
          </span>
        )}
      </span>
      <span className="device-toggle__name">{NAMES[kind]}</span>
    </button>
  );
}
