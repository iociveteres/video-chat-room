import { useEffect, useRef } from 'react';
import { AvatarPlaceholder } from './AvatarPlaceholder';
import { MicOffIcon } from './icons';
import { useFreshFrame } from './useFreshFrame';

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
  /**
   * Этап 4: запуск воспроизведения через реестр autoplay (удалённые плитки). Должна быть
   * стабильной; возвращает отмену регистрации. Без неё плитка вызывает play() сама.
   */
  registerVideo?: (el: HTMLVideoElement) => () => void;
  /** Этап 4: после включения камеры показывать видео только с новым кадром (useFreshFrame). */
  waitForFreshFrame?: boolean;
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
  registerVideo,
  waitForFreshFrame = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasFreshFrame = useFreshFrame(videoRef, waitForFreshFrame && showVideo);
  // Ждём кадр: <video> остаётся под заглушкой, но прозрачным, а не visibility: hidden, —
  // иначе браузер может не отдавать ему кадры, и requestVideoFrameCallback не сработает.
  const pending = waitForFreshFrame && showVideo && !hasFreshFrame;
  const videoVisible = showVideo && !pending;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    // Перепривязка при смене streamVersion: часть браузеров не подхватывает addTrack
    // на уже привязанном MediaStream.
    el.srcObject = stream;
    if (!stream) return undefined;
    if (registerVideo) return registerVideo(el);
    el.play().catch(() => {});
    return undefined;
  }, [stream, streamVersion, registerVideo]);

  const videoClass = [
    'tile__video',
    mirrored && 'tile__video--mirrored',
    !showVideo && 'tile__video--hidden',
    pending && 'tile__video--pending',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <figure className="tile" aria-label={label}>
      <video ref={videoRef} className={videoClass} autoPlay playsInline muted={muted} />
      {!videoVisible && <AvatarPlaceholder name={name} statusLabel={statusLabel} />}
      {videoVisible && overlayLabel && (
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
