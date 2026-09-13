import { NAME_MAX_LENGTH, validateName, type NameValidation } from '@vcr/shared';
import { useId, useState, type FormEvent } from 'react';

export interface NameFormProps {
  /** Текст кнопки: «Создать комнату» на стартовом экране, «Войти» при входе по ссылке. */
  submitLabel: string;
  initialName?: string;
  /** Получает уже нормализованное имя. */
  onSubmit: (name: string) => void;
  /** Ошибка извне (сервер отклонил имя); скрывается после первого изменения поля. */
  error?: string;
}

const HINTS: Record<Extract<NameValidation, { ok: false }>['reason'], string> = {
  EMPTY: 'Имя не должно быть пустым',
  TOO_LONG: `Не больше ${NAME_MAX_LENGTH} символов`,
  FORBIDDEN_CHARS:
    'Допустимы буквы, цифры, пробел, точка, дефис и подчёркивание; нужна хотя бы одна буква или цифра',
};

export function NameForm({ submitLabel, initialName = '', onSubmit, error }: NameFormProps) {
  const inputId = useId();
  const hintId = useId();
  const [value, setValue] = useState(initialName);
  const [touched, setTouched] = useState(initialName !== '');
  const [edited, setEdited] = useState(false);

  const validation = validateName(value);
  // Пустое поле до первого ввода не подсвечиваем — только блокируем кнопку.
  const validationHint = !validation.ok && touched ? HINTS[validation.reason] : null;
  const hint = validationHint ?? (edited ? null : (error ?? null));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validation.ok) onSubmit(validation.value);
  };

  return (
    <form className="name-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId}>Ваше имя</label>
      <input
        id={inputId}
        name="name"
        type="text"
        autoComplete="nickname"
        autoFocus
        // Обрезает и ввод, и вставку (FR-38). Точную длину в code points проверяет validateName.
        maxLength={NAME_MAX_LENGTH}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setTouched(true);
          setEdited(true);
        }}
        aria-invalid={hint !== null}
        aria-describedby={hint ? hintId : undefined}
      />
      <p id={hintId} className="name-form__hint" role="status">
        {hint}
      </p>
      <button type="submit" disabled={!validation.ok}>
        {submitLabel}
      </button>
    </form>
  );
}
