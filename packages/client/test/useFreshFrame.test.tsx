import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRESH_FRAME_TIMEOUT_MS } from '../src/features/call/useFreshFrame';
import { VideoTile, type VideoTileProps } from '../src/features/call/VideoTile';
import { FakeMediaStream } from './helpers/FakeMedia';

const stream = new FakeMediaStream() as unknown as MediaStream;

/** requestVideoFrameCallback в jsdom нет: подставляем управляемую реализацию. */
function installVideoFrameCallback() {
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let seq = 0;
  const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
  const request = vi.fn((cb: VideoFrameRequestCallback) => {
    callbacks.set(++seq, cb);
    return seq;
  });
  const cancel = vi.fn((handle: number) => callbacks.delete(handle));
  proto.requestVideoFrameCallback = request;
  proto.cancelVideoFrameCallback = cancel;
  return {
    request,
    cancel,
    pending: () => callbacks.size,
    presentFrame: () =>
      act(() => {
        const all = [...callbacks.values()];
        callbacks.clear();
        for (const cb of all) cb(0, {} as VideoFrameCallbackMetadata);
      }),
  };
}

function renderTile(props: Partial<VideoTileProps> = {}) {
  const all: VideoTileProps = {
    name: 'Мария',
    stream,
    showVideo: true,
    audioMuted: false,
    waitForFreshFrame: true,
    ...props,
  };
  const view = render(<VideoTile {...all} />);
  return {
    ...view,
    video: () => view.container.querySelector('video')!,
    placeholder: () => view.container.querySelector('.avatar-placeholder'),
    rerenderWith: (next: Partial<VideoTileProps>) =>
      view.rerender(<VideoTile {...all} {...next} />),
  };
}

afterEach(() => {
  // Размонтировать до удаления подмены: cleanup эффекта вызывает cancelVideoFrameCallback.
  cleanup();
  const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
  delete proto.requestVideoFrameCallback;
  delete proto.cancelVideoFrameCallback;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useFreshFrame via VideoTile', () => {
  it('without requestVideoFrameCallback shows the video at once', () => {
    const t = renderTile();

    expect(t.placeholder()).toBeNull();
    expect(t.video()).not.toHaveClass('tile__video--pending');
  });

  it('keeps the placeholder over a transparent video until a new frame is presented', () => {
    const rvfc = installVideoFrameCallback();
    const t = renderTile({ overlayLabel: 'Связь нестабильна…' });

    expect(t.placeholder()).toHaveTextContent('Мария');
    expect(t.video()).toHaveClass('tile__video--pending');
    expect(t.video()).not.toHaveClass('tile__video--hidden');
    expect(t.container.querySelector('.tile__overlay')).toBeNull();

    rvfc.presentFrame();

    expect(t.placeholder()).toBeNull();
    expect(t.video()).not.toHaveClass('tile__video--pending');
  });

  it('camera off and on again waits for a frame again, reusing the same <video>', () => {
    const rvfc = installVideoFrameCallback();
    const t = renderTile();
    rvfc.presentFrame();
    const video = t.video();

    t.rerenderWith({ showVideo: false, statusLabel: 'Камера выключена' });
    expect(rvfc.pending()).toBe(0);
    expect(t.video()).toHaveClass('tile__video--hidden');

    t.rerenderWith({ showVideo: true });
    expect(t.placeholder()).not.toBeNull();
    expect(rvfc.pending()).toBe(1);

    rvfc.presentFrame();
    expect(t.placeholder()).toBeNull();
    expect(t.video()).toBe(video);
  });

  it('cancels the pending callback when the camera goes off before a frame', () => {
    const rvfc = installVideoFrameCallback();
    const t = renderTile();

    t.rerenderWith({ showVideo: false });

    expect(rvfc.cancel).toHaveBeenCalledOnce();
  });

  it(`shows the video after ${FRESH_FRAME_TIMEOUT_MS} ms even if no frame arrives`, () => {
    vi.useFakeTimers();
    installVideoFrameCallback();
    const t = renderTile();

    act(() => {
      vi.advanceTimersByTime(FRESH_FRAME_TIMEOUT_MS - 1);
    });
    expect(t.placeholder()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(t.placeholder()).toBeNull();
  });

  it('does not wait when waitForFreshFrame is off (self-view)', () => {
    const rvfc = installVideoFrameCallback();
    const t = renderTile({ waitForFreshFrame: false });

    expect(t.placeholder()).toBeNull();
    expect(rvfc.request).not.toHaveBeenCalled();
  });
});
