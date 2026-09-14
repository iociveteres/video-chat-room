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
