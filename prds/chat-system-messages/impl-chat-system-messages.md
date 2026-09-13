# Implementation Plan

> **Фича:** `chat-system-messages` (этап 2 из 5) · **PRD:** `prd-video-chat-room.md` v1.0 · **TDD:** [`design-chat-system-messages-v2.md`](design-chat-system-messages-v2.md)
> **Зависит от:** этапа 1 [`room-skeleton`](../room-skeleton/impl-room-skeleton.md) целиком. **Блокирует:** этап 3 (общий слот `notice`).
> Каждая задача верхнего уровня — один PR, ≤ 1 рабочего дня. `FR-N` — номер функционального требования из PRD §4 (в скобках ID тест-задания), `US-N` — user story из PRD §3, `§N` — раздел TDD.

- [ ] 1. `@vcr/shared`: контракт чата и валидация сообщений
  - Аддитивное расширение протокола, общая нормализация текста
  - 1.1 `constants.ts`: `MESSAGE_MAX_LENGTH = 1000`, `CHAT_HISTORY_LIMIT = 200`, `CHAT_RATE_LIMIT = { burst: 5, refillPerSecond: 1 }`
  - 1.2 `validation.ts`: `normalizeMessage` (CRLF/CR → LF, удаление C0/C1 кроме `\n`/`\t`, удаление bidi-override U+202A–U+202E и U+2066–U+2069, NFC, trim), `validateMessage` (`EMPTY`/`TOO_LONG`, длина в code points)
  - 1.3 `protocol.ts`: `SystemEvent`, `ChatMessage` (`user` | `system`), коды `INVALID_MESSAGE`, `RATE_LIMITED`, `JoinAck.messages`, события `chat:send` (ack) и `chat:message`
  - 1.4 Временная заглушка на сервере `messages: []` в join-ack, чтобы сборка оставалась зелёной до задачи 4
  - 1.5 Unit-тесты: `""`, `"   "`, `"\n\t"`, CRLF, `"‮abc"` → `"abc"`, 1000/1001 code points, эмодзи на границе
  - _Requirements: FR-24, FR-39, FR-40, US-8, Design: §4.1, §6.4, §8, §10, §11.1_

- [ ] 2. Сервер: `TokenBucket` и `ChatService`
  - Синхронные сервисы антифлуда и истории
  - _После задачи 1_
  - 2.1 `chat/TokenBucket.ts`: `tryTake()` с пополнением по прошедшему времени, DI `now`
  - 2.2 `rooms/types.ts`: `Room.messages: ChatMessage[]`, `Participant.chatBucket: TokenBucket` (создаётся при join)
  - 2.3 `chat/ChatService.ts`: `appendUserMessage`, `appendSystemMessage`, `getHistory` (копия); вытеснение старейшего при `historyLimit`; DI `now`, `newId`
  - 2.4 Unit-тесты `TokenBucket`: 5 × `true`, 6-й `false`, через 1 с снова `true`, не больше `capacity`
  - 2.5 Unit-тесты `ChatService`: порядок, 201-е вытесняет 1-е, копия истории, снимки `authorName`/`participantName`
  - _Requirements: FR-9, FR-23 (F-14), FR-40, Design: §3 (ключевые решения), §4.2 (`TokenBucket`, `ChatService`), §5, §11.1_

- [ ] 3. Сервер: обработчик `chat:send`
  - Приём, валидация и broadcast пользовательских сообщений
  - _После задачи 2_
  - 3.1 `HandlerContext.chat: ChatService`; хелпер `getMembership(ctx, socket)`
  - 3.2 `ChatSendSchema` (`{ text: z.string().max(8000) }.strict()`)
  - 3.3 `handlers/chat.ts`: ack-функция → членство (`NOT_IN_ROOM`) → схема (`INVALID_PAYLOAD`) → `validateMessage` (`INVALID_MESSAGE`) → `chatBucket.tryTake()` (`RATE_LIMITED`) → `appendUserMessage` → `io.to(room).emit('chat:message')` → ack `{ ok, messageId }`
  - 3.4 Логи без текста сообщений (только `roomId`, `messageId`, длина)
  - 3.5 Опция сервера для отключения rate limit в тестах
  - 3.6 Integration-тесты: 3 клиента получают одинаковый `chat:message`, ack отправителю; пустой / 1001 символ / `{ text: 1 }` / лишнее поле; `chat:send` до join → `NOT_IN_ROOM`; 10 синхронных → 5 `ok` + 5 `RATE_LIMITED`; `authorName` в payload → `INVALID_PAYLOAD`
  - _Requirements: FR-21 (F-12), FR-22 (F-13), FR-24, FR-39, FR-40, US-8, Design: §4.2 (`handlers/chat.ts`), §6.1, §6.2, §6.4, §7.1, §10, §11.3_

