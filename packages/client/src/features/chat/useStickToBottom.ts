import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Прокручивает контейнер к низу при каждом изменении trigger — до отрисовки кадра, без мигания.
 * Прокрутка безусловная, как требует PRD (TDD §13).
 *
 * trigger — id последнего сообщения, а не длина списка: при заполненной истории новое сообщение
 * вытесняет старое, и длина не меняется.
 */
export function useStickToBottom<T extends HTMLElement>(trigger: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [trigger]);

  return ref;
}
