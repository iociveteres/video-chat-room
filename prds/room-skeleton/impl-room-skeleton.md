# Implementation Plan

> **Фича:** `room-skeleton` (этап 1 из 5) · **PRD:** `prd-video-chat-room.md` v1.0 · **TDD:** [`design-room-skeleton-v2.md`](design-room-skeleton-v2.md)
> **Зависит от:** — (первый этап). **Блокирует:** этапы 2–5.
> Каждая задача верхнего уровня — один PR, ≤ 1 рабочего дня. `FR-N` — номер функционального требования из PRD §4 (в скобках ID тест-задания), `US-N` — user story из PRD §3, `§N` — раздел TDD.

- [x] 1. Каркас монорепозитория и инструменты
  - npm workspaces с пустыми пакетами `shared`/`server`/`client` и `e2e/`, общий TS/ESLint/Prettier/Vitest
  - 1.1 Корневой `package.json`: `workspaces: ["packages/*", "e2e"]`, `"type": "module"`, `engines.node >= 22`, скрипты `typecheck`, `lint`, `test`
  - 1.2 `tsconfig.base.json` (strict, ES2022, `moduleResolution: bundler`), `tsconfig` в каждом пакете, `tsc -b`
  - 1.3 `eslint.config.js`: typescript-eslint, `eslint-plugin-react-hooks`, `react/no-danger: error`; Prettier
  - 1.4 `vitest.config.ts` с `test.projects: ["packages/*"]`; smoke-тест в каждом пакете
  - 1.5 `@vcr/shared`: `"exports": "./src/index.ts"` (без отдельной сборки)
  - 1.6 `.gitignore`: добавить `playwright-report/`, `test-results/`, `*.pem`
  - _Requirements: PRD §7 (обязательный стек), Design: §1.4, §2, §3.2, §3.3, §12.1_

- [ ] 2. `@vcr/shared`: константы, валидация, генерация id, контракт этапа 1
  - Общий код для клиента и сервера без зависимостей от DOM/Node
  - 2.1 `constants.ts`: `MAX_PARTICIPANTS`, `NAME_MAX_LENGTH`, `ROOM_ID_PATTERN`, `GENERATED_ROOM_ID_LENGTH`, `ACK_TIMEOUT_MS`, `CONNECT_TIMEOUT_MS`
  - 2.2 `validation.ts`: `normalizeName` (NFC → схлопывание пробелов → trim), `validateName` (whitelist `\p{L}\p{M}\p{N} ._-`, хотя бы одна буква/цифра, ≤ 30 code points), `isValidRoomId`
  - 2.3 `ids.ts`: `generateRoomId()` через `crypto.getRandomValues`
  - 2.4 `protocol.ts`: `ParticipantDTO`, `ServerErrorCode`, `Ack`, `JoinRequest`, `JoinAck`, `ClientToServerEvents`, `ServerToClientEvents`, `InterServerEvents`, `SocketData`
  - 2.5 Unit-тесты: пустое/пробелы, 30/31 code point, кириллица, NFD→NFC, эмодзи и `<>`, «только `._-`»; `generateRoomId` — длина, алфавит, 10 000 генераций без коллизий
  - _Requirements: FR-1 (F-01), FR-2 (F-02), FR-30, FR-38, US-1, Design: §4.1, §11.1_

- [ ] 3. Сервер: `RoomRegistry` с атомарным лимитом
  - In-memory модель комнат, синхронные `join`/`leave`
  - 3.1 `rooms/types.ts`: `Participant`, `Room`
  - 3.2 `RoomRegistry`: `join` (создать → проверить лимит → добавить, **без `await`**, тип возврата не `Promise`), `leave` (идемпотентно, удаляет пустую комнату), `getRoom`, `getParticipant`, `listParticipants` (по `joinedAt`), `roomCount`; DI `now`, `maxParticipants`
  - 3.3 Комментарий-предупреждение об атомарности в `join`
  - 3.4 Unit-тесты: создание при первом join; 5-й → `ROOM_FULL`; leave удаляет пустую комнату; повторный leave → `null`; повторный join после удаления создаёт новый `Room`; одинаковые имена; порядок
  - _Requirements: FR-5, FR-7 (F-05), FR-9, FR-29, FR-30, US-5, US-10, Design: §4.2, §4.2.1, §5, §11.1_

