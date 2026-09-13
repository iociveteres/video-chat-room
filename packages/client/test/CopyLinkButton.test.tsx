import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY_TOAST_MS, CopyLinkButton } from '../src/features/room/CopyLinkButton';

const URL = 'https://localhost:5173/r/q7Z3kP0aX_2m';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CopyLinkButton', () => {
  it('copies the url and shows a toast that hides after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // user-event подменяет navigator.clipboard своей заглушкой с readText.
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<CopyLinkButton url={URL} />);

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    expect(await navigator.clipboard.readText()).toBe(URL);
    expect(screen.getByRole('status')).toHaveTextContent('Ссылка скопирована');

    act(() => {
      vi.advanceTimersByTime(COPY_TOAST_MS);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('falls back to a selected read-only field when the clipboard rejects', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('NotAllowedError'));
    render(<CopyLinkButton url={URL} />);

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    const field = await screen.findByLabelText('Скопируйте ссылку вручную');
    expect(field).toHaveValue(URL);
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveFocus();
    const input = field as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, URL.length]);
    expect(screen.queryByText('Ссылка скопирована')).not.toBeInTheDocument();
  });

  it('falls back when the Clipboard API is unavailable', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard);
    render(<CopyLinkButton url={URL} />);

    await user.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    expect(await screen.findByLabelText('Скопируйте ссылку вручную')).toHaveValue(URL);
  });
});