- [ ] 4. Сервер: системные сообщения и история при входе/выходе
  - Встраивание `ChatService` в join-хендлер и `leaveCurrentRoom`
  - _После задачи 2_
  - 4.1 `handlers/room.ts`: после атомарной секции `appendSystemMessage('participant-joined')` → ack с `messages: getHistory()` → `socket.to(room)` `participant:joined` + `chat:message` (строго в этом порядке)
  - 4.2 `leaveCurrentRoom.ts`: при `!roomDeleted` → `appendSystemMessage('participant-left')` → `participant:left` + `chat:message`; одинаково для `room:leave` и `disconnect`
  - 4.3 Удалить заглушку `messages: []` из задачи 1
  - 4.4 Integration-тесты: поздний вход (история A/B + системные события по порядку, без дубля своего `joined`); B `disconnect()` → A получает `participant:left` и системное `participant-left`; все вышли → повторный вход видит только своё `joined`; 205 сообщений (rate limit выключен) → новичок получает 200
  - _Requirements: FR-9, FR-23 (F-14), FR-25 (F-15), FR-27 (F-17), FR-31 (F-18), US-8, US-9, US-10, US-11, Design: §3 (ключевые решения), §4.2 (изменения join и `leaveCurrentRoom`), §6.3, §7.2, §7.3, §11.3, §13_

- [ ] 5. Клиент: срез `chat`, `notice` и `RoomSession.sendChatMessage`
  - Состояние чата, общий слот тостов и отправка через сокет
  - _После задачи 1_
  - 5.1 `AppState.chat` (`messages`, `messageIds` как `Record<string, true>`), `AppState.notice`
  - 5.2 Действия `CHAT_MESSAGE_RECEIVED`, `CHAT_SEND_FAILED`, `NOTICE_DISMISSED`; `JOIN_SUCCEEDED` принимает `messages`
  - 5.3 Правила reducer: история из ack, дедуп по `id`, обрезка до 200, игнор вне `joined`, очистка на `LEFT_ROOM`/`JOIN_FAILED`/`CONNECTION_LOST`, тексты тостов по коду
  - 5.4 `RoomSession`: слушатель `chat:message` до `connect()`; `sendChatMessage(text): Promise<boolean>` на callback-ack с `socket.timeout(ACK_TIMEOUT_MS)`; `TIMEOUT` → `CHAT_SEND_FAILED`; `NOT_IN_ROOM` молча игнорируется
  - 5.5 Unit-тесты reducer (chat) и `sendChatMessage` на фейковом сокете
  - _Requirements: FR-21, FR-23, FR-24, FR-40, US-8, Design: §4.3 (`appReducer.ts`, `RoomSession.ts`), §6.4, §8, §11.1_

- [ ] 6. Клиент: форматирование времени, системных сообщений и linkify
  - Чистые функции отображения
  - 6.1 `features/chat/formatTime.ts`: `Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false })`, один форматтер на модуль
  - 6.2 `features/chat/formatSystemMessage.ts`: `{ name, action: 'присоединился' | 'отключился' }`
  - 6.3 `features/chat/linkify.ts`: регулярка кандидатов, отрезание хвостовой пунктуации и непарных скобок, `new URL` в try/catch, только `http:`/`https:`, без распознавания `www.` без схемы
  - 6.4 Unit-тесты: `TZ=Europe/Moscow` → `"09:05"`; оба системных события; linkify — `https://a.b/c`, парная скобка, хвостовые `.,!?»)`, `javascript:`/`data:`/`ftp:`/`www.` → текст, невалидный URL, несколько ссылок, IDN → punycode в `href`
  - _Requirements: FR-22 (F-13), FR-25 (F-15), FR-39, US-8, US-9, Design: §4.3 (компоненты), §4.3.1, §4.3.3, §11.1_

