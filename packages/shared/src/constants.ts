/** Максимум участников в одной комнате (FR-7). */
export const MAX_PARTICIPANTS = 4;

/** Максимальная длина отображаемого имени, в code points (FR-2). */
export const NAME_MAX_LENGTH = 30;

/** Допустимый идентификатор комнаты: безопасен в URL и в имени adapter-room. */
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Длина сгенерированного id: 12 символов из 64-символьного алфавита = 72 бита энтропии. */
export const GENERATED_ROOM_ID_LENGTH = 12;

/** Сколько клиент ждёт ack на команду (room:join и т.п.). */
export const ACK_TIMEOUT_MS = 5_000;

/** Сколько клиент ждёт установки соединения с сервером. */
export const CONNECT_TIMEOUT_MS = 5_000;

/** Максимальная длина сообщения чата, в code points после нормализации (FR-40). */
export const MESSAGE_MAX_LENGTH = 1000;

/** Сколько последних сообщений хранит комната и получает новичок при входе (FR-23). */
export const CHAT_HISTORY_LIMIT = 200;

/** Антифлуд на участника: token bucket — всплеск до burst, дальше refillPerSecond (FR-40). */
export const CHAT_RATE_LIMIT = { burst: 5, refillPerSecond: 1 } as const;

/**
 * Подмножество DOM `MediaTrackConstraints`: shared собирается без DOM lib, а клиент
 * передаёт эти объекты в getUserMedia как есть — структура совместима.
 */
export interface MediaConstraintsSpec {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  width?: { ideal?: number; max?: number };
  height?: { ideal?: number; max?: number };
  frameRate?: { ideal?: number; max?: number };
}

/** Ограничения микрофона при захвате (FR-13). */
export const AUDIO_CONSTRAINTS: Readonly<MediaConstraintsSpec> = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** 640×360@24: запас под mesh, где каждый клиент кодирует до 3 исходящих потоков (TDD этапа 3 §4.1). */
export const VIDEO_CONSTRAINTS: Readonly<MediaConstraintsSpec> = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
};
