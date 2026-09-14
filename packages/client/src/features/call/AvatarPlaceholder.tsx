export interface AvatarPlaceholderProps {
  name: string;
  /** Причина отсутствия видео (TDD этапа 3 §8.1), например «Камера выключена». */
  statusLabel?: string;
}

/** Заглушка вместо видео: силуэт человека и имя (FR-18). */
export function AvatarPlaceholder({ name, statusLabel }: AvatarPlaceholderProps) {
  return (
    <div className="avatar-placeholder">
      <svg
        className="avatar-placeholder__silhouette"
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="32" cy="22" r="12" fill="currentColor" />
        <path d="M8 60c0-13.3 10.7-22 24-22s24 8.7 24 22z" fill="currentColor" />
      </svg>
      {/* Имя — только текстовый узел React: разметка в имени экранируется (FR-39). */}
      <span className="avatar-placeholder__name">{name}</span>
      {statusLabel && <span className="avatar-placeholder__status">{statusLabel}</span>}
    </div>
  );
}