- [ ] 7. Клиент UI: лента сообщений
  - `ChatPanel`, `MessageList`, элементы сообщений, автопрокрутка
  - _После задач 5, 6_
  - 7.1 `MessageText.tsx`: сегменты linkify → текстовые узлы и `<a target="_blank" rel="noopener noreferrer nofollow" title={href}>`
  - 7.2 `UserMessageItem.tsx`: имя, `formatTime(ts)`, `MessageText`, модификатор `--own` по `authorId === selfId`; `memo`
  - 7.3 `SystemMessageItem.tsx`: `<strong>{name}</strong> {action}`, приглушённый стиль, время
  - 7.4 `useStickToBottom.ts` (`useLayoutEffect` на `messages.length`) и `MessageList.tsx` (`<ol role="log" aria-live="polite">`, ключ `message.id`)
  - 7.5 `ChatPanel.tsx`: контейнер `MessageList` + место под `MessageInput`
  - 7.6 Component-тесты: `<img src=x onerror=…>` рендерится текстом; автопрокрутка (подмена `scrollHeight`); `<b>x</b>` в имени системного сообщения — текст; ссылка с безопасными атрибутами, нет `a[href^="javascript"]`
  - _Requirements: FR-22 (F-13), FR-23 (F-14), FR-25 (F-15), FR-39, US-8, US-9, Design: §4.3 (компоненты), §4.3.1, §4.3.3, §10, §11.2_

- [ ] 8. Клиент UI: поле ввода, тосты и раскладка комнаты
  - `MessageInput`, отображение `notice`, боковая панель в `RoomPage`
  - _После задачи 7_
  - 8.1 `MessageInput.tsx`: `<textarea>`, Enter отправляет, Shift+Enter — перенос, при `nativeEvent.isComposing` не отправляет; кнопка неактивна, пока `validateMessage(draft)` не `ok`; счётчик от 900 символов; очистка поля сразу, возврат текста при `false`
  - 8.2 Компонент тоста для `state.notice` с `NOTICE_DISMISSED` (переиспользуется этапами 3–4)
  - 8.3 `RoomPage`: CSS Grid `1fr 340px`, справа `ParticipantList` + `ChatPanel`; `MessageList` с `overflow-y: auto; min-height: 0`; текст `white-space: pre-wrap; overflow-wrap: anywhere`
  - 8.4 Component-тесты `MessageInput`: Enter / Shift+Enter / `isComposing` / disabled / возврат текста
  - _Requirements: FR-21 (F-12), FR-24, FR-40, US-8, PRD §6 (экран комнаты, ≥ 1024px), Design: §4.3 (компоненты, отправка), §4.3.2, §6.4, §8, §11.2_

- [ ] 9. E2E: сценарии чата и пороги покрытия
  - Сквозная проверка чата в Chromium
  - _После задачи 8_
  - 9.1 `e2e/tests/chat.spec.ts`: A пишет → у B имя и время `/^\d{2}:\d{2}$/`
  - 9.2 XSS: `<img src=x onerror="window.__xss=1">` → `window.__xss === undefined`, `dialog` не срабатывает, текст виден как есть
  - 9.3 Поздний вход: C видит историю; системные «C присоединился» / «C отключился» у A
  - 9.4 Автопрокрутка: 30 сообщений с паузами → последнее `toBeInViewport()`; пустое сообщение → кнопка `toBeDisabled()`
  - 9.5 Ссылка «см. https://example.com/doc.» → `href` без точки, новая вкладка через `context.route`, `window.opener === null`
  - 9.6 Пороги покрытия в Vitest: `ChatService`, `TokenBucket`, `validation` ≥ 95%; chat-срез reducer ≥ 90%; компоненты чата ≥ 80%
  - 9.7 Ручная проверка в Chrome + Firefox по LAN (чек-лист мёржа)
  - _Requirements: FR-21…FR-25, FR-31, FR-39, US-8, US-9, US-10, US-11, Design: §11.4, §11.5, §12_
