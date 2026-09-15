# Video Chat Room

Видеочат-комната на WebRTC (mesh до 4 участников) с текстовым чатом.

**Стек:** TypeScript, React 19, Vite, Node.js 22, Express 5, Socket.IO, WebRTC, Zod, Vitest, Playwright, Docker.

**Демо:** https://videochat.iociveteres.ru/

## Запуск через Docker

```bash
docker build -t video-chat-room .
docker run -p 3000:3000 video-chat-room
```

Образ собирает prod-версию: клиент и сервер собираются в образе, Node-сервер сам отдаёт статику клиента. Приложение откроется на http://localhost:3000.

## Запуск без Docker

Нужен Node.js 22+ (см. `.nvmrc`).

### Dev-режим

```bash
npm ci
npm run dev
```

Поднимаются сервер (порт 3000) и Vite-клиент: https://localhost:5173.
Сертификат самоподписанный — браузер попросит подтвердить исключение. HTTPS нужен, чтобы камера и микрофон работали при заходе с других устройств в локальной сети.

### Prod-сборка

```bash
npm ci
npm -w @vcr/client run build
npm -w @vcr/server run build
CLIENT_DIST_DIR=packages/client/dist npm -w @vcr/server start
```

Сервер отдаёт собранный клиент на http://localhost:3000.

## Тесты

```bash
npm test
npm run test:e2e
```
