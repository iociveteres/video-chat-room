# Implementation Plan

> **Фича:** `local-media-controls` (этап 3 из 5) · **PRD:** `prd-video-chat-room.md` v1.0 · **TDD:** [`design-local-media-controls.md`](design-local-media-controls.md)
> **Зависит от:** этапа 1 [`room-skeleton`](../room-skeleton/impl-room-skeleton.md), этапа 2 [`chat-system-messages`](../chat-system-messages/impl-chat-system-messages.md) (слот `notice` и тосты). **Блокирует:** этап 4 (`MediaController`, `onTrackChange`, `VideoTile`).
> Каждая задача верхнего уровня — один PR, ≤ 1 рабочего дня. `FR-N` — номер функционального требования из PRD §4 (в скобках ID тест-задания), `US-N` — user story из PRD §3, `§N` — раздел TDD.

- [ ] 1. Контракт медиа-состояния и серверная модель
  - `MediaState` в протоколе, хранение в `Participant`, приём в `room:join`
  - 1.1 `protocol.ts`: `MediaState`, `ParticipantDTO.media`, `JoinRequest.media` (обязательное), события `media:update` и `participant:media`
  - 1.2 `constants.ts`: `AUDIO_CONSTRAINTS`, `VIDEO_CONSTRAINTS` (640×360@24)
  - 1.3 `rooms/types.ts`: `Participant.media`; `RoomRegistry.join` сохраняет `input.media`; `RoomRegistry.updateMedia()` (синхронно, `false` при неизвестном участнике или том же значении)
  - 1.4 `schemas.ts`: `MediaStateSchema`, `JoinRequestSchema.media`
  - 1.5 Клиент: временно отправлять `media: { audio: false, video: false }` в `room:join`, чтобы сборка и E2E оставались зелёными до задачи 6
  - 1.6 Unit-тесты `updateMedia`; integration: join без `media` → `INVALID_PAYLOAD`, DTO старожилов и новичка содержат `media`
  - _Requirements: FR-15 (F-09), FR-16, FR-18, Design: §4.1, §4.2 (`RoomRegistry`, `schemas.ts`), §5, §6.1, §6.4, §11.2, §11.3, §12_

- [ ] 2. Сервер: обработчик `media:update`
  - Рассылка изменений mic/cam остальным участникам
  - _После задачи 1_
  - 2.1 `handlers/media.ts`: членство → `MediaStateSchema` → `updateMedia` → `socket.to(room).emit('participant:media')`; `participantId` берётся из сокета
  - 2.2 Регистрация в `registerSocketHandlers`
  - 2.3 Integration-тесты: остальные получают `participant:media`, отправитель — нет; повтор того же значения не рассылается; невалидный payload и событие вне комнаты игнорируются, процесс жив
  - _Requirements: FR-15 (F-09), FR-16, FR-17 (F-10), FR-18, US-7, Design: §4.2 (`handlers/media.ts`), §6.2, §6.3, §10, §11.3_

- [ ] 3. Клиент: `MediaController` — захват при входе
  - Классификация ошибок, `acquireInitial`, очередь операций, `stopAll`
  - 3.1 Тестовые фейки: `FakeTrack` (`kind`, `enabled`, `readyState`, `stop`, `dispatchEnded`), `FakeMediaDevices` с программируемыми ответами, `FakeMediaStream`
  - 3.2 `media/MediaController.ts`: типы `TrackKind`, `DeviceStatus`, `LocalTracks`, `TrackChangeListener`; `previewStream`, `getTracks`, `getPublicState`
  - 3.3 Последовательная очередь `this.chain = this.chain.then(op)` для всех публичных async-операций
  - 3.4 `classify(error)` по таблице `error.name` → `DeviceStatus`
  - 3.5 `acquireInitial`: `enumerateDevices` → запрос только имеющихся устройств → при `NotAllowedError` ветка Permissions API (с try/catch на `query`) → при `NotReadable`/`NotFound`/`Abort`/`Overconstrained` поштучный повтор → сводный `onNotice`
  - 3.6 `stopAll()` с флагом `disposed`: трек из позднего `getUserMedia` сразу останавливается
  - 3.7 Unit-тесты: оба устройства ok; нет videoinput; нет устройств (0 вызовов `getUserMedia`); `NotAllowedError` без/с Permissions API; `NotReadableError` → `on/busy`; `stopAll` во время pending `getUserMedia`
  - _Requirements: FR-13, FR-14, FR-33, US-6, US-12, Design: §1.3, §3 (ключевые решения), §4.3 (типы, интерфейс, алгоритм `acquireInitial`, классификация), §8.2, §11.1_