- [ ] 4. Сервер: HTTP/Socket.io bootstrap
  - `createAppServer` для dev, prod-like режима и тестов (`port: 0`)
  - 4.1 `config.ts`: `PORT`, `HOST`, `TLS_KEY_PATH`/`TLS_CERT_PATH`, `CLIENT_DIST_DIR`, `SOCKET_PING_INTERVAL_MS`/`SOCKET_PING_TIMEOUT_MS`, `LOG_LEVEL`
  - 4.2 `logger.ts`: уровни, без PII (только `roomId`, `participantId`)
  - 4.3 `app.ts`: http/https-сервер, Socket.io с опциями `pingInterval 10s`, `pingTimeout 5s`, `maxHttpBufferSize 100KB`, `serveClient: false`, без CORS и `connectionStateRecovery`; `listen()`/`close()`
  - 4.4 Express: `express.static` (`/assets/*` с `immutable`), SPA fallback для `/` и `/r/:roomId`, `GET /healthz`, CSP-заголовок
  - 4.5 `index.ts` + скрипты `dev` (`tsx watch`) и `build` (`tsup`, бандлит `@vcr/shared`)
  - 4.6 Integration-тест: `/healthz` отвечает `200`, SPA fallback отдаёт `index.html`
  - _Requirements: FR-35 (серверная часть), PRD §7 (HTTPS), Design: §4.2 (`app.ts`), §6.1, §10 (CSP), §12.2, §12.3_

- [ ] 5. Сервер: обработчики `room:join` / `room:leave` / `disconnect`
  - Вход, выход и обрыв с рассылкой `participant:*`
  - _После задач 3, 4_
  - 5.1 `socket/schemas.ts`: `JoinRequestSchema` (`.strict()`)
  - 5.2 `registerSocketHandlers.ts` + обёртка `safeHandler` (try/catch → ack `INTERNAL`, `logger.error`)
  - 5.3 `handlers/room.ts`: проверка ack-функции → zod → `isValidRoomId` → `validateName` → `ALREADY_JOINED` → атомарная секция (`registry.join` + `socket.data` + `socket.join`) → ack новичку → broadcast `participant:joined`
  - 5.4 `adapterRoom(id) = "room:" + id`
  - 5.5 `leaveCurrentRoom.ts`: идемпотентный выход, `participant:left` только если комната не удалена; `room:leave` и `disconnect` вызывают его
  - _Requirements: FR-4 (F-04), FR-5, FR-6, FR-7, FR-8, FR-9, FR-26 (F-16), FR-27 (F-17), FR-28, FR-31 (F-18), FR-32, US-4, US-5, US-9, US-10, US-11, Design: §4.2 (`handlers/room.ts`, `leaveCurrentRoom.ts`), §6.2, §6.3, §7.2, §7.4, §8_

- [ ] 6. Сервер: integration-тесты сокет-контракта
  - Регрессионная защита атомарности и жизненного цикла комнаты
  - _После задачи 5_
  - 6.1 Хелпер `startTestServer()` и фабрика клиентов (`transports: ['websocket']`, `forceNew`, `reconnection: false`)
  - 6.2 Вход двух клиентов: `participants` из двух элементов, `participant:joined` у первого
  - 6.3 **Гонка за последний слот**: 3 в комнате + 2 одновременных join → 1 `ok`, 1 `ROOM_FULL`
  - 6.4 **5 одновременных** join в пустую комнату → 4 `ok`, 1 `ROOM_FULL`, прогон 50 раз
  - 6.5 Disconnect → `participant:left`; последний вышел → `getRoom === undefined`, новый join создаёт пустую комнату
  - 6.6 Невалидные payload (`{}`, `name: "<b>"`, `roomId: "../x"`, лишние поля) → `INVALID_*`; `ALREADY_JOINED`; изоляция комнат X/Y
  - _Requirements: FR-7, FR-8, FR-9, FR-31, FR-38, US-5, US-10, US-11, Design: §4.2.1, §11.2, §13_

- [ ] 7. Клиент: каркас Vite + React, гейт окружения и роутер
  - Приложение открывается, проверяет окружение и различает маршруты
  - _После задачи 2_
  - 7.1 `packages/client`: Vite, React 19, `@vitejs/plugin-basic-ssl`, `server.host: true`, proxy `/socket.io` → `:3000` (`ws: true`)
  - 7.2 `main.tsx`, `App.tsx`, `ErrorBoundary` с экраном «Что-то пошло не так»
  - 7.3 `app/environment.ts`: `checkEnvironment()` — сначала `isSecureContext`, потом `RTCPeerConnection`/`getUserMedia`
  - 7.4 `app/router.ts`: `parseRoute` (`/`, `/r/:roomId`, `invalid-link`), `useRoute`, `navigate`
  - 7.5 Корневой `npm run dev` через `concurrently`
  - 7.6 Unit-тесты: `checkEnvironment` (3 исхода на подменённом `window`), `parseRoute` (`/`, `/r/abc`, `/r/`, `/r/<script>`)
  - _Requirements: FR-4, FR-36, US-13, PRD §7 (HTTPS), Design: §3.1, §4.3 (`environment.ts`, `router.ts`), §8, §12.2_

- [ ] 8. Клиент: состояние приложения (`appReducer`)
  - Чистый сериализуемый state и провайдер
  - _После задачи 2_
  - 8.1 `state/actions.ts`, `state/appReducer.ts`: `AppState`, `SessionPhase`, `JoinFailure`, все `AppAction` этапа 1
  - 8.2 Инварианты: `PARTICIPANT_*` вне `joined` игнорируются, upsert/no-op, `LEFT_ROOM`/`JOIN_FAILED` сохраняют `displayName`
  - 8.3 `state/selectors.ts`, `state/AppStateProvider.tsx` (`useReducer`, контекст)
  - 8.4 Unit-тесты на все переходы state-diagram
  - _Requirements: FR-26, FR-28, FR-30, Design: §3.1 (принцип 3), §4.3 (`appReducer.ts`), §11.1_

