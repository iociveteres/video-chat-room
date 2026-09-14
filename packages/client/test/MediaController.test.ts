import { AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS } from '@vcr/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  classify,
  MediaController,
  type DeviceStatus,
  type TrackKind,
} from '../src/media/MediaController';
import {
  domError,
  FakeMediaDevices,
  FakeMediaStream,
  FakePermissions,
  FakeTrack,
} from './helpers/FakeMedia';

function setup(opts: { permissions?: FakePermissions } = {}) {
  const devices = new FakeMediaDevices();
  const preview = new FakeMediaStream();
  const statusLog: [TrackKind, DeviceStatus][] = [];
  const statuses: Record<TrackKind, DeviceStatus> = { audio: 'off', video: 'off' };
  const notices: { text: string; tone: 'info' | 'error' }[] = [];

  const controller = new MediaController({
    mediaDevices: devices as unknown as MediaDevices,
    permissions: opts.permissions,
    onStatus: (kind, status) => {
      statusLog.push([kind, status]);
      statuses[kind] = status;
    },
    onNotice: (text, tone) => notices.push({ text, tone }),
    createStream: () => preview as unknown as MediaStream,
  });

  const liveTracks = () => devices.createdTracks.filter((t) => t.readyState === 'live');
  const tracks = () => controller.getTracks() as unknown as Record<TrackKind, FakeTrack | null>;

  return { controller, devices, preview, statusLog, statuses, notices, liveTracks, tracks };
}

const BOTH = { audio: AUDIO_CONSTRAINTS, video: VIDEO_CONSTRAINTS };

