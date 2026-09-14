import type { ChatMessage, MediaState } from '@vcr/shared';
import type { TokenBucket } from '../chat/TokenBucket';

export interface Participant {
  /** UUID. */
  id: string;
  /** Только для адресной доставки; наружу не отдаётся. */
  socketId: string;
  name: string;
  joinedAt: number;
  /** Антифлуд чата; создаётся при входе, у каждого участника свой. */
  chatBucket: TokenBucket;
  /** Этап 3: начальное значение из room:join, дальше — media:update. */
  media: MediaState;
  /**
   * Этап 4: глобальный монотонный порядок входа, проставляет RoomRegistry.join. Задаёт роли
   * offer/answer; joinedAt для этого не годится — два входа могут прийтись на одну миллисекунду.
   */
  joinSeq: number;
  /** Этап 4: антифлуд сигналинга; создаётся при входе, у каждого участника свой. */
  signalBucket: TokenBucket;
}

export interface Room {
  id: string;
  createdAt: number;
  /** Порядок вставки = порядок входа. */
  participants: Map<string, Participant>;
  /** История чата, ≤ CHAT_HISTORY_LIMIT; порядок = порядок добавления на сервере. */
  messages: ChatMessage[];
}
