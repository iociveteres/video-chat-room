import { randomUUID } from 'node:crypto';
import { CHAT_HISTORY_LIMIT, type ChatMessage, type SystemEvent } from '@vcr/shared';
import type { RoomRegistry } from '../rooms/RoomRegistry';
import type { Participant } from '../rooms/types';

export interface ChatServiceDeps {
  registry: RoomRegistry;
  historyLimit?: number;
  now?: () => number;
  newId?: () => string;
}

/**
 * История чата комнаты. Сообщения живут в Room.messages и удаляются вместе с комнатой (FR-9).
 * Все методы синхронные: снимок истории при входе и socket.join выполняются в одном блоке,
 * поэтому в истории новичка нет ни дыр, ни дублей (TDD §4.2).
 */
export class ChatService {
  private readonly registry: RoomRegistry;
  private readonly historyLimit: number;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(deps: ChatServiceDeps) {
    this.registry = deps.registry;
    this.historyLimit = deps.historyLimit ?? CHAT_HISTORY_LIMIT;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? randomUUID;
  }

  /** text должен быть уже проверен validateMessage. Имя автора копируется в сообщение. */
  appendUserMessage(roomId: string, author: Participant, text: string): ChatMessage {
    return this.append(roomId, {
      kind: 'user',
      id: this.newId(),
      ts: this.now(),
      authorId: author.id,
      authorName: author.name,
      text,
    });
  }

  appendSystemMessage(roomId: string, event: SystemEvent, subject: Participant): ChatMessage {
    return this.append(roomId, {
      kind: 'system',
      id: this.newId(),
      ts: this.now(),
      event,
      participantId: subject.id,
      participantName: subject.name,
    });
  }

  /** Копия истории от старых к новым; для неизвестной комнаты — []. */
  getHistory(roomId: string): ChatMessage[] {
    return [...(this.registry.getRoom(roomId)?.messages ?? [])];
  }

  private append(roomId: string, message: ChatMessage): ChatMessage {
    const room = this.registry.getRoom(roomId);
    // Вызывающий код гарантирует членство; отсутствие комнаты — баг сервера.
    if (!room) throw new Error(`Room ${roomId} does not exist`);
    room.messages.push(message);
    // При 200 элементах shift() дешевле любого кольцевого буфера по сложности кода.
    while (room.messages.length > this.historyLimit) room.messages.shift();
    return message;
  }
}
