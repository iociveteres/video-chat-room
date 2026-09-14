import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Dispatch } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_DISMISS_MS, NoticeToast } from '../src/features/notice/NoticeToast';
import { RoomSession } from '../src/session/RoomSession';
import type { AppAction } from '../src/state/actions';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { FakeSocket } from './helpers/FakeSocket';

function renderToast() {
  let dispatch: Dispatch<AppAction> | undefined;
  const socket = new FakeSocket();
  render(
    <AppStateProvider
      createSession={(d) => {
        dispatch = d;
        return new RoomSession({ dispatch: d, createSocket: () => socket.asSocket() });
      }}
    >
      <NoticeToast />
    </AppStateProvider>,
  );

  // CHAT_SEND_FAILED принимается только в комнате — входим через фейковый сокет.
  act(() => {
    dispatch!({ type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' });
    dispatch!({
      type: 'JOIN_SUCCEEDED',
      self: { id: 'p1', name: 'Алекс', joinedAt: 1, media: { audio: false, video: false } },
      participants: [],
      messages: [],
    });
  });

  return { fail: (action: AppAction) => act(() => dispatch!(action)) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NoticeToast', () => {
  it('renders nothing without a notice', () => {
    renderToast();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows an error notice as an alert and hides it after NOTICE_DISMISS_MS', () => {
    const t = renderToast();

    t.fail({ type: 'CHAT_SEND_FAILED', code: 'RATE_LIMITED' });

    expect(screen.getByRole('alert')).toHaveTextContent('Слишком часто. Подождите секунду');
    act(() => {
      vi.advanceTimersByTime(NOTICE_DISMISS_MS - 1);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes on the close button', () => {
    const t = renderToast();
    t.fail({ type: 'CHAT_SEND_FAILED', code: 'TIMEOUT' });

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restarts the timer for a repeated notice with the same text', () => {
    const t = renderToast();
    t.fail({ type: 'CHAT_SEND_FAILED', code: 'RATE_LIMITED' });
    act(() => {
      vi.advanceTimersByTime(NOTICE_DISMISS_MS - 1_000);
    });

    t.fail({ type: 'CHAT_SEND_FAILED', code: 'RATE_LIMITED' });
    act(() => {
      vi.advanceTimersByTime(NOTICE_DISMISS_MS - 1);
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