- [ ] 9. Клиент: `RoomSession` и сокет
  - Владелец side effects: подключение, вход, выход, обрыв
  - _После задач 5, 8_
  - 9.1 `net/createSocket.ts`: `io({ autoConnect: false, reconnection: false, timeout: CONNECT_TIMEOUT_MS })`
  - 9.2 `RoomSession.join`: `JOIN_REQUESTED` → слушатели до `connect()` → `connect_error`/таймаут → `SERVER_UNAVAILABLE` → `socket.timeout(ACK_TIMEOUT_MS).emit('room:join', …, cb)` (**callback-ack, без `emitWithAck`**) → маппинг кодов ошибок
  - 9.3 `disconnect` в фазе `joined` (кроме `io client disconnect`) → `CONNECTION_LOST`; no-op при повторном `join` в фазе `joining`
  - 9.4 `leave()` (ack до 2 с → `disconnect`), `dispose()`
  - 9.5 `AppStateProvider`: `RoomSession` в `useRef`; `popstate` из `/r/:id` → `leave()`; `pagehide` → `socket.disconnect()`
  - 9.6 Unit-тесты на фейковом сокете: успех, `ROOM_FULL`, таймаут connect/ack, обрыв, двойной join
  - _Requirements: FR-4, FR-8, FR-28, FR-31, FR-35, US-4, US-10, US-11, US-13, Design: §4.3 (`createSocket.ts`, `RoomSession.ts`), §7.1, §7.4, §8, §13_

- [ ] 10. Клиент UI: стартовый экран и экраны статусов
  - `LobbyPage`, `NameForm`, `StatusScreen`
  - _После задач 7, 9_
  - 10.1 `NameForm`: `<input maxLength={30}>`, живая подсказка по `validateName`, кнопка неактивна при невалидном имени
  - 10.2 `LobbyPage`: «Создать комнату» → `generateRoomId()` → `session.join` (из обработчика submit, не из `useEffect`) → `navigate('/r/' + id)`
  - 10.3 `StatusScreen`: тексты и действия для `ROOM_FULL`, `SERVER_UNAVAILABLE`, `CONNECTION_LOST`, `INTERNAL`, `invalid-link`, `insecure-context`, `webrtc-unsupported`
  - 10.4 Component-тесты: подсказки и `disabled` у `NameForm`, тексты и кнопки `StatusScreen`
  - _Requirements: FR-1 (F-01), FR-2 (F-02), FR-8, FR-35, FR-36, FR-38, US-1, US-2, US-5, US-13, Design: §4.3 (страницы и компоненты), §8, §11.3_

- [ ] 11. Клиент UI: экран комнаты
  - `RoomPage`, `RoomHeader`, `ParticipantList`, `CopyLinkButton`
  - _После задачи 10_
  - 11.1 `RoomPage`: `displayName === null` → `NameForm` с «Войти»; иначе рендер по `phase` (спиннер / комната / `StatusScreen`)
  - 11.2 `RoomHeader`: id комнаты, `CopyLinkButton`, «Выйти»
  - 11.3 `CopyLinkButton`: `navigator.clipboard.writeText(location.href)` → тост «Ссылка скопирована»; fallback — выделенное поле с URL
  - 11.4 `ParticipantList`: имена по `joinedAt` текстовыми узлами, пометка «(вы)», ключи по `id`
  - 11.5 Component-тест: имя `<img onerror>` рендерится текстом
  - _Requirements: FR-3 (F-03), FR-4 (F-04), FR-26 (F-16), FR-27 (F-17), FR-30, FR-39, US-3, US-4, US-9, US-10, Design: §4.3 (страницы и компоненты), §8, §10 (XSS), §11.3_

- [ ] 12. E2E: Playwright и сценарии этапа 1
  - Сквозная проверка комнаты в Chromium
  - _После задачи 11_
  - 12.1 `e2e/playwright.config.ts`: `webServer` (сервер + Vite), `http://localhost`, отдельный `browser.newContext()` на участника; скрипт `test:e2e`
  - 12.2 `room-skeleton.spec.ts`: A создаёт → B входит по ссылке → оба видят двоих
  - 12.3 4 участника + 5-й «Комната заполнена» → один выходит → «Повторить вход» успешен
  - 12.4 B закрывает страницу → список у A обновляется ≤ 2 с
  - 12.5 `page.route('**/socket.io/**', abort)` → «Сервер недоступен»
  - 12.6 «Скопировать ссылку» с `grantPermissions` → в буфере URL комнаты
  - _Requirements: FR-1…FR-9, FR-26, FR-27, FR-35, US-2, US-3, US-4, US-5, US-10, US-13, Design: §11.4_
