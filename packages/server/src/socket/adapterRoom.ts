/**
 * Имя комнаты в адаптере Socket.io. Префикс обязателен: каждый сокет автоматически состоит
 * в комнате с именем своего socket.id, и roomId, совпавший с чьим-то socket.id,
 * иначе доставлял бы broadcast не тем адресатам.
 */
export function adapterRoom(roomId: string): string {
  return `room:${roomId}`;
}
