import { describe, expect, it } from 'vitest';
import { flushMicrotasks } from './helpers/FakeMedia';
import { FakePeerConnection, fakeOfferSdp } from './helpers/FakePeerConnection';

// Самопроверка тестового двойника: unit-тесты PeerSession полагаются на то, что он бросает
// ошибки там же, где браузер (I1–I4). Разойдётся с браузером здесь — те тесты станут ложными.
describe('FakePeerConnection', () => {
  const candidate = {
    candidate: 'candidate:1 1 udp 1 h.local 1 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  };

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

  it('resolves a call held across close() without applying it', async () => {
    const pc = new FakePeerConnection().hold('setRemoteDescription');
    const srd = pc.setRemoteDescription({ type: 'offer', sdp: fakeOfferSdp() });

    pc.close();
    pc.takePending('setRemoteDescription').resolve();

    await expect(srd).resolves.toBeUndefined();
    expect(pc.remoteDescription).toBeNull();
    expect(pc.getTransceivers()).toEqual([]);
  });
});
