export interface Participant {
  /** UUID. */
  id: string;
  /** Только для адресной доставки; наружу не отдаётся. */
  socketId: string;
  name: string;
  joinedAt: number;
}

export interface Room {
  id: string;
  createdAt: number;
  /** Порядок вставки = порядок входа. */
  participants: Map<string, Participant>;
}
