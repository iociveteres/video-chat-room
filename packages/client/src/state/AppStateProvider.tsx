import {
  createContext,
  use,
  useEffect,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import { shouldLeaveOnNavigation } from '../session/navigation';
import { RoomSession } from '../session/RoomSession';
import type { AppAction } from './actions';
import { appReducer, initialAppState, type AppState } from './appReducer';

// Отдельные контексты: компонентам, которым нужны только dispatch или session,
// не придётся перерисовываться на каждое изменение state.
const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);
const RoomSessionContext = createContext<RoomSession | null>(null);

export interface AppStateProviderProps {
  children: ReactNode;
  /** Подмена сессии (тесты); по умолчанию — RoomSession с настоящим сокетом. */
  createSession?: (dispatch: Dispatch<AppAction>) => RoomSession;
}

const defaultCreateSession = (dispatch: Dispatch<AppAction>) => new RoomSession({ dispatch });

export function AppStateProvider({
  children,
  createSession = defaultCreateSession,
}: AppStateProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  // Одна сессия на всё время жизни провайдера, независимо от mount/unmount страниц.
  // dispatch из useReducer стабилен, поэтому ленивой инициализации достаточно.
  const [session] = useState(() => createSession(dispatch));

  useEffect(() => {
    const onPopState = () => {
      if (shouldLeaveOnNavigation(window.location.pathname, session.roomId)) session.leave();
    };
    const onPageHide = () => session.handlePageHide();

    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
      session.dispose();
    };
  }, [session]);

  return (
    <RoomSessionContext value={session}>
      <AppDispatchContext value={dispatch}>
        <AppStateContext value={state}>{children}</AppStateContext>
      </AppDispatchContext>
    </RoomSessionContext>
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

export function useRoomSession(): RoomSession {
  const session = use(RoomSessionContext);
  if (session === null) throw new Error('useRoomSession must be used inside <AppStateProvider>');
  return session;
}
