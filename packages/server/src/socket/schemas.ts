import { ICE_CANDIDATE_MAX_LENGTH, SDP_MAX_LENGTH } from '@vcr/shared';
import { z } from 'zod';

/** Состояние микрофона и камеры (этап 3): room:join.media и media:update. */
export const MediaStateSchema = z.strictObject({
  audio: z.boolean(),
  video: z.boolean(),
});

/** Структура room:join. Формат roomId и имя окончательно проверяют isValidRoomId и validateName. */
export const JoinRequestSchema = z.strictObject({
  roomId: z.string().max(64),
  // Грубый потолок до нормализации; точная длина в code points — в validateName.
  name: z.string().max(200),
  media: MediaStateSchema,
});

/** Структура chat:send. Лишние поля (authorId, authorName) — INVALID_PAYLOAD: автора задаёт сервер. */
export const ChatSendSchema = z.strictObject({
  // Грубый потолок до нормализации; точная длина в code points — в validateMessage.
  text: z.string().max(8000),
});

/** ICE-кандидат (этап 4). Лимиты — грубый потолок против раздувания relay, не разбор синтаксиса. */
export const IceCandidateSchema = z.strictObject({
  candidate: z.string().max(ICE_CANDIDATE_MAX_LENGTH),
  sdpMid: z.string().max(32).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

/** Структура signal (этап 4). from не принимается: отправителя задаёт сервер. */
export const SignalSchema = z.strictObject({
  to: z.uuid(),
  data: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('offer'), sdp: z.string().min(1).max(SDP_MAX_LENGTH) }),
    z.strictObject({ type: z.literal('answer'), sdp: z.string().min(1).max(SDP_MAX_LENGTH) }),
    z.strictObject({ type: z.literal('candidate'), candidate: IceCandidateSchema }),
  ]),
});