- [ ] 4. Клиент: `MediaController` — тумблеры и потеря устройства
  - Камера через `stop()` + новый `getUserMedia`, микрофон через `enabled`, обработка `ended`
  - _После задачи 3_
  - 4.1 `onTrackChange(listener)` и `emitTrackChange` через `Promise.allSettled` (ошибки → `console.warn`, `stop()` выполняется всё равно)
  - 4.2 `setVideoEnabled(false)`: `tracks.video = null` → снять `ended` → дождаться подписчиков → `previewStream.removeTrack` → `track.stop()` → статус `off`
  - 4.3 `setVideoEnabled(true)`: `acquiring` → `getUserMedia({ video })` → `ended`-слушатель → `previewStream.addTrack` → подписчики → `on`; ошибка → статус + notice
  - 4.4 `setAudioEnabled`: `on`↔`off` через `track.enabled`; из статусов ошибок — `getUserMedia({ audio })` + `emitTrackChange`
  - 4.5 `onVideoEnded` / `onAudioEnded`: игнор устаревшего трека, `lost`, notice
  - 4.6 Unit-тесты: порядок «listener завершился до `stop()`»; listener с Promise 50 мс; listener бросает; новый трек при включении и `previewStream` только с ним; mic без `getUserMedia`; `ended` → `lost`; устаревший `ended`; двойной `setVideoEnabled(true)` → один `getUserMedia`; spy на `clone()` — 0 вызовов
  - _Requirements: FR-15 (F-09), FR-17 (F-10), FR-19, FR-20, US-7, Design: §4.3 (камера: выключение/включение, микрофон, потеря устройства, `emitTrackChange`), §7.2, §7.3, §11.1, §13_

- [ ] 5. Клиент: state локального медиа
  - `localMedia`, `joinStep`, медиа удалённых участников
  - 5.1 `AppState.localMedia` (`audio`, `video`, `videoTrackVersion`), `AppState.joinStep`
  - 5.2 Действия `LOCAL_MEDIA_STATUS_CHANGED`, `LOCAL_VIDEO_TRACK_CHANGED`, `PARTICIPANT_MEDIA_CHANGED`
  - 5.3 Для `selfId` UI читает `localMedia`, а не `participantsById[self].media`
  - 5.4 Unit-тесты: смена статусов, `videoTrackVersion++`, `PARTICIPANT_MEDIA_CHANGED` для известного и неизвестного id
  - _Requirements: FR-13, FR-15, FR-16, FR-18, Design: §4.5, §11.2_

- [ ] 6. Клиент: `RoomSession` владеет `MediaController`
  - Захват до `room:join`, публикация состояния, освобождение устройств на всех путях выхода
  - _После задач 2, 4, 5_
  - 6.1 Создание `MediaController` с `navigator.mediaDevices`/`permissions`, `onStatus` → `dispatch` + `publishMediaState`, `onNotice` → `notice`
  - 6.2 `join`: `JOIN_REQUESTED` (`acquiring-media`) → `await acquireInitial()` → проверка, что фаза всё ещё `joining` → `connecting` → `room:join { …, media: getPublicState() }`; убрать заглушку из задачи 1.5
  - 6.3 `publishMediaState` с дедупликацией по `lastSentMedia`, только в фазе `joined`; досылка расхождения на `JOIN_SUCCEEDED`
  - 6.4 `toggleAudio()` / `toggleVideo()`; слушатель `participant:media` → `PARTICIPANT_MEDIA_CHANGED`
  - 6.5 `media.stopAll()` на `JOIN_FAILED`, `LEFT_ROOM`, `CONNECTION_LOST`
  - 6.6 «Войти без камеры и микрофона» во время ожидания разрешения: статусы `off`, поздно пришедшие треки останавливаются (TBD-3, предложено — да)
  - 6.7 Unit-тесты на фейках: порядок захват → connect; `ROOM_FULL` → `stopAll`; дедуп `media:update`
  - _Requirements: FR-8, FR-13, FR-14, FR-15, FR-33, US-5, US-6, US-12, Design: §4.4, §7.1, §8.2, §10, §14 (TBD-3)_

