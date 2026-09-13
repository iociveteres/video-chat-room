import { MAX_PARTICIPANTS } from '@vcr/shared';
import type { EnvironmentCheck } from '../../app/environment';
import type { JoinFailure } from '../../state/actions';

export type StatusReason =
  | Exclude<JoinFailure, 'INVALID_NAME'>
  | 'CONNECTION_LOST'
  | 'invalid-link'
  | Exclude<EnvironmentCheck, 'ok'>;

interface StatusContent {
  title: string;
  message: string;
  /** Текст кнопки повторной попытки; null — повторять нечего. */
  retryLabel: string | null;
  /** Есть ли смысл вести на главную (при проблемах окружения — нет). */
  home: boolean;
}

// Тексты по TDD §8.
export const STATUS_CONTENT: Record<StatusReason, StatusContent> = {
  ROOM_FULL: {
    title: 'Комната заполнена',
    message: `В комнате уже ${MAX_PARTICIPANTS} участника. Попробуйте войти, когда кто-нибудь выйдет.`,
    retryLabel: 'Повторить вход',
    home: true,
  },
  SERVER_UNAVAILABLE: {
    title: 'Сервер недоступен',
    message: 'Проверьте подключение и попробуйте снова.',
    retryLabel: 'Повторить',
    home: true,
  },
  CONNECTION_LOST: {
    title: 'Соединение с сервером прервано',
    message: 'Войдите снова — вы вернётесь в комнату как новый участник.',
    retryLabel: 'Войти снова',
    home: true,
  },
  INTERNAL: {
    title: 'Что-то пошло не так',
    message: 'Не удалось войти в комнату. Попробуйте ещё раз.',
    retryLabel: 'Повторить вход',
    home: true,
  },
  'invalid-link': {
    title: 'Некорректная ссылка на комнату',
    message: 'Проверьте ссылку или создайте новую комнату.',
    retryLabel: null,
    home: true,
  },
  'insecure-context': {
    title: 'Нужен HTTPS',
    message: 'Откройте приложение по HTTPS — иначе браузер не даст доступ к камере и микрофону.',
    retryLabel: null,
    home: false,
  },
  'webrtc-unsupported': {
    title: 'WebRTC не поддерживается',
    message:
      'Ваш браузер не поддерживает видеозвонки (WebRTC). Используйте Chrome, Firefox или Edge версии 100+.',
    retryLabel: null,
    home: false,
  },
};

export interface StatusScreenProps {
  reason: StatusReason;
  onRetry?: () => void;
  onHome?: () => void;
}

export function StatusScreen({ reason, onRetry, onHome }: StatusScreenProps) {
  const { title, message, retryLabel, home } = STATUS_CONTENT[reason];

  return (
    <main className="screen" role="alert">
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="screen__actions">
        {retryLabel !== null && onRetry && (
          <button type="button" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
        {home && onHome && (
          <button type="button" className="button--secondary" onClick={onHome}>
            На главную
          </button>
        )}
      </div>
    </main>
  );
}