describe('MediaController.acquireInitial', () => {
  it('turns both devices on with a single getUserMedia call', async () => {
    const t = setup();

    await t.controller.acquireInitial();

    expect(t.devices.requests).toEqual([BOTH]);
    expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
    expect(t.statusLog).toEqual([
      ['audio', 'acquiring'],
      ['video', 'acquiring'],
      ['audio', 'on'],
      ['video', 'on'],
    ]);
    expect(t.controller.getPublicState()).toEqual({ audio: true, video: true });
    const { audio, video } = t.tracks();
    expect(audio).toMatchObject({ kind: 'audio', readyState: 'live' });
    expect(video).toMatchObject({ kind: 'video', readyState: 'live' });
    expect(t.preview.getTracks()).toEqual([video]);
    expect(t.notices).toEqual([]);
  });

  it('requests only the microphone when there is no videoinput', async () => {
    const t = setup();
    t.devices.inputs = ['audioinput'];

    await t.controller.acquireInitial();

    expect(t.devices.requests).toEqual([{ audio: AUDIO_CONSTRAINTS, video: false }]);
    expect(t.statuses).toEqual({ audio: 'on', video: 'not-found' });
    expect(t.controller.getPublicState()).toEqual({ audio: true, video: false });
    expect(t.preview.getTracks()).toEqual([]);
    expect(t.notices).toEqual([
      { text: 'Камера не найдена — вы в комнате без видео', tone: 'info' },
    ]);
  });

  it('does not call getUserMedia when there are no devices at all', async () => {
    const t = setup();
    t.devices.inputs = [];

    await t.controller.acquireInitial();

    expect(t.devices.getUserMedia).not.toHaveBeenCalled();
    expect(t.statuses).toEqual({ audio: 'not-found', video: 'not-found' });
    expect(t.notices).toEqual([
      { text: 'Камера и микрофон не найдены — вы в комнате без видео и звука', tone: 'info' },
    ]);
  });

  it('falls back to requesting both devices when enumerateDevices fails', async () => {
    const t = setup();
    t.devices.enumerateDevices.mockRejectedValueOnce(new Error('boom'));

    await t.controller.acquireInitial();

    expect(t.devices.requests).toEqual([BOTH]);
    expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
  });

  describe('NotAllowedError', () => {
    it('marks both denied without retries when there is no Permissions API', async () => {
      const t = setup();
      t.devices.rejectWith('NotAllowedError');

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([BOTH]);
      expect(t.statuses).toEqual({ audio: 'denied', video: 'denied' });
      expect(t.controller.getPublicState()).toEqual({ audio: false, video: false });
      expect(t.notices).toEqual([
        {
          text: 'Нет доступа к камере и микрофону — вы в комнате без видео и звука',
          tone: 'error',
        },
      ]);
    });

    it('retries only devices whose permission is not denied', async () => {
      const permissions = new FakePermissions();
      permissions.states = { camera: 'denied', microphone: 'prompt' };
      const t = setup({ permissions });
      t.devices.rejectWith('NotAllowedError', { once: true });

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([BOTH, { audio: AUDIO_CONSTRAINTS }]);
      expect(t.statuses).toEqual({ audio: 'on', video: 'denied' });
      expect(t.notices).toEqual([
        { text: 'Нет доступа к камере — вы в комнате без видео', tone: 'error' },
      ]);
    });

    it('classifies each device by its own retry', async () => {
      const permissions = new FakePermissions();
      const t = setup({ permissions });
      t.devices.rejectWith('NotAllowedError', { kind: 'video' });

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([
        BOTH,
        { audio: AUDIO_CONSTRAINTS },
        { video: VIDEO_CONSTRAINTS },
      ]);
      expect(t.statuses).toEqual({ audio: 'on', video: 'denied' });
    });

    it('treats a throwing permissions.query like a missing Permissions API', async () => {
      const permissions = new FakePermissions();
      permissions.unsupported.add('camera');
      const t = setup({ permissions });
      t.devices.rejectWith('NotAllowedError', { once: true });

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([BOTH]);
      expect(t.statuses).toEqual({ audio: 'denied', video: 'denied' });
    });

    it('treats SecurityError as denied', async () => {
      const t = setup();
      t.devices.rejectWith('SecurityError');

      await t.controller.acquireInitial();

      expect(t.statuses).toEqual({ audio: 'denied', video: 'denied' });
    });
  });

  describe('per-device retry', () => {
    it('NotReadableError on the camera: microphone on, camera busy', async () => {
      const t = setup();
      t.devices.rejectWith('NotReadableError', { kind: 'video' });

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([
        BOTH,
        { audio: AUDIO_CONSTRAINTS },
        { video: VIDEO_CONSTRAINTS },
      ]);
      expect(t.statuses).toEqual({ audio: 'on', video: 'busy' });
      expect(t.liveTracks().map((track) => track.kind)).toEqual(['audio']);
      expect(t.notices).toEqual([
        { text: 'Камера занята другим приложением — вы в комнате без видео', tone: 'error' },
      ]);
    });

    it.each(['NotFoundError', 'AbortError'])('retries per device after %s', async (name) => {
      const t = setup();
      t.devices.rejectWith(name, { once: true });

      await t.controller.acquireInitial();

      expect(t.devices.requests).toHaveLength(3);
      expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
      expect(t.notices).toEqual([]);
    });

    it('OverconstrainedError: retries the camera without constraints', async () => {
      const t = setup();
      t.devices.rejectConstrained('OverconstrainedError', 'video');

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([BOTH, { audio: AUDIO_CONSTRAINTS }, { video: true }]);
      expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
      expect(t.preview.getTracks()).toEqual([t.tracks().video]);
    });

    it('OverconstrainedError during a per-device retry is repeated without constraints', async () => {
      const t = setup();
      t.devices
        .rejectWith('NotReadableError', { once: true })
        .rejectConstrained('OverconstrainedError', 'video');

      await t.controller.acquireInitial();

      expect(t.devices.requests).toEqual([
        BOTH,
        { audio: AUDIO_CONSTRAINTS },
        { video: VIDEO_CONSTRAINTS },
        { video: true },
      ]);
      expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
    });

    it('reports different failures of the two devices in one notice', async () => {
      const permissions = new FakePermissions();
      permissions.states = { microphone: 'denied' };
      const t = setup({ permissions });
      t.devices
        .rejectWith('NotAllowedError', { once: true })
        .rejectWith('NotReadableError', { kind: 'video' });

      await t.controller.acquireInitial();

      expect(t.statuses).toEqual({ audio: 'denied', video: 'busy' });
      expect(t.notices).toEqual([
        {
          text: 'Нет доступа к микрофону. Камера занята другим приложением.',
          tone: 'error',
        },
      ]);
    });
  });

  it('marks both failed without retries on an unknown error', async () => {
    const t = setup();
    t.devices.getUserMedia.mockRejectedValueOnce(new TypeError('weird'));

    await t.controller.acquireInitial();

    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.statuses).toEqual({ audio: 'failed', video: 'failed' });
    expect(t.notices).toEqual([
      {
        text: 'Не удалось включить камеру и микрофон — вы в комнате без видео и звука',
        tone: 'error',
      },
    ]);
  });

  it('stops tracks of kinds that were not requested', async () => {
    const t = setup();
    t.devices.inputs = ['audioinput'];
    const audio = new FakeTrack('audio');
    const stray = new FakeTrack('video');
    t.devices.getUserMedia.mockResolvedValueOnce(new FakeMediaStream([audio, stray]));

    await t.controller.acquireInitial();

    expect(t.tracks()).toEqual({ audio, video: null });
    expect(stray.stop).toHaveBeenCalledTimes(1);
    expect(t.preview.getTracks()).toEqual([]);
    expect(t.statuses).toEqual({ audio: 'on', video: 'not-found' });
  });

  it('marks a requested kind failed when the stream has no such track', async () => {
    const t = setup();
    const audio = new FakeTrack('audio');
    t.devices.getUserMedia.mockResolvedValueOnce(new FakeMediaStream([audio]));

    await t.controller.acquireInitial();

    expect(t.statuses).toEqual({ audio: 'on', video: 'failed' });
  });

  it('runs operations sequentially: no parallel getUserMedia', async () => {
    const t = setup();
    t.devices.deferNext();

    const first = t.controller.acquireInitial();
    const second = t.controller.acquireInitial();
    await vi.waitFor(() => {
      expect(t.devices.pending).toHaveLength(1);
    });
    await Promise.resolve();
    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);

    t.devices.pending[0]!.grant();
    await Promise.all([first, second]);

    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(2);
    // Не больше одного живого трека каждого kind.
    expect(
      t
        .liveTracks()
        .map((track) => track.kind)
        .sort(),
    ).toEqual(['audio', 'video']);
    expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
  });

  it('keeps the queue alive after an operation throws unexpectedly', async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const onStatusThrows = new MediaController({
      mediaDevices: t.devices as unknown as MediaDevices,
      onStatus: () => {
        calls += 1;
        if (calls === 1) throw new Error('listener exploded');
      },
      onNotice: () => {},
      createStream: () => new FakeMediaStream() as unknown as MediaStream,
    });

    await expect(onStatusThrows.acquireInitial()).resolves.toBeUndefined();
    await onStatusThrows.acquireInitial();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onStatusThrows.getPublicState()).toEqual({ audio: true, video: true });
    warn.mockRestore();
  });
});

