# Без BuildKit-only синтаксиса (RUN --mount): собирается и классическим docker build.

# Сборка:  docker build -t video-chat-room .
# Запуск:  docker run -p 3000:3000 video-chat-room
# VITE_* вшиваются в клиентский бандл при сборке, поэтому передаются через --build-arg,
# а не через -e при запуске.

ARG NODE_VERSION=22

# ---- build: полный набор зависимостей, сборка клиента (Vite) и сервера (tsup) ----
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# Сначала только манифесты: слой с npm ci кешируется, пока не меняются зависимости.
# npm ci сверяет lock-файл со всеми workspaces, поэтому копируем package.json каждого.
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
COPY packages/protocol-tests/package.json packages/protocol-tests/
COPY e2e/package.json e2e/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/client packages/client
COPY packages/server packages/server

ARG VITE_ICE_SERVERS
ARG VITE_VIDEO_CONSTRAINTS
RUN npm -w @vcr/client run build \
 && npm -w @vcr/server run build \
 && node packages/client/scripts/check-no-e2e-hook.mjs

# ---- prod-deps: только runtime-зависимости сервера (express, socket.io, zod) ----
# @vcr/shared вшит в серверный бандл (tsup noExternal), клиент — статика.
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
COPY packages/protocol-tests/package.json packages/protocol-tests/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev --ignore-scripts -w @vcr/server

# ---- runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime
# npm, yarn и corepack в рантайме не нужны (~20 MB): сервер запускается напрямую через node.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CLIENT_DIST_DIR=/app/packages/client/dist

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# package.json сервера нужен ради "type": "module" рядом с ESM-бандлом.
COPY --chown=node:node packages/server/package.json packages/server/
COPY --from=build --chown=node:node /app/packages/server/dist packages/server/dist
COPY --from=build --chown=node:node /app/packages/client/dist packages/client/dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "packages/server/dist/index.js"]
