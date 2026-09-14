import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ICE_SERVERS, getRtcConfiguration, parseIceServers } from '../src/call/rtcConfig';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('parseIceServers', () => {
  it('parses a valid JSON array of RTCIceServer', () => {
    const raw = JSON.stringify([
      { urls: 'stun:127.0.0.1:9' },
      { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'p' },
    ]);

    expect(parseIceServers(raw)).toEqual([
      { urls: 'stun:127.0.0.1:9' },
      { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'p' },
    ]);
  });

  it('drops unknown fields of a server', () => {
    expect(parseIceServers('[{"urls":"stun:a:1","credentialType":"password"}]')).toEqual([
      { urls: 'stun:a:1' },
    ]);
  });

  it('accepts an empty array: host candidates only', () => {
    expect(parseIceServers('[]')).toEqual([]);
  });

  it.each([undefined, '', '   '])('returns null without warning for an unset value %j', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseIceServers(raw)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['broken JSON', '[{"urls":'],
    ['a bare URL instead of JSON', 'stun:stun.l.google.com:19302'],
    ['an object instead of an array', '{"urls":"stun:a:1"}'],
    ['null', 'null'],
    ['a server without urls', '[{"username":"u"}]'],
    ['empty urls', '[{"urls":""}]'],
    ['an empty urls array', '[{"urls":[]}]'],
    ['non-string urls', '[{"urls":[1]}]'],
    ['a non-string credential', '[{"urls":"turn:a:1","username":"u","credential":42}]'],
    ['one bad server among good ones', '[{"urls":"stun:a:1"},null]'],
  ])('returns null and warns for %s', (_label, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseIceServers(raw)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('getRtcConfiguration', () => {
  it('defaults to two Google STUN servers, all transports, max-bundle and rtcp-mux', () => {
    expect(getRtcConfiguration({})).toEqual({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
  });

  it('does not share the default servers with the returned configuration', () => {
    const config = getRtcConfiguration({});
    (config.iceServers![0]!.urls as string[]).push('stun:evil:1');

    expect(DEFAULT_ICE_SERVERS[0]!.urls).toHaveLength(2);
  });

  it('uses VITE_ICE_SERVERS when valid and falls back to the default when not', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      getRtcConfiguration({ VITE_ICE_SERVERS: '[{"urls":"stun:127.0.0.1:9"}]' }).iceServers,
    ).toEqual([{ urls: 'stun:127.0.0.1:9' }]);
    expect(getRtcConfiguration({ VITE_ICE_SERVERS: 'garbage' }).iceServers).toEqual(
      getRtcConfiguration({}).iceServers,
    );
  });

  it.each([
    ['relay', 'relay'],
    ['all', 'all'],
    ['RELAY', 'all'],
    ['nohost', 'all'],
  ])('maps VITE_ICE_TRANSPORT_POLICY=%s to %s', (value, expected) => {
    expect(getRtcConfiguration({ VITE_ICE_TRANSPORT_POLICY: value }).iceTransportPolicy).toBe(
      expected,
    );
  });

  it('reads import.meta.env by default', () => {
    vi.stubEnv('VITE_ICE_TRANSPORT_POLICY', 'relay');
    vi.stubEnv('VITE_ICE_SERVERS', '[{"urls":"stun:127.0.0.1:9"}]');

    expect(getRtcConfiguration()).toMatchObject({
      iceServers: [{ urls: 'stun:127.0.0.1:9' }],
      iceTransportPolicy: 'relay',
    });
  });
});