- [ ] 7. Клиент UI: плитки и self-view
  - `VideoTile` для переиспользования на этапе 4, заглушка «силуэт + имя»
  - _После задачи 5_
  - 7.1 `features/call/AvatarPlaceholder.tsx`: inline-SVG силуэта, имя текстовым узлом, опциональная подпись статуса
  - 7.2 `features/call/VideoTile.tsx`: `<video>` смонтирован всегда и скрыт CSS при `showVideo=false`; привязка `srcObject` + `play()` в `useEffect` по `[stream, streamVersion]`; иконка перечёркнутого микрофона по `audioMuted`
  - 7.3 `features/call/SelfTile.tsx`: `previewStream`, `muted`, `mirrored` (`scaleX(-1)` только на `<video>`), подпись «Вы», `statusLabel` по §8.1
  - 7.4 `features/call/VideoStage.tsx` (только `SelfTile`) в области видео `RoomPage`
  - 7.5 Component-тесты: при `showVideo=false` `<video>` остаётся в DOM, плейсхолдер виден; имя `<img onerror>` рендерится текстом
  - _Requirements: FR-12 (F-08, self), FR-16, FR-18, US-6, US-7, US-12, Design: §4.6, §8.1, §11.4_

- [ ] 8. Клиент UI: панель управления, иконки и баннер доступа
  - `ControlBar`, `DeviceToggle`, индикация в `ParticipantList`, `MediaAccessBanner`
  - _После задач 6, 7_
  - 8.1 `features/controls/DeviceToggle.tsx`: `aria-pressed`, иконка вкл/выкл/предупреждение, `title` по статусу (§8.1), `disabled` при `acquiring`
  - 8.2 `features/controls/ControlBar.tsx`: `MicToggle`, `CameraToggle`, «Выйти» (перенос из `RoomHeader`)
  - 8.3 `ParticipantList`: иконки перечёркнутого микрофона и камеры по `media`, для себя — по `localMedia`
  - 8.4 `features/room/MediaAccessBanner.tsx`: постоянный баннер при `denied` с инструкцией
  - 8.5 Подсказка на шаге `acquiring-media` и кнопка «Войти без камеры и микрофона»
  - 8.6 Component-тесты `DeviceToggle`: `aria-pressed`, `disabled`, `title`
  - _Requirements: FR-15 (F-09), FR-16, FR-17 (F-10), FR-27, FR-33, US-7, US-12, PRD §6 (панель управления), Design: §4.6, §8.1, §8.2, §11.4, §14 (п. 5)_

- [ ] 9. E2E-инфраструктура для медиа
  - Fake-устройства в Playwright и тестовый хук, не попадающий в prod
  - _После задачи 6_
  - 9.1 `playwright.config.ts`: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`; сборка клиента с `VITE_E2E=1`
  - 9.2 `window.__vcr` под `import.meta.env.VITE_E2E === '1'`: `media.getTracks()`, `media.debugCreatedTracks()` (все созданные треки с `readyState`)
  - _Requirements: FR-19, Design: §11.5, §12_

- [ ] 10. E2E: сценарии локального медиа
  - `e2e/tests/local-media.spec.ts`
  - _После задач 8, 9_
  - 10.1 Состояние по умолчанию: обе кнопки `aria-pressed=true`, `videoWidth > 0`
  - 10.2 Камера off: все видеотреки из `debugCreatedTracks()` `ended`, `getTracks().video === null`, плейсхолдер виден; камера on: новый трек `live`
  - 10.3 B выключает микрофон → у A иконка у B ≤ 1 с
  - 10.4 `addInitScript`: `getUserMedia` → `NotAllowedError` → пользователь в комнате, баннер, у других обе иконки выключены; `enumerateDevices` → `[]` → вход без запроса, `not-found`
  - 10.5 Потеря устройства (`dispatchEvent(new Event('ended'))`) → «Камера отключена», у других заглушка
  - 10.6 `ROOM_FULL` у 5-го → все его треки `ended`
  - 10.7 (Should) Firefox-проект с `firefoxUserPrefs` для сценариев 10.1–10.2
  - _Requirements: FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-20, FR-33, US-6, US-7, US-12, Design: §11.5_

- [ ] 11. Ручная проверка на реальных устройствах
  - То, что E2E не видит: аппаратная лампочка и поведение драйверов
  - _После задачи 10_
  - 11.1 Chrome, Firefox, Edge (Windows и macOS): лампочка гаснет ≤ 1 с после выключения камеры и загорается при включении
  - 11.2 Выдернуть USB-камеру → «Камера отключена», приложение живо
  - 11.3 Запретить доступ → разрешить в настройках сайта → тумблер включает устройство без перезагрузки
  - 11.4 Камера занята другим приложением → вход с микрофоном, статус «занята»; индикатор записи во вкладке пропадает после «Выйти»
  - 11.5 Зафиксировать результаты в описании PR
  - _Requirements: FR-14, FR-19, FR-20, FR-33, US-7, US-12, Design: §11.6, §13_
