# Implementation Plan

> **Фича:** `webrtc-peer-call` (этап 4 из 5) · **PRD:** `prd-video-chat-room.md` v1.0 · **TDD:** [`design-webrtc-peer-call.md`](design-webrtc-peer-call.md)
> **Зависит от:** этапа 1 [`room-skeleton`](../room-skeleton/impl-room-skeleton.md) (порядок ack → broadcast, callback-ack), этапа 3 [`local-media-controls`](../local-media-controls/impl-local-media-controls.md) (`MediaController.onTrackChange`, `VideoTile`, хук `window.__vcr`). **Блокирует:** этап 5.
> Каждая задача верхнего уровня — один PR, ≤ 1 рабочего дня. `FR-N` — номер функционального требования из PRD §4 (в скобках ID тест-задания), `US-N` — user story из PRD §3, `§N` — раздел TDD, `I1–I4` — инварианты из §3.2.

- [ ] 1. Контракт сигналинга и порядок входа на сервере
  - `SignalData` в протоколе, `joinSeq` и `signalBucket` у участника
  - 1.1 `protocol.ts`: `IceCandidateDTO`, `SignalData`, событие `signal` в обе стороны
  - 1.2 `constants.ts`: `SDP_MAX_LENGTH`, `ICE_CANDIDATE_MAX_LENGTH`, `SIGNAL_RATE_LIMIT`, `PEER_CONNECT_TIMEOUT_MS`
  - 1.3 `rooms/types.ts`: `Participant.joinSeq`, `Participant.signalBucket`; `RoomRegistry.join` проставляет `joinSeq = this.seq++` внутри синхронной секции
  - 1.4 `schemas.ts`: `IceCandidateSchema`, `SignalSchema` (discriminated union, `.strict()`, лимиты размеров)
  - 1.5 Unit-тесты: `joinSeq` строго монотонен, в том числе для входов в одну миллисекунду; схема отвергает SDP > 32 KB и лишние поля
  - _Requirements: FR-10 (F-06), Design: §3.2 (I1), §4.1, §4.2 (`types.ts`, `schemas.ts`), §5_

- [ ] 2. Сервер: relay `signal`
  - Пересылка адресату в той же комнате с защитой ролей и rate limit
  - _После задачи 1_
  - 2.1 `handlers/signal.ts`: членство → схема → `to !== from` → адресат в той же комнате → проверка ролей (`offer` только от меньшего `joinSeq`, `answer` — наоборот) → `signalBucket.tryTake()` → `io.to(target.socketId).emit('signal', { from, data })`
  - 2.2 Логи отброшенных сообщений: `debug` для невалидных, `warn` для `signal.role-violation` и rate limit; без SDP и кандидатов
  - 2.3 Регистрация в `registerSocketHandlers`
  - 2.4 Integration-тесты: A → B получает только B с `from = A.id`; `to` на себя / в чужую комнату / несуществующему; offer младший → старший и answer старший → младший отброшены; SDP > 32 KB и лишние поля; порядок 200 кандидатов; 500 сигналов → доставлено ≤ burst + refill; отправитель вне комнаты
  - _Requirements: FR-10 (F-06), Design: §3.1, §3.2 (защита в глубину), §4.2 (`handlers/signal.ts`), §6.1, §6.2, §6.3, §10, §11.3_

- [ ] 3. Клиент: RTC-конфигурация и тестовый `FakePeerConnection`
  - Конфиг ICE из env и инфраструктура для unit-тестов ядра
  - 3.1 `call/rtcConfig.ts`: `getRtcConfiguration()`, `parseIceServers(VITE_ICE_SERVERS)` с дефолтом Google STUN ×2, `VITE_ICE_TRANSPORT_POLICY`, `bundlePolicy: 'max-bundle'`, `rtcpMuxPolicy: 'require'`
  - 3.2 Типизация `import.meta.env` для `VITE_ICE_SERVERS`, `VITE_ICE_TRANSPORT_POLICY`, `VITE_E2E`
  - 3.3 `FakePeerConnection`: журнал вызовов, управляемые `deferred` для `createOffer`/`createAnswer`/`setLocalDescription`/`setRemoteDescription`/`addIceCandidate`; фейковые трансиверы (`direction`, `sender.replaceTrack`, `receiver.track.kind`); ручной диспатч `iceconnectionstatechange` и `negotiationneeded`
  - 3.4 Unit-тесты `parseIceServers`: валидный JSON, мусор → дефолт
  - _Requirements: FR-10, FR-34, Design: §4.3, §11.1, §12_

