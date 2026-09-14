import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoTile, type VideoTileProps } from '../src/features/call/VideoTile';
import { FakeMediaStream } from './helpers/FakeMedia';

const stream = new FakeMediaStream() as unknown as MediaStream;

function renderTile(props: Partial<VideoTileProps> = {}) {
  const all: VideoTileProps = {
    name: 'Алекс',
    stream,
    showVideo: true,
    audioMuted: false,
    ...props,
  };
  const view = render(<VideoTile {...all} />);
  const video = () => view.container.querySelector('video')!;
  return {
    ...view,
    video,
    rerenderWith: (next: Partial<VideoTileProps>) =>
      view.rerender(<VideoTile {...all} {...next} />),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VideoTile', () => {
  it('shows the video without a placeholder when showVideo is true', () => {
    const t = renderTile();

    expect(t.video()).toBeInTheDocument();
    expect(t.video()).not.toHaveClass('tile__video--hidden');
    expect(t.container.querySelector('.avatar-placeholder')).toBeNull();
    expect(screen.getByRole('figure', { name: 'Алекс' })).toBeInTheDocument();
  });

  it('keeps <video> mounted but hidden and shows the placeholder when showVideo is false', () => {
    const t = renderTile();
    const videoBefore = t.video();

    t.rerenderWith({ showVideo: false, statusLabel: 'Камера выключена' });

    // Тот же элемент: не размонтирован, иначе на этапе 4 пропал бы звук собеседника.
    expect(t.video()).toBe(videoBefore);
    expect(t.video()).toHaveClass('tile__video--hidden');
    const placeholder = t.container.querySelector('.avatar-placeholder')!;
    expect(placeholder).toBeVisible();
    expect(placeholder).toHaveTextContent('Алекс');
    expect(placeholder).toHaveTextContent('Камера выключена');
    expect(placeholder.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a name with markup as text', () => {
    const name = '<img src=x onerror="window.__xss=1">';
    const t = renderTile({ name, showVideo: false });

    expect(t.container.querySelector('img')).toBeNull();
    expect(t.container.querySelector('.avatar-placeholder__name')?.textContent).toBe(name);
    expect(t.container.querySelector('.tile__name')?.textContent).toBe(name);
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });

  it('uses label for the overlay and name for the placeholder', () => {
    const t = renderTile({ label: 'Вы', showVideo: false });

    expect(t.container.querySelector('.tile__name')).toHaveTextContent('Вы');
    expect(t.container.querySelector('.avatar-placeholder__name')).toHaveTextContent('Алекс');
    expect(screen.getByRole('figure', { name: 'Вы' })).toBeInTheDocument();
  });

  it('shows the crossed-out microphone only when audio is muted', () => {
    const t = renderTile();
    expect(screen.queryByRole('img', { name: 'Микрофон выключен' })).toBeNull();

    t.rerenderWith({ audioMuted: true });

    expect(screen.getByRole('img', { name: 'Микрофон выключен' })).toBeInTheDocument();
  });

  it('mirrors only the video, not the label', () => {
    const t = renderTile({ mirrored: true });

    expect(t.video()).toHaveClass('tile__video--mirrored');
    expect(t.container.querySelector('.tile__label')?.className).toBe('tile__label');
  });

  it('mutes the element when asked (self-view)', () => {
    expect(renderTile({ muted: true }).video().muted).toBe(true);
  });

  it('binds srcObject and plays; rebinds when streamVersion changes', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const t = renderTile({ streamVersion: 0 });

    expect(t.video().srcObject).toBe(stream);
    expect(play).toHaveBeenCalledTimes(1);

    t.rerenderWith({ streamVersion: 0, audioMuted: true });
    expect(play).toHaveBeenCalledTimes(1);

    t.video().srcObject = null;
    t.rerenderWith({ streamVersion: 1 });
    expect(t.video().srcObject).toBe(stream);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('ignores a rejected play() (autoplay policy)', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'));

    renderTile();
    await Promise.resolve();

    expect(screen.getByRole('figure')).toBeInTheDocument();
  });

  it('does not call play() without a stream', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const t = renderTile({ stream: null, showVideo: false });

    expect(t.video().srcObject).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});
