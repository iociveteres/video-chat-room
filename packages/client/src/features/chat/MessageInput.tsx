import { MESSAGE_MAX_LENGTH, normalizeMessage, validateMessage } from '@vcr/shared';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

/** С какой длины (в code points после нормализации) показывается счётчик. */
export const MESSAGE_COUNTER_THRESHOLD = 900;

export interface MessageInputProps {
  /** false — сообщение не отправлено, текст вернётся в поле. */
  onSend: (text: string) => Promise<boolean>;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const counterId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');

  const validation = validateMessage(draft);
  // Длина — как её посчитает сервер: после нормализации, в code points.
  const length = [...normalizeMessage(draft)].length;
  const showCounter = length >= MESSAGE_COUNTER_THRESHOLD;

  const send = () => {
    if (!validation.ok) return;
    const text = draft;
    // Поле очищается сразу; само сообщение появится в ленте после broadcast от сервера.
    setDraft('');
    textareaRef.current?.focus();
    void onSend(validation.value).then((sent) => {
      // Возвращаем текст, только если пользователь ещё не начал набирать новый.
      if (!sent) setDraft((current) => (current === '' ? text : current));
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter — перенос строки; Enter во время IME-композиции подтверждает ввод, а не отправляет.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="message-input__field"
        name="message"
        rows={2}
        placeholder="Сообщение"
        aria-label="Сообщение"
        aria-describedby={showCounter ? counterId : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="message-input__footer">
        {showCounter && (
          <span
            id={counterId}
            className={
              length > MESSAGE_MAX_LENGTH
                ? 'message-input__counter message-input__counter--over'
                : 'message-input__counter'
            }
            aria-live="polite"
          >
            {length}/{MESSAGE_MAX_LENGTH}
          </span>
        )}
        <button type="submit" disabled={!validation.ok}>
          Отправить
        </button>
      </div>
    </form>
  );
}
