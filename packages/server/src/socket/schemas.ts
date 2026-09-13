import { z } from 'zod';

/** Структура room:join. Формат roomId и имя окончательно проверяют isValidRoomId и validateName. */
export const JoinRequestSchema = z.strictObject({
  roomId: z.string().max(64),
  // Грубый потолок до нормализации; точная длина в code points — в validateName.
  name: z.string().max(200),
});
