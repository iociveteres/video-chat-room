import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceToggle } from '../src/features/controls/DeviceToggle';
import type { DeviceStatus, TrackKind } from '../src/media/MediaController';

function renderToggle(kind: TrackKind, status: DeviceStatus, onToggle = vi.fn()) {
  render(<DeviceToggle kind={kind} status={status} onToggle={onToggle} />);
  const button = screen.getByRole('button', { name: kind === 'audio' ? 'Микрофон' : 'Камера' });
  const icon = button.querySelector('.device-toggle__icon')!;
  return { button, icon, onToggle };
}

// Тексты всех статусов проверяются в mediaTexts.test.ts; здесь — что кнопка их использует.
describe('DeviceToggle', () => {
  it('on: pressed, «on» icon, clickable', async () => {
    const t = renderToggle('audio', 'on');

    expect(t.button).toHaveAttribute('aria-pressed', 'true');
    expect(t.button).toHaveAttribute('title', 'Микрофон включён');
    expect(t.icon).toHaveAttribute('data-icon', 'on');
    await userEvent.click(t.button);
    expect(t.onToggle).toHaveBeenCalledTimes(1);
  });

  it('off: not pressed, «off» icon without a warning, clickable', async () => {
    const t = renderToggle('video', 'off');

    expect(t.button).toHaveAttribute('aria-pressed', 'false');
    expect(t.button).toHaveAttribute('title', 'Камера выключена');
    expect(t.icon).toHaveAttribute('data-icon', 'off');
    expect(t.icon.querySelector('.device-toggle__warning')).toBeNull();
    await userEvent.click(t.button);
    expect(t.onToggle).toHaveBeenCalledTimes(1);
  });

  it('acquiring: not pressed and disabled', async () => {
    const t = renderToggle('video', 'acquiring');

    expect(t.button).toHaveAttribute('aria-pressed', 'false');
    expect(t.button).toHaveAttribute('title', 'Включаем камеру…');
    expect(t.button).toBeDisabled();
    await userEvent.click(t.button);
    expect(t.onToggle).not.toHaveBeenCalled();
  });

  it.each<DeviceStatus>(['denied', 'not-found', 'busy', 'lost', 'failed'])(
    '%s: not pressed, warning icon, clickable to retry',
    async (status) => {
      const t = renderToggle('video', status);

      expect(t.button).toHaveAttribute('aria-pressed', 'false');
      expect(t.icon).toHaveAttribute('data-icon', 'warning');
      expect(t.icon.querySelector('.device-toggle__warning')).not.toBeNull();
      await userEvent.click(t.button);
      expect(t.onToggle).toHaveBeenCalledTimes(1);
    },
  );

  it('uses the reason as the title', () => {
    expect(renderToggle('video', 'busy').button).toHaveAttribute(
      'title',
      'Камера занята другим приложением',
    );
  });
});
