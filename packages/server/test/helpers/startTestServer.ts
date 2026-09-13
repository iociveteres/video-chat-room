import { createAppServer, type AppServerHandle, type AppServerOptions } from '../../src/app';
import { createLogger } from '../../src/logger';

export interface TestServer {
  server: AppServerHandle;
  /** Базовый URL без завершающего слеша, например http://127.0.0.1:54321. */
  url: string;
  close(): Promise<void>;
}

/** Поднимает настоящий сервер на эфемерном порту с тихим логгером. */
export async function startTestServer(
  opts: Omit<AppServerOptions, 'port'> = {},
): Promise<TestServer> {
  const server = createAppServer({
    host: '127.0.0.1',
    logger: createLogger('silent'),
    ...opts,
    port: 0,
  });
  const { port } = await server.listen();
  return { server, url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
