import { createContext, use, useReducer, type Dispatch, type ReactNode } from 'react';
import type { AppAction } from './actions';
import { appReducer, initialAppState, type AppState } from './appReducer';

// Два контекста: компонентам, которым нужен только dispatch, не придётся перерисовываться
// на каждое изменение state.
const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppDispatchContext value={dispatch}>
      <AppStateContext value={state}>{children}</AppStateContext>
    </AppDispatchContext>
  );
}

export function useAppState(): AppState {
  const state = use(AppStateContext);
  if (state === null) throw new Error('useAppState must be used inside <AppStateProvider>');
  return state;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const dispatch = use(AppDispatchContext);
  if (dispatch === null) throw new Error('useAppDispatch must be used inside <AppStateProvider>');
  return dispatch;
}
