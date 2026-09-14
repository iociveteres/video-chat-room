import { createContext, use, useState, type ReactNode } from 'react';
import { useAppDispatch, useAppState } from '../../state/AppStateProvider';

export const AUTOPLAY_TEXT = {
  message: 'Браузер заблокировал воспроизведение звука',
  button: 'Включить звук',
} as const;

/** По name, а не instanceof: DOMException не везде наследует Error. */
function isNotAllowed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'NotAllowedError'
  );
}

export interface AutoplayCallbacks {
  onBlocked: () => void;
  onResumed: () => void;
}

/**
 * Реестр <video> удалённых плиток (TDD этапа 4 §4.8, FR-37). Autoplay-политика отклоняет play()
 * со звуком до жеста пользователя; повторный play() в обработчике клика её снимает.
 */
export class AutoplayRegistry {
  private readonly elements = new Set<HTMLVideoElement>();

  constructor(private readonly callbacks: AutoplayCallbacks) {}

  /** Добавить элемент и запустить воспроизведение. Возвращает отмену регистрации. */
  readonly register = (el: HTMLVideoElement): (() => void) => {
    this.elements.add(el);
    el.play().catch((error: unknown) => {
      // AbortError и прочее (сменился srcObject, элемент удалён) — не про autoplay.
      if (isNotAllowed(error) && this.elements.has(el)) this.callbacks.onBlocked();
    });
    return () => {
      this.elements.delete(el);
    };
  };

  /**
   * Вызывать синхронно из обработчика клика: play() должен начаться внутри жеста.
   * Баннер снимается, только если ни один элемент снова не упёрся в политику.
   */
  resumeAll(): Promise<void> {
    const attempts = [...this.elements].map((el) =>
      el.play().then(
        () => true,
        (error: unknown) => !isNotAllowed(error),
      ),
    );
    return Promise.all(attempts).then((results) => {
      if (results.every(Boolean)) this.callbacks.onResumed();
      else this.callbacks.onBlocked();
    });
  }
}

const AutoplayContext = createContext<AutoplayRegistry | null>(null);

/** Реестр autoplay на время пребывания в комнате. */
export function AutoplayGuard({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  // dispatch из useReducer стабилен, поэтому ленивой инициализации достаточно.
  const [registry] = useState(
    () =>
      new AutoplayRegistry({
        onBlocked: () => dispatch({ type: 'AUTOPLAY_BLOCKED' }),
        onResumed: () => dispatch({ type: 'AUTOPLAY_RESUMED' }),
      }),
  );
  return <AutoplayContext value={registry}>{children}</AutoplayContext>;
}

/** null вне AutoplayGuard: плитка тогда запускает воспроизведение сама. */
export function useAutoplayRegistry(): AutoplayRegistry | null {
  return use(AutoplayContext);
}

/** Баннер «Включить звук», пока autoplay заблокирован. */
export function AutoplayBanner() {
  const { autoplayBlocked } = useAppState();
  const registry = useAutoplayRegistry();
  if (!autoplayBlocked || !registry) return null;

  return (
    <section className="media-banner autoplay-banner" aria-label="Звук заблокирован">
      <span>{AUTOPLAY_TEXT.message}</span>
      <button type="button" onClick={() => void registry.resumeAll()}>
        {AUTOPLAY_TEXT.button}
      </button>
    </section>
  );
}
