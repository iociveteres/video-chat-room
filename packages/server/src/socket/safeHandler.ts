import { ackError } from './ack';
import type { AppSocket, HandlerContext } from './types';

/**
 * Оборачивает обработчик события: исключение не роняет процесс, а логируется,
 * и клиент получает ack INTERNAL (если передал ack-функцию последним аргументом).
 * Повторный вызов ack Socket.io игнорирует, так что ошибка после успешного ack безопасна.
 */
export function safeHandler<Args extends unknown[]>(
  ctx: HandlerContext,
  socket: AppSocket,
  event: string,
  handler: (...args: Args) => void,
): (...args: Args) => void {
  return (...args) => {
    try {
      handler(...args);
    } catch (err) {
      ctx.logger.error(`Unhandled error in "${event}" handler`, {
        err,
        socketId: socket.id,
        roomId: socket.data.roomId,
        participantId: socket.data.participantId,
      });
      const ack = args.at(-1);
      if (typeof ack === 'function') (ack as (res: unknown) => void)(ackError('INTERNAL'));
    }
  };
}
