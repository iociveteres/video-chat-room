import path from 'node:path';
import { LOG_LEVELS, type LogLevel } from './logger';

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = 'localhost';
/** Обрыв обнаруживается за pingInterval + pingTimeout ≈ 15 с (US-11). */
export const DEFAULT_PING_INTERVAL_MS = 10_000;
export const DEFAULT_PING_TIMEOUT_MS = 5_000;

export interface Config {
  port: number;
  host: string;
  tls?: { keyPath: string; certPath: string };
  /** Если задан, сервер отдаёт собранный клиент (prod-like режим). */
  clientDistDir?: string;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer in [${min}, ${max}], got "${raw}"`);
  }
  return value;
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const keyPath = readString(env, 'TLS_KEY_PATH');
  const certPath = readString(env, 'TLS_CERT_PATH');
  if (Boolean(keyPath) !== Boolean(certPath)) {
    throw new ConfigError('TLS_KEY_PATH and TLS_CERT_PATH must be set together');
  }

  const logLevel = readString(env, 'LOG_LEVEL') ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }

  const clientDistDir = readString(env, 'CLIENT_DIST_DIR');

  return {
    port: readInt(env, 'PORT', DEFAULT_PORT, 0, 65_535),
    host: readString(env, 'HOST') ?? DEFAULT_HOST,
    tls: keyPath && certPath ? { keyPath, certPath } : undefined,
    clientDistDir: clientDistDir ? path.resolve(clientDistDir) : undefined,
    pingIntervalMs: readInt(env, 'SOCKET_PING_INTERVAL_MS', DEFAULT_PING_INTERVAL_MS, 1, 3_600_000),
    pingTimeoutMs: readInt(env, 'SOCKET_PING_TIMEOUT_MS', DEFAULT_PING_TIMEOUT_MS, 1, 3_600_000),
    logLevel: logLevel as LogLevel,
  };
}
