import { useState } from 'react';
import { checkEnvironment } from './app/environment';
import { navigate, useRoute } from './app/router';
import { LobbyPage } from './features/lobby/LobbyPage';
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
      // Заглушка до RoomPage (задача 11).
      return (
        <main className="screen">
          <h1>Комната {route.roomId}</h1>
        </main>
      );
    case 'invalid-link':
      return <StatusScreen reason="invalid-link" onHome={() => navigate('/')} />;
  }
}
