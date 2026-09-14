import { AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS, type MediaConstraintsSpec } from '@vcr/shared';
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

function setup(
  opts: { permissions?: FakePermissions; videoConstraints?: MediaConstraintsSpec } = {},
) {
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
    videoConstraints: opts.videoConstraints,
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

  it('uses the injected video constraints for the camera, also when turned on later', async () => {
    const low = { width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { max: 15 } };
    const t = setup({ videoConstraints: low });

    await t.controller.acquireInitial();
    await t.controller.setVideoEnabled(false);
    await t.controller.setVideoEnabled(true);

    expect(t.devices.requests).toEqual([{ audio: AUDIO_CONSTRAINTS, video: low }, { video: low }]);
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

    it('retries per device after NotFoundError', async () => {
      const t = setup();
      t.devices.rejectWith('NotFoundError', { once: true });

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

  it('does not make new operations wait for a getUserMedia that never answers', async () => {
    const t = setup();
    t.devices.deferNext();
    void t.controller.acquireInitial(); // пользователь не отвечает на запрос разрешения
    await vi.waitFor(() => {
      expect(t.devices.pending).toHaveLength(1);
    });

    t.controller.stopAll();
    await t.controller.setVideoEnabled(true);

    expect(t.statuses).toEqual({ audio: 'off', video: 'on' });
    expect(t.preview.getTracks()).toEqual([t.tracks().video]);

    // Поздний ответ на первый запрос ничего не меняет и не держит устройства.
    t.devices.pending[0]!.grant();
    await vi.waitFor(() => {
      expect(t.liveTracks()).toHaveLength(1);
    });
    expect(t.statuses).toEqual({ audio: 'off', video: 'on' });
    expect(t.tracks().audio).toBeNull();
  });

  it('drops operations that were queued before stopAll and have not started', async () => {
    const t = setup();
    t.devices.deferNext();
    const acquiring = t.controller.acquireInitial();
    const enabling = t.controller.setVideoEnabled(true);
    await vi.waitFor(() => {
      expect(t.devices.pending).toHaveLength(1);
    });

    t.controller.stopAll();
    t.devices.pending[0]!.grant();
    await Promise.all([acquiring, enabling]);

    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.liveTracks()).toEqual([]);
    expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
  });

  it('a camera turned off right before stopAll does not overwrite later statuses', async () => {
    const t = setup();
    await t.controller.acquireInitial();
    let release: () => void = () => {};
    t.controller.onTrackChange(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const disabling = t.controller.setVideoEnabled(false);
    await vi.waitFor(() => {
      expect(t.controller.getTracks().video).toBeNull();
    });

    t.controller.stopAll();
    await t.controller.acquireInitial();
    // acquireInitial не вызывает trackChange, так что release относится к выключению.
    release();
    await disabling;

    expect(t.statuses).toEqual({ audio: 'on', video: 'on' });
    expect(t.liveTracks()).toHaveLength(2);
  });
});

/** Controller после успешного захвата при входе. */
async function setupJoined(opts: { permissions?: FakePermissions } = {}) {
  const t = setup(opts);
  await t.controller.acquireInitial();
  t.statusLog.length = 0;
  return t;
}

type TrackChange = [TrackKind, FakeTrack | null];

function recordTrackChanges(controller: MediaController): TrackChange[] {
  const changes: TrackChange[] = [];
  controller.onTrackChange((kind, track) => {
    changes.push([kind, track as unknown as FakeTrack | null]);
  });
  return changes;
}

describe('MediaController.onTrackChange', () => {
  it('stops notifying after unsubscribe', async () => {
    const t = await setupJoined();
    const listener = vi.fn();
    const unsubscribe = t.controller.onTrackChange(listener);

    await t.controller.setVideoEnabled(false);
    unsubscribe();
    await t.controller.setVideoEnabled(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('video', null);
  });
});

describe('MediaController.setVideoEnabled', () => {
  describe('turning the camera off', () => {
    it('waits for listeners before stop(), then reports off', async () => {
      const t = await setupJoined();
      const track = t.tracks().video!;
      let stoppedBeforeListenerFinished: boolean | null = null;
      t.controller.onTrackChange(async (kind, next) => {
        expect([kind, next]).toEqual(['video', null]);
        await Promise.resolve();
        await Promise.resolve();
        stoppedBeforeListenerFinished = track.stop.mock.calls.length > 0;
      });

      await t.controller.setVideoEnabled(false);

      expect(stoppedBeforeListenerFinished).toBe(false);
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(track.readyState).toBe('ended');
      expect(t.controller.getTracks().video).toBeNull();
      expect(t.preview.getTracks()).toEqual([]);
      expect(t.statusLog).toEqual([['video', 'off']]);
      expect(t.controller.getPublicState()).toEqual({ audio: true, video: false });
      expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('does not stop the track while a listener promise is still pending (50 ms)', async () => {
      vi.useFakeTimers();
      try {
        const t = await setupJoined();
        const track = t.tracks().video!;
        t.controller.onTrackChange(() => new Promise((resolve) => setTimeout(resolve, 50)));

        const disabling = t.controller.setVideoEnabled(false);
        await vi.advanceTimersByTimeAsync(49);
        expect(track.stop).not.toHaveBeenCalled();
        expect(t.statuses.video).toBe('on');

        await vi.advanceTimersByTimeAsync(1);
        await disabling;
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(t.statuses.video).toBe('off');
      } finally {
        vi.useRealTimers();
      }
    });

    it('still stops the track when listeners throw or reject', async () => {
      const t = await setupJoined();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const track = t.tracks().video!;
      const healthy = vi.fn();
      t.controller.onTrackChange(() => {
        throw new Error('sync failure');
      });
      t.controller.onTrackChange(() => Promise.reject(new Error('async failure')));
      t.controller.onTrackChange(healthy);

      await t.controller.setVideoEnabled(false);

      expect(healthy).toHaveBeenCalledWith('video', null);
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(t.statuses.video).toBe('off');
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it('reports off without a track (camera not found)', async () => {
      const t = setup();
      t.devices.inputs = ['audioinput'];
      await t.controller.acquireInitial();
      const changes = recordTrackChanges(t.controller);

      await t.controller.setVideoEnabled(false);

      expect(t.statuses.video).toBe('off');
      expect(changes).toEqual([]);
    });
  });

  describe('turning the camera on', () => {
    it('acquires a new track, notifies listeners and puts only it into the preview', async () => {
      const t = await setupJoined();
      const oldTrack = t.tracks().video!;
      await t.controller.setVideoEnabled(false);
      t.statusLog.length = 0;
      const changes = recordTrackChanges(t.controller);

      await t.controller.setVideoEnabled(true);

      const newTrack = t.tracks().video!;
      expect(newTrack).not.toBe(oldTrack);
      expect(newTrack.readyState).toBe('live');
      expect(oldTrack.readyState).toBe('ended');
      expect(t.devices.requests.at(-1)).toEqual({ video: VIDEO_CONSTRAINTS });
      expect(changes).toEqual([['video', newTrack]]);
      expect(t.preview.getTracks()).toEqual([newTrack]);
      expect(t.statusLog).toEqual([
        ['video', 'acquiring'],
        ['video', 'on'],
      ]);
    });

    it('reports on only after listeners have attached the new track', async () => {
      const t = await setupJoined();
      await t.controller.setVideoEnabled(false);
      let statusDuringListener: DeviceStatus | null = null;
      t.controller.onTrackChange(async () => {
        await Promise.resolve();
        statusDuringListener = t.statuses.video;
      });

      await t.controller.setVideoEnabled(true);

      expect(statusDuringListener).toBe('acquiring');
      expect(t.statuses.video).toBe('on');
    });

    it('a double setVideoEnabled(true) calls getUserMedia once', async () => {
      const t = await setupJoined();
      await t.controller.setVideoEnabled(false);
      const before = t.devices.getUserMedia.mock.calls.length;

      await Promise.all([t.controller.setVideoEnabled(true), t.controller.setVideoEnabled(true)]);

      expect(t.devices.getUserMedia.mock.calls.length - before).toBe(1);
      expect(t.liveTracks().filter((track) => track.kind === 'video')).toHaveLength(1);
    });

    it('reports the error status and a notice when the camera cannot be acquired', async () => {
      const t = await setupJoined();
      await t.controller.setVideoEnabled(false);
      t.devices.rejectWith('NotAllowedError', { kind: 'video' });
      const changes = recordTrackChanges(t.controller);

      await t.controller.setVideoEnabled(true);

      expect(t.statuses.video).toBe('denied');
      expect(t.notices).toEqual([{ text: 'Нет доступа к камере', tone: 'error' }]);
      expect(changes).toEqual([]);
      expect(t.preview.getTracks()).toEqual([]);
    });

    it('retries from an error status on the next click', async () => {
      const t = setup();
      t.devices.rejectWith('NotReadableError', { kind: 'video', once: true });
      t.devices.rejectWith('NotReadableError', { kind: 'video', once: true });
      await t.controller.acquireInitial();
      expect(t.statuses.video).toBe('busy');

      await t.controller.setVideoEnabled(true);

      expect(t.statuses.video).toBe('on');
      expect(t.preview.getTracks()).toEqual([t.tracks().video]);
    });

    it('stops a camera track that arrives after stopAll', async () => {
      const t = await setupJoined();
      await t.controller.setVideoEnabled(false);
      t.devices.deferNext();
      const enabling = t.controller.setVideoEnabled(true);
      await vi.waitFor(() => {
        expect(t.devices.pending).toHaveLength(1);
      });

      t.controller.stopAll();
      t.devices.pending[0]!.grant();
      await enabling;

      expect(t.liveTracks()).toEqual([]);
      expect(t.preview.getTracks()).toEqual([]);
      expect(t.statuses).toEqual({ audio: 'off', video: 'off' });
      expect(t.notices).toEqual([]);
    });
  });
});

describe('MediaController.setAudioEnabled', () => {
  it('toggles the microphone via track.enabled without getUserMedia or track changes', async () => {
    const t = await setupJoined();
    const track = t.tracks().audio!;
    const changes = recordTrackChanges(t.controller);

    await t.controller.setAudioEnabled(false);
    expect(track.enabled).toBe(false);
    expect(t.controller.getPublicState()).toEqual({ audio: false, video: true });

    await t.controller.setAudioEnabled(true);
    expect(track.enabled).toBe(true);

    expect(t.tracks().audio).toBe(track);
    expect(track.stop).not.toHaveBeenCalled();
    expect(t.devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
    expect(t.statusLog).toEqual([
      ['audio', 'off'],
      ['audio', 'on'],
    ]);
  });

  it('acquires the microphone from an error status and notifies listeners', async () => {
    const t = setup();
    t.devices.rejectWith('NotAllowedError', { once: true });
    await t.controller.acquireInitial();
    expect(t.statuses.audio).toBe('denied');
    const changes = recordTrackChanges(t.controller);

    await t.controller.setAudioEnabled(true);

    const track = t.tracks().audio!;
    expect(t.devices.requests.at(-1)).toEqual({ audio: AUDIO_CONSTRAINTS });
    expect(changes).toEqual([['audio', track]]);
    expect(t.statuses.audio).toBe('on');
    expect(t.preview.getTracks()).toEqual([]);
  });

  it('reports the error status and a notice when the microphone is still unavailable', async () => {
    const t = setup();
    t.devices.inputs = ['videoinput'];
    await t.controller.acquireInitial();
    t.notices.length = 0;
    t.devices.rejectWith('NotFoundError', { kind: 'audio' });

    await t.controller.setAudioEnabled(true);

    expect(t.statuses.audio).toBe('not-found');
    expect(t.notices).toEqual([{ text: 'Микрофон не найден', tone: 'error' }]);
  });

  it('turning off without a track just reports off', async () => {
    const t = setup();
    t.devices.rejectWith('NotAllowedError');
    await t.controller.acquireInitial();

    await t.controller.setAudioEnabled(false);

    expect(t.statuses.audio).toBe('off');
  });
});

describe('MediaController: device lost', () => {
  it('camera ended → listeners get null, preview is emptied, status lost, notice', async () => {
    const t = await setupJoined();
    const track = t.tracks().video!;
    const changes = recordTrackChanges(t.controller);

    track.dispatchEnded();

    await vi.waitFor(() => {
      expect(t.statuses.video).toBe('lost');
    });
    expect(changes).toEqual([['video', null]]);
    expect(t.controller.getTracks().video).toBeNull();
    expect(t.preview.getTracks()).toEqual([]);
    expect(t.controller.getPublicState()).toEqual({ audio: true, video: false });
    expect(t.notices).toEqual([
      {
        text: 'Камера отключена или стала недоступна. Проверьте устройство и включите камеру снова.',
        tone: 'error',
      },
    ]);
  });

  it('microphone ended → status lost and notice', async () => {
    const t = await setupJoined();
    const changes = recordTrackChanges(t.controller);

    t.tracks().audio!.dispatchEnded();

    await vi.waitFor(() => {
      expect(t.statuses.audio).toBe('lost');
    });
    expect(changes).toEqual([['audio', null]]);
    expect(t.notices.at(-1)?.text).toBe(
      'Микрофон отключён или стал недоступен. Проверьте устройство и включите микрофон снова.',
    );
  });

  it('ignores ended from a stale track', async () => {
    const t = await setupJoined();
    const oldTrack = t.tracks().video!;
    await t.controller.setVideoEnabled(false);
    await t.controller.setVideoEnabled(true);
    t.statusLog.length = 0;
    const changes = recordTrackChanges(t.controller);

    oldTrack.dispatchEvent(new Event('ended'));
    await t.controller.setAudioEnabled(true); // дождаться очереди

    expect(t.statuses.video).toBe('on');
    expect(t.statusLog).toEqual([]);
    expect(changes).toEqual([]);
    expect(t.notices).toEqual([]);
  });

  it('ignores ended that arrives after the camera was turned off in the same tick', async () => {
    const t = await setupJoined();
    const track = t.tracks().video!;

    const disabling = t.controller.setVideoEnabled(false);
    track.dispatchEnded();
    await disabling;
    await t.controller.setAudioEnabled(true);

    expect(t.statuses.video).toBe('off');
    expect(t.notices).toEqual([]);
  });

  it('ignores ended after stopAll', async () => {
    const t = await setupJoined();
    const track = t.tracks().video!;

    t.controller.stopAll();
    track.dispatchEnded();
    await t.controller.setAudioEnabled(false);

    expect(t.statuses.video).toBe('off');
    expect(t.notices).toEqual([]);
  });
});

it('never clones tracks', async () => {
  const t = await setupJoined();
  recordTrackChanges(t.controller);

  await t.controller.setVideoEnabled(false);
  await t.controller.setVideoEnabled(true);
  await t.controller.setAudioEnabled(false);
  await t.controller.setAudioEnabled(true);
  t.tracks().video!.dispatchEnded();
  await t.controller.setVideoEnabled(true);
  t.controller.stopAll();

  expect(t.devices.createdTracks.length).toBeGreaterThan(0);
  for (const track of t.devices.createdTracks) expect(track.clone).not.toHaveBeenCalled();
  expect(t.liveTracks()).toEqual([]);
});

describe('classify', () => {
  it('treats non-errors as failed', () => {
    expect([null, 'NotAllowedError', {}].map(classify)).toEqual(['failed', 'failed', 'failed']);
  });

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
});