describe('MediaController.stopAll', () => {
  it('stops live tracks, empties the preview and reports off', async () => {
    const t = setup();
    await t.controller.acquireInitial();
    const { audio, video } = t.tracks();

    t.controller.stopAll();

    expect(audio?.stop).toHaveBeenCalledTimes(1);
    expect(video?.stop).toHaveBeenCalledTimes(1);
    expect(t.liveTracks()).toEqual([]);
    expect(t.controller.getTracks()).toEqual({ audio: null, video: null });
    expect(t.preview.getTracks()).toEqual([]);
    expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
    expect(t.controller.getPublicState()).toEqual({ audio: false, video: false });
  });

  it('immediately stops tracks from a getUserMedia that resolves after stopAll', async () => {
    const t = setup();
    t.devices.deferNext();
    const acquiring = t.controller.acquireInitial();
    await vi.waitFor(() => {
      expect(t.devices.pending).toHaveLength(1);
    });

    t.controller.stopAll();
    expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
    t.devices.pending[0]!.grant();
    await acquiring;

    expect(t.devices.createdTracks).toHaveLength(2);
    expect(t.liveTracks()).toEqual([]);
    expect(t.controller.getTracks()).toEqual({ audio: null, video: null });
    expect(t.preview.getTracks()).toEqual([]);
    expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
    expect(t.notices).toEqual([]);
  });

  it('drops a late rejection without statuses or notices', async () => {
    const t = setup();
    t.devices.deferNext();
    const acquiring = t.controller.acquireInitial();
    await vi.waitFor(() => {
      expect(t.devices.pending).toHaveLength(1);
    });

    t.controller.stopAll();
    t.devices.pending[0]!.reject('NotReadableError');
    await acquiring;

    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
    expect(t.notices).toEqual([]);
  });

  it('interrupts per-device retries', async () => {
    const t = setup();
    t.devices.rejectWith('NotReadableError', { once: true }).deferNext();
    const acquiring = t.controller.acquireInitial();
    await vi.waitFor(() => {
      expect(t.devices.pending).toHaveLength(1);
    });

    t.controller.stopAll();
    t.devices.pending[0]!.grant();
    await acquiring;

    // Камеру после остановки уже не запрашиваем.
    expect(t.devices.requests).toEqual([BOTH, { audio: AUDIO_CONSTRAINTS }]);
    expect(t.liveTracks()).toEqual([]);
    expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
  });

  it('leaves the controller reusable for the next join', async () => {
    const t = setup();
    await t.controller.acquireInitial();
    const firstVideo = t.tracks().video;
    t.controller.stopAll();

    await t.controller.acquireInitial();

    expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
    expect(t.tracks().video).not.toBe(firstVideo);
    expect(t.preview.getTracks()).toEqual([t.tracks().video]);
    expect(t.liveTracks()).toHaveLength(2);
  });
});

describe('classify', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['DevicesNotFoundError', 'not-found'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'busy'],
    ['OverconstrainedError', 'failed'],
    ['TypeError', 'failed'],
  ])('%s → %s', (name, status) => {
    expect(classify(domError(name))).toBe(status);
  });

  it.each([null, undefined, 'NotAllowedError', 42, {}])('non-error %j → failed', (value) => {
    expect(classify(value)).toBe('failed');
  });
});
