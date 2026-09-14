import type { ChatMessage } from '@vcr/shared';
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
}

export interface Room {
  id: string;
  createdAt: number;
  /** Порядок вставки = порядок входа. */
  participants: Map<string, Participant>;
  /** История чата, ≤ CHAT_HISTORY_LIMIT; порядок = порядок добавления на сервере. */
  messages: ChatMessage[];
}
