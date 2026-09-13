import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { Server } from 'socket.io';
import { DEFAULT_PING_INTERVAL_MS, DEFAULT_PING_TIMEOUT_MS } from './config';
import { createLogger, type Logger } from './logger';
import { RoomRegistry } from './rooms/RoomRegistry';
import type { AppServer } from './socket/types';

/** SDP на этапе 4 весит ~5–10 KB; дефолтный 1 MB избыточен. */
export const SOCKET_MAX_HTTP_BUFFER_SIZE = 100 * 1024;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self' wss:",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface AppServerOptions {
  /** 0 — эфемерный порт (тесты). */
  port: number;
  /** '0.0.0.0' для доступа из LAN. */
  host?: string;
  tls?: { keyPath: string; certPath: string };
  /** Если задан — express.static + SPA fallback. */
  clientDistDir?: string;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
  logger?: Logger;
  registry?: RoomRegistry;
}

export interface AppServerHandle {
  httpServer: http.Server | https.Server;
  io: AppServer;
  registry: RoomRegistry;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

export function createAppServer(opts: AppServerOptions): AppServerHandle {
  const logger = opts.logger ?? createLogger('info');
  const registry = opts.registry ?? new RoomRegistry();
  const app = createHttpApp({ registry, logger, clientDistDir: opts.clientDistDir });

  const httpServer = opts.tls
    ? https.createServer(
        { key: readFileSync(opts.tls.keyPath), cert: readFileSync(opts.tls.certPath) },
        app,
      )
    : http.createServer(app);

  // Без CORS (same-origin) и без connectionStateRecovery (автопереподключения нет по PRD).
  const io: AppServer = new Server(httpServer, {
    pingInterval: opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
    pingTimeout: opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS,
    maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
    serveClient: false,
  });

  return {
    httpServer,
    io,
    registry,
    listen: () =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(opts.port, opts.host, () => {
          httpServer.off('error', reject);
          resolve({ port: (httpServer.address() as AddressInfo).port });
        });
      }),
    // io.close() отключает все сокеты и закрывает httpServer.
    close: () => io.close(),
  };
}

function createHttpApp(deps: {
  registry: RoomRegistry;
  logger: Logger;
  clientDistDir: string | undefined;
}): Express {
  const { registry, logger, clientDistDir } = deps;
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // В URL комнаты лежит её id — не отдаём его сторонним ресурсам.
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', rooms: registry.roomCount, uptimeSec: Math.floor(process.uptime()) });
  });

  if (clientDistDir) {
    const root = path.resolve(clientDistDir);
    const indexHtml = path.join(root, 'index.html');

    // У бандлов Vite хеш в имени файла — кешируем навсегда.
    app.use(
      '/assets',
      express.static(path.join(root, 'assets'), { immutable: true, maxAge: '1y', index: false }),
    );
    // Отсутствующий бандл — честный 404, а не index.html.
    app.use('/assets', (_req, res) => {
      res.sendStatus(404);
    });

    app.get(['/', '/r/:roomId'], (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml, (err) => {
        if (err) next(err);
      });
    });

    // Прочие файлы из корня сборки (favicon и т.п.).
    app.use(express.static(root, { index: false }));
  }

  app.use((_req, res) => {
    res.sendStatus(404);
  });

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    logger.error('HTTP request failed', { err, path: req.path });
    if (!res.headersSent) res.sendStatus(500);
  };
  app.use(onError);

  return app;
}
