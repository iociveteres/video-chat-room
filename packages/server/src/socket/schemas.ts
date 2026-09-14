import { z } from 'zod';

/** Структура room:join. Формат roomId и имя окончательно проверяют isValidRoomId и validateName. */
export const JoinRequestSchema = z.strictObject({
  roomId: z.string().max(64),
  // Грубый потолок до нормализации; точная длина в code points — в validateName.
  name: z.string().max(200),
});

/** Структура chat:send. Лишние поля (authorId, authorName) — INVALID_PAYLOAD: автора задаёт сервер. */
export const ChatSendSchema = z.strictObject({
  // Грубый потолок до нормализации; точная длина в code points — в validateMessage.
  text: z.string().max(8000),
});
