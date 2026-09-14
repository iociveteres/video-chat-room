import { parseRoute } from '../app/router';

/**
 * Нужно ли выйти из комнаты после навигации по истории (кнопки «Назад»/«Вперёд»):
 * да, если сессия привязана к комнате, а новый адрес ведёт не в неё.
 */
export function shouldLeaveOnNavigation(pathname: string, sessionRoomId: string | null): boolean {
  if (sessionRoomId === null) return false;
  const route = parseRoute(pathname);
  return !(route.name === 'room' && route.roomId === sessionRoomId);
}
