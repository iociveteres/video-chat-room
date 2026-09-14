import { MESSAGE_MAX_LENGTH } from '@vcr/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_COUNTER_THRESHOLD, MessageInput } from '../src/features/chat/MessageInput';

/** onSend, ответ на который тест выдаёт вручную. */
function deferredSend() {
  const resolvers: ((sent: boolean) => void)[] = [];
  const onSend = vi.fn(
    (_text: string) =>
      new Promise<boolean>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const settle = async (sent: boolean) => {
    await act(async () => {
      resolvers.shift()?.(sent);
      await Promise.resolve();
    });
  };
  return { onSend, settle };
}

function renderInput(onSend = vi.fn((_text: string) => Promise.resolve(true))) {
  render(<MessageInput onSend={onSend} />);
  return {
    onSend,
    user: userEvent.setup(),
    field: screen.getByRole('textbox', { name: 'Сообщение' }),
    button: screen.getByRole('button', { name: 'Отправить' }),
  };
}

describe('MessageInput', () => {
  it('Enter sends the message and clears the field at once', async () => {
    const { onSend, settle } = deferredSend();
    const { user, field } = renderInput(onSend);

    await user.type(field, 'Привет{Enter}');

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Привет');
    expect(field).toHaveValue('');
    await settle(true);
    expect(field).toHaveValue('');
  });

  it('Shift+Enter inserts a line break instead of sending', async () => {
    const { onSend, user, field } = renderInput();

    await user.type(field, 'раз{Shift>}{Enter}{/Shift}два');

    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('раз\nдва');

    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledExactlyOnceWith('раз\nдва');
  });

  it('does not send on Enter during IME composition', async () => {
    const { onSend, user, field } = renderInput();
    await user.type(field, 'にほん');

    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('にほん');
  });

  it('the button sends the normalized text', async () => {
    const { onSend, user, field, button } = renderInput();
    await user.type(field, '  Привет  ');

    await user.click(button);

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Привет');
    expect(field).toHaveFocus();
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['line breaks only', '{Shift>}{Enter}{Enter}{/Shift}'],
  ])('keeps the button disabled and Enter inert for %s input', async (_label, keys) => {
    const { onSend, user, field, button } = renderInput();
    if (keys) await user.type(field, keys);

    expect(button).toBeDisabled();
    await user.type(field, '{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('returns the text to the field when sending fails', async () => {
    const { onSend, settle } = deferredSend();
    const { user, field } = renderInput(onSend);
    await user.type(field, 'не дошло{Enter}');
    expect(field).toHaveValue('');

    await settle(false);

    expect(field).toHaveValue('не дошло');
  });

  it('does not overwrite a new draft when an earlier send fails', async () => {
    const { onSend, settle } = deferredSend();
    const { user, field } = renderInput(onSend);
    await user.type(field, 'первое{Enter}');
    await user.type(field, 'второе');

    await settle(false);

    expect(field).toHaveValue('второе');
  });

  describe('length counter', () => {
    it(`is hidden below ${MESSAGE_COUNTER_THRESHOLD} characters`, () => {
      const { field } = renderInput();
      fireEvent.change(field, { target: { value: 'a'.repeat(MESSAGE_COUNTER_THRESHOLD - 1) } });

      expect(screen.queryByText(/\/1000$/)).toBeNull();
    });

    it(`appears from ${MESSAGE_COUNTER_THRESHOLD} characters`, () => {
      const { field, button } = renderInput();
      fireEvent.change(field, { target: { value: 'a'.repeat(MESSAGE_COUNTER_THRESHOLD) } });

      const counter = screen.getByText(`${MESSAGE_COUNTER_THRESHOLD}/${MESSAGE_MAX_LENGTH}`);
      expect(field).toHaveAttribute('aria-describedby', counter.id);
      expect(button).toBeEnabled();
    });

    it('counts code points after normalization', () => {
      const { field } = renderInput();
      fireEvent.change(field, { target: { value: `  ${'😀'.repeat(950)}\n\n` } });

      expect(screen.getByText(`950/${MESSAGE_MAX_LENGTH}`)).toBeInTheDocument();
    });

    it('disables sending over the limit (paste)', async () => {
      const { onSend, field, button } = renderInput();
      fireEvent.change(field, { target: { value: 'a'.repeat(MESSAGE_MAX_LENGTH + 1) } });

      const counter = screen.getByText(`${MESSAGE_MAX_LENGTH + 1}/${MESSAGE_MAX_LENGTH}`);
      expect(counter).toHaveClass('message-input__counter--over');
      expect(button).toBeDisabled();
      fireEvent.keyDown(field, { key: 'Enter' });
      await Promise.resolve();
      expect(onSend).not.toHaveBeenCalled();
      expect(field).toHaveValue('a'.repeat(MESSAGE_MAX_LENGTH + 1));
    });
  });
});
