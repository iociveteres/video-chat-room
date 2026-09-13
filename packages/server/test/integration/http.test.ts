import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../../src/app';
import { startTestServer, type TestServer } from '../helpers/startTestServer';

const INDEX_HTML = '<!doctype html><title>vcr-test-index</title>';

describe('HTTP without client dist (dev mode)', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  it('GET /healthz returns 200 with status and room count', async () => {
    const res = await fetch(`${t.url}/healthz`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', rooms: 0 });
    expect(body.uptimeSec).toEqual(expect.any(Number));
  });

  it('reports rooms from the registry', async () => {
    t.server.registry.join('r1', { id: 'p1', socketId: 's1', name: 'A' });
    try {
      const body = (await (await fetch(`${t.url}/healthz`)).json()) as { rooms: number };
      expect(body.rooms).toBe(1);
    } finally {
      t.server.registry.leave('r1', 'p1');
    }
  });

  it('sets security headers', async () => {
    const res = await fetch(`${t.url}/healthz`);

    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('does not serve the SPA when CLIENT_DIST_DIR is not set', async () => {
    expect((await fetch(`${t.url}/`)).status).toBe(404);
    expect((await fetch(`${t.url}/r/q7Z3kP0aX_2m`)).status).toBe(404);
  });

  it('attaches Socket.io at /socket.io', async () => {
    const res = await fetch(`${t.url}/socket.io/?EIO=4&transport=polling`);

    expect(res.status).toBe(200);
    // Пакет engine.io "open": 0{"sid":...,"pingInterval":10000,...}
    const body = await res.text();
    expect(body.startsWith('0{')).toBe(true);
    expect(JSON.parse(body.slice(1))).toMatchObject({
      pingInterval: 10_000,
      pingTimeout: 5_000,
      maxPayload: 100 * 1024,
    });
  });
});

describe('HTTP with client dist (prod-like mode)', () => {
  let t: TestServer;
  let distDir: string;

  beforeAll(async () => {
    distDir = mkdtempSync(path.join(tmpdir(), 'vcr-client-dist-'));
    mkdirSync(path.join(distDir, 'assets'));
    writeFileSync(path.join(distDir, 'index.html'), INDEX_HTML);
    writeFileSync(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log(1);');
    writeFileSync(path.join(distDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    t = await startTestServer({ clientDistDir: distDir });
  });

  afterAll(async () => {
    await t.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it.each(['/', '/r/q7Z3kP0aX_2m', '/r/not-validated-here'])(
    'GET %s falls back to index.html',
    async (pathname) => {
      const res = await fetch(`${t.url}${pathname}`);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
      expect(await res.text()).toBe(INDEX_HTML);
    },
  );

  it('serves hashed assets with an immutable cache', async () => {
    const res = await fetch(`${t.url}/assets/index-abc123.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe('console.log(1);');
  });

  it('returns 404 for a missing asset instead of index.html', async () => {
    const res = await fetch(`${t.url}/assets/missing.js`);

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('vcr-test-index');
  });

  it('serves other files from the dist root', async () => {
    expect((await fetch(`${t.url}/favicon.svg`)).status).toBe(200);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await fetch(`${t.url}/unknown`)).status).toBe(404);
    expect((await fetch(`${t.url}/r/a/b`)).status).toBe(404);
  });

  it('still serves /healthz', async () => {
    expect((await fetch(`${t.url}/healthz`)).status).toBe(200);
  });
});
