import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusScreen, type StatusReason } from '../src/features/status/StatusScreen';

function renderScreen(reason: StatusReason) {
  const onRetry = vi.fn();
  const onHome = vi.fn();
  render(<StatusScreen reason={reason} onRetry={onRetry} onHome={onHome} />);
  const alert = screen.getByRole('alert');
  return {
    onRetry,
    onHome,
    alert,
    buttons: () =>
      within(alert)
        .queryAllByRole('button')
        .map((b) => b.textContent),
  };
}

describe('StatusScreen', () => {
  it.each<[StatusReason, string, RegExp, string[]]>([
    ['ROOM_FULL', 'Комната заполнена', /уже 4 участника/, ['Повторить вход', 'На главную']],
    [
      'SERVER_UNAVAILABLE',
      'Сервер недоступен',
      /Проверьте подключение и попробуйте снова/,
      ['Повторить', 'На главную'],
    ],
    [
      'CONNECTION_LOST',
      'Соединение с сервером прервано',
      /как новый участник/,
      ['Войти снова', 'На главную'],
    ],
    ['INTERNAL', 'Что-то пошло не так', /Попробуйте ещё раз/, ['Повторить вход', 'На главную']],
    ['invalid-link', 'Некорректная ссылка на комнату', /создайте новую комнату/, ['На главную']],
    ['insecure-context', 'Нужен HTTPS', /Откройте приложение по HTTPS/, []],
    ['webrtc-unsupported', 'WebRTC не поддерживается', /Chrome, Firefox или Edge версии 100\+/, []],
  ])('%s: title, message and actions', (reason, title, message, buttons) => {
    const t = renderScreen(reason);

    expect(within(t.alert).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(within(t.alert).getByText(message)).toBeInTheDocument();
    expect(t.buttons()).toEqual(buttons);
  });

  it('calls onRetry and onHome', async () => {
    const user = userEvent.setup();
    const t = renderScreen('ROOM_FULL');

    await user.click(screen.getByRole('button', { name: 'Повторить вход' }));
    await user.click(screen.getByRole('button', { name: 'На главную' }));

    expect(t.onRetry).toHaveBeenCalledOnce();
    expect(t.onHome).toHaveBeenCalledOnce();
  });

  it('hides buttons whose handlers are not provided', () => {
    render(<StatusScreen reason="SERVER_UNAVAILABLE" />);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
