import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: 'localhost',
      tls: undefined,
      clientDistDir: undefined,
      pingIntervalMs: 10_000,
      pingTimeoutMs: 5_000,
      logLevel: 'info',
    });
  });

  it('reads all variables', () => {
    expect(
      loadConfig({
        PORT: '8443',
        HOST: '0.0.0.0',
        TLS_KEY_PATH: 'key.pem',
        TLS_CERT_PATH: 'cert.pem',
        CLIENT_DIST_DIR: 'packages/client/dist',
        SOCKET_PING_INTERVAL_MS: '2000',
        SOCKET_PING_TIMEOUT_MS: '1000',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      port: 8443,
      host: '0.0.0.0',
      tls: { keyPath: 'key.pem', certPath: 'cert.pem' },
      clientDistDir: path.resolve('packages/client/dist'),
      pingIntervalMs: 2000,
      pingTimeoutMs: 1000,
      logLevel: 'debug',
    });
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ PORT: '', HOST: ' ', CLIENT_DIST_DIR: '' })).toMatchObject({
      port: 3000,
      host: 'localhost',
      clientDistDir: undefined,
    });
  });

  it.each(['abc', '-1', '65536', '3000.5', '1e3'])('rejects PORT=%j', (PORT) => {
    expect(() => loadConfig({ PORT })).toThrow(ConfigError);
  });

  it('rejects a non-positive ping interval', () => {
    expect(() => loadConfig({ SOCKET_PING_INTERVAL_MS: '0' })).toThrow(ConfigError);
  });

  it('requires TLS key and cert together', () => {
    expect(() => loadConfig({ TLS_KEY_PATH: 'key.pem' })).toThrow(/set together/);
    expect(() => loadConfig({ TLS_CERT_PATH: 'cert.pem' })).toThrow(/set together/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });
});
