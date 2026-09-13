# Implementation Plan

> **Фича:** `mesh-group-call` (этап 5 из 5) · **PRD:** `prd-video-chat-room.md` v1.0 · **TDD:** [`design-mesh-group-call-v2.md`](design-mesh-group-call-v2.md)
> **Зависит от:** этапов 1–4 ([`room-skeleton`](../room-skeleton/impl-room-skeleton.md), [`chat-system-messages`](../chat-system-messages/impl-chat-system-messages.md), [`local-media-controls`](../local-media-controls/impl-local-media-controls.md), [`webrtc-peer-call`](../webrtc-peer-call/impl-webrtc-peer-call.md)). Завершается релизом v1.0.
> Каждая задача верхнего уровня — один PR, ≤ 1 рабочего дня. `FR-N` — номер функционального требования из PRD §4 (в скобках ID тест-задания), `US-N` — user story из PRD §3, `§N` — раздел TDD, `I1–I4` — инварианты этапа 4.

- [ ] 1. `PeerManager`: изоляция отказов между парами
  - Сбой одной пары не блокирует остальные
  - 1.1 `onTrackChange`: `Promise.all` → `Promise.allSettled`, warn по каждому rejected
  - 1.2 try/catch вокруг маршрутизации в `handleSignal` → `markFailed(from, e)` только для этой пары
  - 1.3 `getSummary(): Array<{ participantId, role, status }>`
  - 1.4 Unit-тесты при N = 3: одна сессия reject в `replaceTrack` → остальные получили вызов, Promise подписчика резолвится; исключение в `handleSignal` одной пары → `failed` только у неё
  - _Requirements: FR-31 (F-18), US-11, Design: §2, §3.3, §4.2, §7.3, §8, §11.1_

- [ ] 2. `PeerSession`: потолок битрейта видео 1000 kbps
  - `setParameters` на видео-отправителе без ренеготиации
  - 2.1 `constants.ts`: `MAX_VIDEO_BITRATE_BPS = 1_000_000`, `DIAGNOSTICS_INTERVAL_MS = 2_000`
  - 2.2 `applySendParameters()`: пустые `encodings` → `[{}]` (Firefox), `maxBitrate`, try/catch → warn
  - 2.3 Однократный вызов после первого перехода в `connected`
  - 2.4 Unit-тесты: `maxBitrate === 1_000_000`; пустые `encodings`; reject `setParameters` → warn, статус не меняется; `createOffer` не вызывается
  - _Requirements: FR-10 (F-06), US-6 (задержка), PRD §5 (битрейт — на усмотрение разработчика), Design: §4.3, §5, §9.1, §9.3_

- [ ] 3. Клиент UI: адаптивная видеосетка
  - `VideoGrid` вместо `VideoStage`, раскладка 1–4 плитки
  - 3.1 `getGridLayout(count)`: 1 → 1×1, 2 → 2×1, 3 → 2×2 с центрированной последней, 4 → 2×2
  - 3.2 `features/call/VideoGrid.tsx`: self первой (подпись «Вы», рамка, зеркало, `muted`), удалённые по `joinedAt`, ключ `participantId`, CSS-переменные `--cols`/`--rows`, `data-count`, `data-last-row-centered`
  - 3.3 CSS сетки и `.video-tile video { object-fit: cover }` для ширины ≥ 1024px
  - 3.4 Подсказка при одной плитке «Пока никого нет. Скопируйте ссылку…» с `CopyLinkButton`
  - 3.5 Удалить `VideoStage`, заменить использование в `RoomPage`
  - 3.6 Unit-тесты `getGridLayout`; component-тесты `VideoGrid`: self первой, порядок по `joinedAt`, при выходе участника из середины DOM-узлы `<video>` оставшихся **те же**
  - _Requirements: FR-11 (F-07), FR-12 (F-08), US-6, PRD §6 (сетка 1/2/3/4, ≥ 1024px), Design: §4.1, §8, §11.1, §14 (TBD-4: порядок по времени входа)_

