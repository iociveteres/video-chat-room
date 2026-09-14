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

describe('DeviceToggle', () => {
  it.each<[DeviceStatus, boolean]>([
    ['on', true],
    ['off', false],
    ['acquiring', false],
    ['denied', false],
    ['not-found', false],
    ['busy', false],
    ['lost', false],
    ['failed', false],
  ])('status %s → aria-pressed=%s', (status, pressed) => {
    const { button } = renderToggle('video', status);
    expect(button).toHaveAttribute('aria-pressed', String(pressed));
  });

  it.each<[TrackKind, DeviceStatus, string]>([
    ['audio', 'on', 'Микрофон включён'],
    ['audio', 'off', 'Микрофон выключен'],
    ['audio', 'acquiring', 'Включаем микрофон…'],
    ['audio', 'denied', 'Нет доступа к микрофону'],
    ['audio', 'not-found', 'Микрофон не найден'],
    ['audio', 'busy', 'Микрофон занят другим приложением'],
    ['audio', 'lost', 'Микрофон отключён'],
    ['audio', 'failed', 'Не удалось включить микрофон'],
    ['video', 'on', 'Камера включена'],
    ['video', 'off', 'Камера выключена'],
    ['video', 'acquiring', 'Включаем камеру…'],
    ['video', 'denied', 'Нет доступа к камере'],
    ['video', 'not-found', 'Камера не найдена'],
    ['video', 'busy', 'Камера занята другим приложением'],
    ['video', 'lost', 'Камера отключена'],
    ['video', 'failed', 'Не удалось включить камеру'],
  ])('%s %s → title «%s»', (kind, status, title) => {
    const { button } = renderToggle(kind, status);
    expect(button).toHaveAttribute('title', title);
  });

  it('is disabled only while acquiring', async () => {
    const { button, onToggle } = renderToggle('video', 'acquiring');

    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it.each<DeviceStatus>(['on', 'off', 'denied', 'not-found', 'busy', 'lost', 'failed'])(
    'is clickable in %s (an error status retries the device)',
    async (status) => {
      const { button, onToggle } = renderToggle('audio', status);

      expect(button).toBeEnabled();
      await userEvent.click(button);
      expect(onToggle).toHaveBeenCalledTimes(1);
    },
  );

  it.each<[DeviceStatus, string]>([
    ['on', 'on'],
    ['off', 'off'],
    ['acquiring', 'off'],
    ['denied', 'warning'],
    ['not-found', 'warning'],
    ['busy', 'warning'],
    ['lost', 'warning'],
    ['failed', 'warning'],
  ])('status %s → %s icon', (status, icon) => {
    const t = renderToggle('audio', status);
    expect(t.icon).toHaveAttribute('data-icon', icon);
    expect(t.icon.querySelector('.device-toggle__warning') !== null).toBe(icon === 'warning');
  });
});
