import { useEffect, useRef } from 'react';
import { AvatarPlaceholder } from './AvatarPlaceholder';
import { MicOffIcon } from './icons';

export interface VideoTileProps {
  /** Имя участника: в заглушке и, если не задан label, в подписи поверх плитки. */
  name: string;
  /** Подпись поверх плитки (FR-12); по умолчанию — name. */
  label?: string;
  stream: MediaStream | null;
  /** false — камеры нет, она выключена или недоступна: показывается заглушка. */
  showVideo: boolean;
  /** Иконка перечёркнутого микрофона (FR-16). */
  audioMuted: boolean;
  /** Зеркалить только видео (self-view), не подпись. */
  mirrored?: boolean;
  /** Не воспроизводить звук элемента — для self-view, чтобы не было эха. */
  muted?: boolean;
  statusLabel?: string;
  /** Этап 4: предупреждение поверх показанного видео, например «Связь нестабильна…». */
  overlayLabel?: string;
  /** Меняется при смене трека в том же MediaStream — повод перепривязать srcObject. */
  streamVersion?: number;
}

/**
 * Переиспользуемая плитка: self-view на этапе 3, удалённые участники на этапе 4.
 *
 * <video> смонтирован всегда и при showVideo=false только скрыт CSS: на этапе 4 через этот же
 * элемент играет звук собеседника, и размонтирование заглушило бы его (TDD этапа 3 §4.6).
 */
export function VideoTile({
  name,
  label = name,
  stream,
  showVideo,
  audioMuted,
  mirrored = false,
  muted = false,
  statusLabel,
  overlayLabel,
  streamVersion = 0,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // Перепривязка при смене streamVersion: часть браузеров не подхватывает addTrack
    // на уже привязанном MediaStream.
    el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream, streamVersion]);

  const videoClass = [
    'tile__video',
    mirrored && 'tile__video--mirrored',
    !showVideo && 'tile__video--hidden',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <figure className="tile" aria-label={label}>
      <video ref={videoRef} className={videoClass} autoPlay playsInline muted={muted} />
      {!showVideo && <AvatarPlaceholder name={name} statusLabel={statusLabel} />}
      {showVideo && overlayLabel && (
        <span className="tile__overlay" role="status">
          {overlayLabel}
        </span>
      )}
      <figcaption className="tile__label">
        <span className="tile__name">{label}</span>
        {audioMuted && (
          <span className="tile__mic-off" role="img" aria-label="Микрофон выключен">
            <MicOffIcon />
          </span>
        )}
      </figcaption>
    </figure>
  );
}
