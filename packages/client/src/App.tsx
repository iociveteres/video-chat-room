import { useState } from 'react';
import { checkEnvironment } from './app/environment';
import { navigate, useRoute } from './app/router';
import { LobbyPage } from './features/lobby/LobbyPage';
import { RoomPage } from './features/room/RoomPage';
import { StatusScreen } from './features/status/StatusScreen';
import { AppStateProvider } from './state/AppStateProvider';

export function App() {
  // Окружение не меняется за время жизни вкладки — проверяем один раз.
  const [environment] = useState(checkEnvironment);

  if (environment !== 'ok') return <StatusScreen reason={environment} />;

  return (
    <AppStateProvider>
      <Routes />
    </AppStateProvider>
  );
}

function Routes() {
  const route = useRoute();

  switch (route.name) {
    case 'lobby':
      return <LobbyPage />;
    case 'room':
      // key: при переходе в другую комнату страница монтируется заново со свежей формой.
      return <RoomPage key={route.roomId} roomId={route.roomId} />;
    case 'invalid-link':
      return <StatusScreen reason="invalid-link" onHome={() => navigate('/')} />;
  }
}
