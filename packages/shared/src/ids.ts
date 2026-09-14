import { GENERATED_ROOM_ID_LENGTH } from './constants';

// Пакет не подключает ни DOM, ни Node lib, поэтому описываем только нужную часть Web Crypto API.
// Глобальный `crypto` есть и в браузере, и в Node ≥ 19.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

/** 64 символа: байт & 63 даёт равномерное распределение без смещения. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Криптостойкий идентификатор комнаты из алфавита [A-Za-z0-9_-]. */
export function generateRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_ROOM_ID_LENGTH));
  let id = '';
  for (const byte of bytes) id += ALPHABET[byte & 63];
  return id;
}