- [ ] 4. Клиент: `PeerSession` — согласование SDP
  - Offerer/answerer с фиксированными трансиверами и сериализацией операций
  - _После задачи 3_
  - 4.1 Каркас: `PeerSessionDeps`, `remoteStream`, `enqueue`/`opChain` (ошибка не рвёт цепочку → `failed`), проверка `closed` после каждого `await`
  - 4.2 `start()` (offerer): `addTransceiver(audio ?? 'audio')`, затем `addTransceiver(video ?? 'video')`, оба `sendrecv` (I2) → `createOffer` → SLD → `sendSignal(offer)`
  - 4.3 `onOffer` (answerer): SRD → поиск трансиверов по `receiver.track.kind`, проверка ровно 2 m-line → `direction = 'sendrecv'` **до** `createAnswer` → `replaceTrack` локальных треков, прочитанных после SRD → `createAnswer` → SLD → `sendSignal(answer)`
  - 4.4 `onAnswer` (offerer): проверка `have-local-offer` → SRD
  - 4.5 `attachRemoteTracks()` из `receiver.track`; `onnegotiationneeded = null` (I1/I3)
  - 4.6 `close()`: идемпотентно, снять обработчики, `pc.close()`, локальные треки не трогать, статус `closed`
  - 4.7 Unit-тесты: журнал offerer без камеры (2 трансивера, audio первым); журнал answerer (`direction` до `createAnswer`); `close()` во время SRD → нет `createAnswer`/`sendSignal`; `negotiationneeded` → нет `createOffer`; повторный offer и answer не вовремя → игнор + warn
  - _Requirements: FR-10 (F-06), US-6, Design: §3.2 (I1, I2, I3), §4.4 (интерфейс, внутреннее состояние, offerer, answerer, `close()`), §7.1, §7.3, §8.2, §11.1_

- [ ] 5. Клиент: `PeerSession` — ICE, `replaceTrack` и статус соединения
  - Буфер кандидатов, смена треков без ренеготиации, таймаут подключения
  - _После задачи 4_
  - 5.1 `handleSignal`: `candidate` до применения remote description → `pendingCandidates`; флаг `remoteDescriptionApplied` выставляется после `await SRD`; `flushPendingCandidates` в исходном порядке (I4)
  - 5.2 `addCandidate` с try/catch (плохой кандидат → warn); исходящие кандидаты через `onicecandidate`
  - 5.3 `replaceTrack(kind, track)` через `opChain`; при отсутствии трансивера — no-op
  - 5.4 Маппинг `iceConnectionState` → `PeerStatus`; `armConnectTimeout` / `clearConnectTimeout` (`failed` через `PEER_CONNECT_TIMEOUT_MS` без закрытия PC); таймаут параметризуется для E2E-сборки
  - 5.5 `getStats()`
  - 5.6 Unit-тесты: 3 кандидата до SRD применяются после resolve; кандидат после SRD — сразу; буфер у offerer до answer; reject одного кандидата не делает `failed`; `replaceTrack(T1)` + `replaceTrack(null)` → итог `null`; гонка «камеру выключили во время `onOffer`» → `null`; маппинг состояний; фейковые таймеры 20 с → `failed`, потом `connected`
  - _Requirements: FR-10, FR-17, FR-19, FR-34, US-7, Design: §3.2 (I3, I4), §4.4 (ICE-кандидаты, `replaceTrack`, статус соединения), §7.2, §8.2, §11.1_