- [ ] 4. Property-based тест ролей: стенд
  - Настоящий сервер + K клиентов с настоящим `PeerManager` и фейковыми сессиями
  - _После задачи 1_
  - 4.1 dev-зависимость `fast-check`
  - 4.2 `FakePeerSession`: записывает роль, отправленные offer/answer, отвечает на offer синтетическим answer
  - 4.3 Тестовый клиент: `socket.io-client` + маршрутизация `participant:*`/`signal` в `PeerManager` как в `RoomSession`
  - 4.4 Исполнитель команд `join(i)`, `leave(i)`, `disconnect(i)`, `rejoin(i)`, `wait(ms)`, включая «в одном тике»; ожидание стабилизации
  - 4.5 Сбор серверных логов `signal.role-violation`
  - _Requirements: FR-7 (F-05), FR-10, Design: §3.2, §11.2_

- [ ] 5. Property-based тест ролей: генераторы и свойства
  - Формальная проверка I1 при произвольных интерливингах
  - _После задачи 4_
  - 5.1 Генератор последовательностей команд для K ∈ [2..6]
  - 5.2 Свойство 1: в комнате ≤ 4 участников, лишние получили `ROOM_FULL`
  - 5.3 Свойство 2: для каждой живой пары ровно одна сторона `offerer`, и это участник с меньшим `joinSeq`
  - 5.4 Свойство 3: ровно 1 offer и 1 answer на пару, нет `signal.role-violation`
  - 5.5 Свойство 4: множество сессий клиента = множество остальных живых участников (нет утечек и «призраков»)
  - 5.6 Подобрать `numRuns` и таймауты так, чтобы прогон занимал разумное время
  - _Requirements: FR-7 (F-05), FR-8, FR-10, FR-31, US-5, US-11, Design: §3.2, §11.2, §13_

- [ ] 6. Server integration: полный mesh-обмен сигналами
  - Сценарий «4 клиента симулируют полный mesh»
  - 6.1 4 клиента входят, каждый шлёт offer всем позже вошедшим и answer всем раньше вошедшим
  - 6.2 Проверка: каждый получает ровно 3 сигнальных потока от нужных отправителей, 6 offer и 6 answer суммарно
  - _Requirements: FR-7, FR-10, Design: §3.1, §6.4, §11.3_

- [ ] 7. (Should) `DiagnosticsOverlay`
  - Метрики пар из `getStats()` для dev и E2E, не попадает в prod
  - _После задач 1, 2_
  - 7.1 `features/call/DiagnosticsOverlay.tsx`: включение по `?debug=1` только в dev/E2E-сборке
  - 7.2 Раз в `DIAGNOSTICS_INTERVAL_MS`: роль и статус, RTT, jitter buffer delay, processing delay, FPS вход/выход, битрейт по Δ байт, `qualityLimitationReason`
  - _Requirements: US-6 (измерение задержки ≤ 500 мс), Design: §4.4, §9.2, §10, §14 (TBD-3)_

- [ ] 8. E2E-инфраструктура для комнаты из 4–5 участников
  - Отдельный Playwright-проект `mesh` и хелперы
  - _После задачи 3_
  - 8.1 Проект `mesh`: `workers: 1`, `timeout: 120s`
  - 8.2 E2E-сборка с пониженным `VIDEO_CONSTRAINTS` для fake-камеры
  - 8.3 Хелперы: открыть N контекстов и войти в комнату, дождаться `connected` всех пар, прочитать `signalCounts` и `getStats`
  - _Requirements: FR-7, FR-11, Design: §11.4, §12, §13_

- [ ] 9. E2E: полная комната, роли и лимит
  - `mesh-4.spec.ts`, сценарии 1–4
  - _После задач 1, 8_
  - 9.1 Полная комната: у каждого 3 удалённые плитки `videoWidth > 0`, `data-count="4"`, `peers.ids().length === 3`
  - 9.2 Отсутствие glare: A → B, C, D; B → C, D; C → D; D — 0 offer; ровно 1 offer на пару
  - 9.3 5-й участник: «Комната заполнена», все его треки `ended`; после выхода одного из 4 → «Повторить вход» → 3 плитки
  - 9.4 Одновременный вход B и C через `Promise.all` → все 3 пары `connected`
  - _Requirements: FR-7 (F-05), FR-8, FR-10, FR-11, FR-29, US-5, US-6, Design: §3.1, §3.2, §7.1, §11.4 (1–4)_

