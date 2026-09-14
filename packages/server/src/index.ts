import { createAppServer, type AppServerHandle } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { createLogger } from './logger';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`Invalid configuration: ${err.message}`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);

let server: AppServerHandle;
try {
  // createAppServer читает TLS-файлы, listen может упасть на занятом порту.
  server = createAppServer({ ...config, logger });
  const { port } = await server.listen();
  const scheme = config.tls ? 'https' : 'http';
  logger.info(`Server listening on ${scheme}://${config.host}:${port}`);
  if (config.clientDistDir) logger.info(`Serving client from ${config.clientDistDir}`);
} catch (err) {
  logger.error('Failed to start server', { err });
  process.exit(1);
}

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);
  server.close().then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error('Shutdown failed', { err });
      process.exit(1);
    },
  );
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