- [ ] 6. Клиент: `PeerManager`
  - Реестр `Map<participantId, PeerSession>` и маршрутизация событий
  - _После задачи 5_
  - 6.1 `handleParticipantJoined` → сессия `offerer` + `start()`; дубль → warn
  - 6.2 `handleSignal`: offer от неизвестного → `answerer`; offer при существующей сессии → warn; answer/candidate от неизвестного → игнор
  - 6.3 `handleParticipantLeft` → `close()` + удаление; `getRemoteStream`, `getStats`, `closeAll` (с отпиской от media)
  - 6.4 Подписка `media.onTrackChange` → `replaceTrack` во всех сессиях (Promise резолвится после всех)
  - 6.5 try/catch вокруг создания `RTCPeerConnection` → `failed` для пары + notice
  - 6.6 Unit-тесты по таблице §11.2 с `createSession` DI
  - _Requirements: FR-10, FR-17, FR-19, FR-31, US-7, US-10, US-11, Design: §4.5, §8.2, §11.2_

- [ ] 7. Клиент: интеграция в `RoomSession` и state
  - Маршрутизация сокет-событий в `PeerManager`, статусы пар в reducer
  - _После задач 2, 6_
  - 7.1 `AppState.peers`, `AppState.autoplayBlocked`; действия `PEER_STATUS_CHANGED`, `AUTOPLAY_BLOCKED`, `AUTOPLAY_RESUMED`; `PARTICIPANT_LEFT` удаляет `peers[id]`
  - 7.2 `RoomSession`: создание `PeerManager` (`sendSignal` → `socket.emit('signal')`, `onPeerStatus` → `dispatch`)
  - 7.3 Слушатели: `participant:joined` → `dispatch` + `handleParticipantJoined`; `participant:left` → `handleParticipantLeft` + `dispatch`; `signal` → `handleSignal`; сигналы вне фазы `joined` игнорируются
  - 7.4 `JOIN_SUCCEEDED` → `PEER_STATUS_CHANGED('connecting')` для каждого удалённого участника
  - 7.5 `leave()`, `JOIN_FAILED`, `CONNECTION_LOST` → `peers.closeAll()`, затем `media.stopAll()`
  - 7.6 Unit-тесты reducer и маршрутизации на фейковом сокете
  - _Requirements: FR-10, FR-27, FR-28, FR-31, US-6, US-10, US-11, Design: §4.6, §4.7, §7.1_

- [ ] 8. Клиент UI: удалённые плитки
  - `RemoteTile` на базе `VideoTile`, статусы соединения на плитке
  - _После задачи 7_
  - 8.1 `features/call/RemoteTile.tsx`: `stream = peers.getRemoteStream(id)`, `muted={false}`, `mirrored={false}`, `showVideo = media.video && status === 'connected'`, `audioMuted = !media.audio`
  - 8.2 Подписи по статусу: «Подключение…», «Связь нестабильна…», «Не удалось установить медиасоединение», «Камера выключена» (TBD-2, предложено показывать)
  - 8.3 `VideoStage`: `SelfTile` + `RemoteTile` для каждого удалённого участника (flex-ряд), ключ `participantId`, `<video>` не перемонтируется при смене статуса
  - 8.4 Участник с `failed` остаётся в списке и в чате
  - 8.5 Component-тесты: подписи по статусам, `<video>` не пересоздаётся при смене `status`
  - _Requirements: FR-11 (F-07, для пары), FR-12 (F-08), FR-16, FR-18, FR-34, US-6, US-7, US-12, Design: §4.8, §8.1_

- [ ] 9. Клиент UI: autoplay и «свежий кадр»
  - `AutoplayGuard` с кнопкой «Включить звук», `useFreshFrame` (Should)
  - _После задачи 8_
  - 9.1 `features/call/AutoplayGuard.tsx`: реестр `Set<HTMLVideoElement>`, `register(el)` → `play()`, `NotAllowedError` → `AUTOPLAY_BLOCKED`
  - 9.2 Баннер «Браузер заблокировал воспроизведение звука» + «Включить звук» → `resumeAll()` в обработчике клика → `AUTOPLAY_RESUMED`
  - 9.3 Регистрация `<video>` из `RemoteTile`
  - 9.4 (Should, TBD-5) `features/call/useFreshFrame.ts`: после `media.video → true` показывать видео по `requestVideoFrameCallback`, fallback — сразу
  - 9.5 Component-тесты: reject `play()` → баннер; клик → `play()` для всех зарегистрированных
  - _Requirements: FR-37, US-13, Design: §4.8 (`AutoplayGuard`, `useFreshFrame`), §8.2, §13, §14 (TBD-5)_

