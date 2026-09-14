import { ICE_CANDIDATE_MAX_LENGTH, SDP_MAX_LENGTH } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import { SignalSchema } from '../../src/socket/schemas';

const TO = '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const candidate = {
  candidate: 'candidate:842163049 1 udp 1677729535 3f1a.local 54400 typ host generation 0',
  sdpMid: '0',
  sdpMLineIndex: 0,
  usernameFragment: 'Vh3x',
};

const accepts = (raw: unknown) => SignalSchema.safeParse(raw).success;

describe('SignalSchema', () => {
  it('accepts offer, answer and candidate', () => {
    expect(accepts({ to: TO, data: { type: 'offer', sdp: 'v=0\r\n' } })).toBe(true);
    expect(accepts({ to: TO, data: { type: 'answer', sdp: 'v=0\r\n' } })).toBe(true);
    expect(accepts({ to: TO, data: { type: 'candidate', candidate } })).toBe(true);
  });

  it('accepts a candidate with nullable fields and without usernameFragment', () => {
    const { usernameFragment: _, ...withoutUfrag } = candidate;
    expect(accepts({ to: TO, data: { type: 'candidate', candidate: withoutUfrag } })).toBe(true);
    expect(
      accepts({
        to: TO,
        data: {
          type: 'candidate',
          candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null },
        },
      }),
    ).toBe(true);
  });

  it('bounds the SDP length: empty and longer than SDP_MAX_LENGTH are rejected', () => {
    const sdp = (length: number) => ({ to: TO, data: { type: 'offer', sdp: 'a'.repeat(length) } });
    expect(accepts(sdp(SDP_MAX_LENGTH))).toBe(true);
    expect(accepts(sdp(SDP_MAX_LENGTH + 1))).toBe(false);
    expect(accepts(sdp(0))).toBe(false);
  });

  it('bounds the candidate string and sdpMLineIndex', () => {
    const withCandidate = (patch: object) => ({
      to: TO,
      data: { type: 'candidate', candidate: { ...candidate, ...patch } },
    });
    expect(accepts(withCandidate({ candidate: 'a'.repeat(ICE_CANDIDATE_MAX_LENGTH) }))).toBe(true);
    expect(accepts(withCandidate({ candidate: 'a'.repeat(ICE_CANDIDATE_MAX_LENGTH + 1) }))).toBe(
      false,
    );
    expect(accepts(withCandidate({ sdpMLineIndex: -1 }))).toBe(false);
    expect(accepts(withCandidate({ sdpMLineIndex: 0.5 }))).toBe(false);
    expect(accepts(withCandidate({ sdpMLineIndex: 17 }))).toBe(false);
  });

  it('rejects extra fields at every level', () => {
    expect(accepts({ to: TO, from: TO, data: { type: 'offer', sdp: 'v=0' } })).toBe(false);
    expect(accepts({ to: TO, data: { type: 'offer', sdp: 'v=0', candidate } })).toBe(false);
    expect(
      accepts({ to: TO, data: { type: 'candidate', candidate: { ...candidate, extra: 1 } } }),
    ).toBe(false);
  });

  it('rejects a mismatched payload for the type, an unknown type and a non-uuid to', () => {
    expect(accepts({ to: TO, data: { type: 'offer', candidate } })).toBe(false);
    expect(accepts({ to: TO, data: { type: 'candidate', sdp: 'v=0' } })).toBe(false);
    expect(accepts({ to: TO, data: { type: 'renegotiate', sdp: 'v=0' } })).toBe(false);
    expect(accepts({ to: 'p1', data: { type: 'offer', sdp: 'v=0' } })).toBe(false);
    expect(accepts({ data: { type: 'offer', sdp: 'v=0' } })).toBe(false);
  });
});
