import { useEffect } from 'react';
import { useAppDispatch, useAppState } from '../../state/AppStateProvider';

/** Сколько показывается тост из общего слота state.notice. */
export const NOTICE_DISMISS_MS = 4_000;

/** Тост для state.notice: чат (этап 2), медиа и звонок (этапы 3–4). Скрывается сам или по кнопке. */
export function NoticeToast() {
  const { notice } = useAppState();
  const dispatch = useAppDispatch();
  const noticeId = notice?.id;

  // Таймер перезапускается для каждого нового тоста, даже с тем же текстом.
  useEffect(() => {
    if (noticeId === undefined) return;
    const timer = setTimeout(() => dispatch({ type: 'NOTICE_DISMISSED' }), NOTICE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [noticeId, dispatch]);

  if (notice === null) return null;

  return (
    <div
      className={`notice notice--${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="notice__close"
        aria-label="Закрыть уведомление"
        onClick={() => dispatch({ type: 'NOTICE_DISMISSED' })}
      >
        ×
      </button>
    </div>
  );
}
