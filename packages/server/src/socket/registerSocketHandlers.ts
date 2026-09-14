import { registerChatHandlers } from './handlers/chat';
import { registerMediaHandlers } from './handlers/media';
import { registerRoomHandlers } from './handlers/room';
import { registerSignalHandlers } from './handlers/signal';
import type { HandlerContext } from './types';

export function registerSocketHandlers(ctx: HandlerContext): void {
  ctx.io.on('connection', (socket) => {
    ctx.logger.debug('Socket connected', { socketId: socket.id });
    registerRoomHandlers(ctx, socket);
    registerChatHandlers(ctx, socket);
    registerMediaHandlers(ctx, socket);
    registerSignalHandlers(ctx, socket);
  });
}
