import {
  CONNECT_TIMEOUT_MS,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@vcr/shared';
import { io, type Socket } from 'socket.io-client';

export type AppClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Один сокет на одну сессию в комнате. Same-origin: io() без URL (в dev проксирует Vite).
 * Автопереподключения нет по PRD, подключение запускает RoomSession после навешивания слушателей.
 */
export function createSocket(): AppClientSocket {
  return io({ autoConnect: false, reconnection: false, timeout: CONNECT_TIMEOUT_MS });
}