- [ ] 10. E2E: изоляция отказов и сетка
  - `mesh-4.spec.ts`, сценарии 5–8
  - _После задачи 9_
  - 10.1 Выход из середины: C закрывает страницу → у A, B, D по 2 плитки ≤ 2 с; `bytesReceived` пар A–B, A–D, B–D растёт; число offer не изменилось
  - 10.2 Переключение камеры A → у B, C, D заглушка, затем `framesDecoded` растёт; новых offer нет
  - 10.3 Изоляция пары: подмена `RTCPeerConnection` у D для пары с C (`iceTransportPolicy: 'relay'`) → «Не удалось установить медиасоединение» только у C и D друг для друга, остальные 5 пар `connected`
  - 10.4 Скриншот-сравнение сетки (`toHaveScreenshot`, маска на видео) для 1–4 участников на 1024 и 1440 px
  - _Requirements: FR-11 (F-07), FR-17, FR-31 (F-18), FR-34, US-6, US-7, US-11, Design: §3.3, §7.2, §7.3, §8, §11.4 (5–8)_

- [ ] 11. E2E: битрейт и кросс-браузерность
  - `mesh-4.spec.ts`, сценарии 9–10
  - _После задач 2, 9_
  - 11.1 Потолок битрейта: через 10 с у каждого видео-отправителя `maxBitrate === 1_000_000`, средний `outbound-rtp(video)` за 10 с ≤ 1.1 Mbps
  - 11.2 (Should) Смешанная комната 2 × Chromium + 1 × Firefox (`firefoxUserPrefs`) → все пары `connected`
  - _Requirements: FR-10, FR-11, PRD §7 (Chrome / Firefox / Edge 100+), Design: §4.3, §11.4 (9–10)_

- [ ] 12. Замеры производительности в LAN
  - Подтверждение целевых метрик на реальных устройствах
  - _После задач 7, 10_
  - 12.1 Задержка glass-to-glass: секундомер на экране A, камера B, 10 замеров, p95 ≤ 500 мс; оценка по `getStats` через `DiagnosticsOverlay`
  - 12.2 Время подключения 4-го участника < 3 с p95; FPS ≥ 20 на плитке; потери < 1%
  - 12.3 CPU < 70% на эталонном ноутбуке за 10-минутный звонок, `qualityLimitationReason` в основном `none` (модель ноутбука — TBD-2)
  - 12.4 При невыполнении — применить рычаги §9.3 (снижение `maxBitrate`, TBD-1 — захват 480×270@20 при N = 4) отдельной задачей
  - 12.5 Отчёт с результатами в `prds/mesh-group-call/`
  - _Requirements: US-6 (задержка ≤ 500 мс), PRD §7 (задержка в LAN), Design: §9.1, §9.2, §9.3, §13, §14 (TBD-1, TBD-2)_

- [ ] 13. Релиз v1.0
  - Итоговая приёмка продукта и тег
  - _После задач 1–12_
  - 13.1 Пороги покрытия: `shared` ≥ 95%, `server` ≥ 90%, `client/state` + `client/call` + `client/media` ≥ 90%, `client` ≥ 75%
  - 13.2 Ручной release checklist: 4 устройства (Chrome, Firefox, Edge; Windows + macOS), 10-минутный звонок; лампочка камеры; обрыв Wi-Fi у одного → звонок продолжается, системное сообщение ≤ 15 с; 5-й → «Комната заполнена» и лампочка гаснет; отказ в доступе у одного → силуэт и имя у остальных
  - 13.3 Прогон всех US-1…US-13 по Gherkin-критериям PRD
  - 13.4 Зелёные lint, typecheck, unit, integration, property-based и E2E → git-тег `v1.0.0`
  - _Requirements: FR-1…FR-40, US-1…US-13, Design: §1.2 (итоговая трассировка), §11.5, §11.6, §12_
