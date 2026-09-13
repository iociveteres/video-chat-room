import { useEffect, useRef, useState } from 'react';

/** Сколько показывается тост «Ссылка скопирована». */
export const COPY_TOAST_MS = 2_500;

export interface CopyLinkButtonProps {
  url: string;
}

type CopyStatus = 'idle' | 'copied' | 'failed';

export function CopyLinkButton({ url }: CopyLinkButtonProps) {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const fallbackRef = useRef<HTMLInputElement>(null);

  // Тост скрывается сам.
  useEffect(() => {
    if (status !== 'copied') return;
    const timer = setTimeout(() => setStatus('idle'), COPY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // Fallback: фокусируем и выделяем URL, чтобы осталось нажать Ctrl+C.
  useEffect(() => {
    if (status !== 'failed') return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [status]);

  const copy = async () => {
    try {
      // clipboard может отсутствовать или отклонить запись (нет разрешения, iframe и т.п.).
      if (!navigator.clipboard) throw new Error('Clipboard API is unavailable');
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div className="copy-link">
      <button type="button" onClick={() => void copy()}>
        Скопировать ссылку
      </button>
      {status === 'copied' && (
        <div className="toast" role="status">
          Ссылка скопирована
        </div>
      )}
      {status === 'failed' && (
        <label className="copy-link__fallback">
          Скопируйте ссылку вручную
          <input
            ref={fallbackRef}
            type="text"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
