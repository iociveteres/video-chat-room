import { NAME_MAX_LENGTH } from '@vcr/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NameForm } from '../src/features/lobby/NameForm';

function setup(props: { initialName?: string } = {}) {
  const onSubmit = vi.fn<(name: string) => void>();
  render(<NameForm submitLabel="Создать комнату" onSubmit={onSubmit} {...props} />);
  return {
    onSubmit,
    user: userEvent.setup(),
    input: screen.getByLabelText('Ваше имя'),
    button: screen.getByRole('button', { name: 'Создать комнату' }),
  };
}

describe('NameForm', () => {
  it('starts with a disabled button and no hint', () => {
    const { input, button } = setup();

    expect(button).toBeDisabled();
    expect(input).toHaveAttribute('maxLength', String(NAME_MAX_LENGTH));
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Имя не должно быть пустым')).not.toBeInTheDocument();
  });

  it('enables the button for a valid name', async () => {
    const { user, input, button } = setup();

    await user.type(input, 'Алекс');

    expect(button).toBeEnabled();
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows «Имя не должно быть пустым» after the field is cleared or holds only spaces', async () => {
    const { user, input, button } = setup();

    await user.type(input, 'А');
    await user.clear(input);
    expect(screen.getByText('Имя не должно быть пустым')).toBeInTheDocument();
    expect(button).toBeDisabled();

    await user.type(input, '   ');
    expect(screen.getByText('Имя не должно быть пустым')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it.each(['Алекс<script>', 'Алекс😀', '...'])(
    'shows the allowed characters hint for %j',
    async (name) => {
      const { user, input, button } = setup();

      await user.type(input, name);

      expect(
        screen.getByText(/Допустимы буквы, цифры, пробел, точка, дефис и подчёркивание/),
      ).toBeInTheDocument();
      expect(button).toBeDisabled();
    },
  );

  it('truncates pasted input to NAME_MAX_LENGTH', async () => {
    const { user, input } = setup();

    await user.click(input);
    await user.paste('a'.repeat(NAME_MAX_LENGTH + 10));

    expect(input).toHaveValue('a'.repeat(NAME_MAX_LENGTH));
  });

  it('submits the normalized name on click and on Enter', async () => {
    const { user, input, button, onSubmit } = setup();

    await user.type(input, '  Андрей   Иванов ');
    await user.click(button);
    expect(onSubmit).toHaveBeenLastCalledWith('Андрей Иванов');

    await user.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('does not submit an invalid name on Enter', async () => {
    const { user, input, onSubmit } = setup();

    await user.type(input, '<b>{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills the initial name', () => {
    const { input, button } = setup({ initialName: 'Мария' });

    expect(input).toHaveValue('Мария');
    expect(button).toBeEnabled();
  });
});
