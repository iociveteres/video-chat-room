import { lazy, Suspense } from 'react';

/**
 * Условие — литерал прямо здесь: в prod-сборке оно статически ложно, ветка с import() вырезается,
 * и чанк оверлея вместе с CSS не собирается (проверка `npm run check:no-e2e-hook`).
 */
const DiagnosticsOverlay =
  import.meta.env.DEV || import.meta.env.VITE_E2E === '1'
    ? lazy(() => import('./DiagnosticsOverlay'))
    : null;

export function isDiagnosticsRequested(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

export interface DiagnosticsSlotProps {
  /** Query страницы; подмена — для тестов. */
  search?: string;
}

/** Место оверлея диагностики в комнате: только dev/E2E-сборка и ?debug=1 (TDD этапа 5 §4.4). */
export function DiagnosticsSlot({ search = window.location.search }: DiagnosticsSlotProps) {
  if (!DiagnosticsOverlay || !isDiagnosticsRequested(search)) return null;
  return (
    <Suspense fallback={null}>
      <DiagnosticsOverlay />
    </Suspense>
  );
}
