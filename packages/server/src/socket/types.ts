import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@vcr/shared';
import type { Server, Socket } from 'socket.io';
import type { ChatService } from '../chat/ChatService';
import type { TokenBucket } from '../chat/TokenBucket';
import type { Logger } from '../logger';
import type { RoomRegistry } from '../rooms/RoomRegistry';

export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface HandlerContext {
  io: AppServer;
  registry: RoomRegistry;
  chat: ChatService;
  logger: Logger;
  /** Антифлуд нового участника; лимиты задаются опциями сервера. */
  createChatBucket: () => TokenBucket;
}
