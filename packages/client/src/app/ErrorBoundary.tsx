import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Последний рубеж: вместо «белого экрана» показывает сообщение и предлагает перезагрузку (US-13). */
// Error boundary в React по-прежнему можно написать только классом.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="screen" role="alert">
        <h1>Что-то пошло не так</h1>
        <p>Перезагрузите страницу, чтобы продолжить.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Перезагрузить
        </button>
      </main>
    );
  }
}
