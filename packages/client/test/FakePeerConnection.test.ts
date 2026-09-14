import { describe, expect, it } from 'vitest';
import { FakeTrack, flushMicrotasks } from './helpers/FakeMedia';
import { FakePeerConnection, fakeOfferSdp } from './helpers/FakePeerConnection';

// Самопроверка тестового двойника: unit-тесты PeerSession полагаются на то, что он бросает
// ошибки там же, где браузер (I1–I4). Разойдётся с браузером здесь — те тесты станут ложными.
describe('FakePeerConnection', () => {
  const candidate = {
    candidate: 'candidate:1 1 udp 1 h.local 1 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  };

  it('journals an offerer negotiation and transceiver changes in order', async () => {
    const pc = new FakePeerConnection();
    const mic = new FakeTrack('audio') as unknown as MediaStreamTrack;

    const audio = pc.addTransceiver(mic, { direction: 'sendrecv' });
    pc.addTransceiver('video', { direction: 'sendrecv' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await audio.sender.replaceTrack(null);
    await pc.setRemoteDescription({ type: 'answer', sdp: 'v=0' });

    expect(pc.journal).toEqual([
      `addTransceiver(${mic.id}, sendrecv)`,
      'addTransceiver(video, sendrecv)',
      'createOffer',
      'setLocalDescription(offer)',
      'audio.replaceTrack(null)',
      'setRemoteDescription(answer)',
    ]);
    expect(offer.sdp).toMatch(/m=audio[\s\S]*a=sendrecv[\s\S]*m=video[\s\S]*a=sendrecv/);
    expect(pc.signalingState).toBe('stable');
    expect(audio.sender.track).toBeNull();
  });

  it('creates recvonly transceivers from a remote offer, one per m-line', async () => {
    const pc = new FakePeerConnection();

    await pc.setRemoteDescription({ type: 'offer', sdp: fakeOfferSdp(['audio', 'video']) });
    const [audio, video] = pc.getTransceivers();
    audio!.direction = 'sendrecv';

    expect(pc.getTransceivers().map((tx) => [tx.receiver.track.kind, tx.direction])).toEqual([
      ['audio', 'sendrecv'],
      ['video', 'recvonly'],
    ]);
    expect(video!.sender.track).toBeNull();
    expect(pc.journal.at(-1)).toBe('audio.direction=sendrecv');
  });

  it('applies a held setRemoteDescription only on resolve', async () => {
    const pc = new FakePeerConnection().hold('setRemoteDescription');
    let settled = false;

    void pc.setRemoteDescription({ type: 'offer', sdp: fakeOfferSdp() }).then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(pc.remoteDescription).toBeNull();
    expect(settled).toBe(false);

    pc.takePending('setRemoteDescription').resolve();
    await flushMicrotasks();
    expect(pc.remoteDescription?.type).toBe('offer');
    expect(settled).toBe(true);
  });

  it('rejects a held call with the given error; after release calls complete immediately', async () => {
    const pc = new FakePeerConnection().hold('addIceCandidate');
    await pc.setRemoteDescription({ type: 'offer', sdp: fakeOfferSdp() });

    const first = pc.addIceCandidate(candidate);
    pc.takePending('addIceCandidate').reject(new DOMException('bad', 'OperationError'));
    pc.release('addIceCandidate');

    await expect(first).rejects.toMatchObject({ name: 'OperationError' });
    await expect(pc.addIceCandidate(candidate)).resolves.toBeUndefined();
    expect(pc.addedCandidates).toEqual([candidate]);
    expect(() => pc.takePending('addIceCandidate')).toThrow('No pending addIceCandidate call');
  });

  it('throws InvalidStateError like a browser on I1 and I4 violations', async () => {
    const pc = new FakePeerConnection();
    const invalidState = { name: 'InvalidStateError' };

    await expect(pc.addIceCandidate(candidate)).rejects.toMatchObject(invalidState);
    await expect(pc.createAnswer()).rejects.toMatchObject(invalidState);
    await expect(pc.setRemoteDescription({ type: 'answer', sdp: 'v=0' })).rejects.toMatchObject(
      invalidState,
    );

    // glare: чужой offer поверх собственного
    pc.addTransceiver('audio');
    await pc.setLocalDescription(await pc.createOffer());
    await expect(
      pc.setRemoteDescription({ type: 'offer', sdp: fakeOfferSdp() }),
    ).rejects.toMatchObject(invalidState);
    expect(() => pc.addTrack()).toThrow('I3');
  });

  it('dispatches events only on demand and serializes outgoing candidates via toJSON', () => {
    const pc = new FakePeerConnection();
    const seen: string[] = [];
    pc.oniceconnectionstatechange = () => seen.push(`ice:${pc.iceConnectionState}`);
    pc.onnegotiationneeded = () => seen.push('negotiationneeded');
    pc.onicecandidate = (e) => seen.push(`candidate:${JSON.stringify(e.candidate?.toJSON())}`);

    pc.addTransceiver('audio');
    expect(seen).toEqual([]);

    pc.setIceConnectionState('checking');
    pc.dispatchNegotiationNeeded();
    pc.emitIceCandidate(candidate);
    pc.emitIceCandidate(null);

    expect(seen).toEqual([
      'ice:checking',
      'negotiationneeded',
      `candidate:${JSON.stringify(candidate)}`,
      'candidate:undefined',
    ]);
  });

  it('resolves a call held across close() without applying it', async () => {
    const pc = new FakePeerConnection().hold('setRemoteDescription');
    const srd = pc.setRemoteDescription({ type: 'offer', sdp: fakeOfferSdp() });

    pc.close();
    pc.takePending('setRemoteDescription').resolve();

    await expect(srd).resolves.toBeUndefined();
    expect(pc.remoteDescription).toBeNull();
    expect(pc.getTransceivers()).toEqual([]);
  });

  it('close() ends remote tracks, is idempotent and rejects further operations', async () => {
    const pc = new FakePeerConnection();
    const tx = pc.addTransceiver('video');

    pc.close();
    pc.close();

    expect(pc.journal.filter((entry) => entry === 'close')).toHaveLength(1);
    expect(pc.signalingState).toBe('closed');
    expect(pc.iceConnectionState).toBe('closed');
    expect(tx.receiver.track.readyState).toBe('ended');
    await expect(pc.createOffer()).rejects.toMatchObject({ name: 'InvalidStateError' });
  });
});