- [ ] 10. Линтер-защита инвариантов
  - Запрет ренеготиации и `emitWithAck` на уровне ESLint
  - _После задачи 7_
  - 10.1 `no-restricted-syntax`: запрет `.addTrack(`, `.removeTrack(`, `emitWithAck(` вне разрешённых файлов
  - 10.2 Проверить, что текущий код проходит `npm run lint`
  - _Requirements: FR-10, Design: §3.2 (I3), §12, §13_

- [ ] 11. E2E: звонок двух участников
  - Хуки диагностики и основные сценарии `webrtc-call.spec.ts`
  - _После задач 8, 9_
  - 11.1 Chromium-флаги: fake-медиа + `--disable-features=WebRtcHideLocalIpsWithMdns`
  - 11.2 `window.__vcr` (E2E-сборка): `peers.ids()`, `peers.getStats(id)`, `debug.signalCounts` по пирам
  - 11.3 Звонок: у обоих `videoWidth > 0`, `currentTime` растёт, `inbound-rtp` audio и video `bytesReceived` растёт за 2 с
  - 11.4 Нет glare: после 5 циклов камера/микрофон off/on `offer === 1` у старожила и `0` у новичка
  - 11.5 Камера off у A → у B плейсхолдер ≤ 1 с, `framesDecoded` стоит, у A треки `ended`; вошёл без камеры → включил → у B `framesDecoded` растёт без новых offer
  - 11.6 Микрофон off → иконка у B; выход A и закрытие вкладки A → у B плитка исчезает, `peers.ids()` пуст (≤ 2 с)
  - _Requirements: FR-10 (F-06), FR-11, FR-12, FR-16, FR-17, FR-18, FR-19, FR-27, FR-28, US-6, US-7, US-10, US-12, Design: §11.4, §9_

- [ ] 12. E2E: autoplay и сбои ICE
  - Сценарии, требующие отдельных сборок с env
  - _После задачи 11_
  - 12.1 Autoplay: `addInitScript` делает первый `play()` reject `NotAllowedError` → баннер → клик → `video.paused === false`
  - 12.2 Сборка с `VITE_ICE_SERVERS='[{"urls":"stun:127.0.0.1:9"}]'` → соединение `connected` по host-кандидатам
  - 12.3 Сборка с `VITE_ICE_TRANSPORT_POLICY=relay` и укороченным таймаутом (3 с) → «Не удалось установить медиасоединение», чат работает
  - 12.4 Отдельные Playwright-проекты и `webServer` под эти сборки
  - _Requirements: FR-34, FR-37, US-13, Design: §11.4, §12_

- [ ] 13. Ручная кросс-браузерная проверка и пороги покрытия
  - Реальные устройства в LAN и итоговые метрики качества кода
  - _После задачи 12_
  - 13.1 Два разных компьютера в одной Wi-Fi по `https://<LAN-IP>:5173`: видео и звук в обе стороны
  - 13.2 Пары Chrome ↔ Firefox, Chrome ↔ Edge, Firefox ↔ Edge
  - 13.3 `chrome://webrtc-internals` / `about:webrtc`: одна пара offer/answer, `connected`, пара кандидатов host
  - 13.4 Камера off/on: лампочка, заглушка, отсутствие «замёрзшего» кадра (если сделан `useFreshFrame`); отключение Wi-Fi → «Связь нестабильна…», плитка исчезает ≤ 15 с
  - 13.5 Пороги покрытия: `PeerSession` ≥ 90%, `PeerManager` ≥ 90%, `handlers/signal.ts` ≥ 95%
  - _Requirements: FR-10, FR-19, FR-31, FR-34, US-6, US-11, Design: §11.5, §11.6, §13_
