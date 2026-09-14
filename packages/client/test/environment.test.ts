import { describe, expect, it } from 'vitest';
import { checkEnvironment, type EnvironmentWindow } from '../src/app/environment';

function fakeWindow(overrides: Partial<EnvironmentWindow> = {}): EnvironmentWindow {
  return {
    isSecureContext: true,
    RTCPeerConnection: function RTCPeerConnection() {},
    navigator: { mediaDevices: { getUserMedia: () => Promise.resolve() } },
    ...overrides,
  };
}

describe('checkEnvironment', () => {
  it('returns ok in a secure context with WebRTC', () => {
    expect(checkEnvironment(fakeWindow())).toBe('ok');
  });

  it('returns insecure-context outside a secure context', () => {
    expect(checkEnvironment(fakeWindow({ isSecureContext: false }))).toBe('insecure-context');
  });

  it('reports insecure-context before webrtc-unsupported (http://<LAN-IP> hides mediaDevices)', () => {
    expect(checkEnvironment(fakeWindow({ isSecureContext: false, navigator: {} }))).toBe(
      'insecure-context',
    );
  });

  it('returns webrtc-unsupported without RTCPeerConnection', () => {
    expect(checkEnvironment(fakeWindow({ RTCPeerConnection: undefined }))).toBe(
      'webrtc-unsupported',
    );
  });

  it('returns webrtc-unsupported without mediaDevices.getUserMedia', () => {
    expect(checkEnvironment(fakeWindow({ navigator: {} }))).toBe('webrtc-unsupported');
    expect(checkEnvironment(fakeWindow({ navigator: { mediaDevices: {} } }))).toBe(
      'webrtc-unsupported',
    );
  });
});
