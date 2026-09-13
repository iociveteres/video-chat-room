import { useState, type MouseEvent } from 'react';
import { checkEnvironment, type EnvironmentCheck } from './app/environment';
import { navigate, useRoute } from './app/router';

// Тексты по TDD §8. В задаче 10 экраны статусов переедут в StatusScreen,
// а заглушки лобби и комнаты заменят LobbyPage и RoomPage.
const ENVIRONMENT_MESSAGES: Record<Exclude<EnvironmentCheck, 'ok'>, string> = {
  'insecure-context':
    'Откройте приложение по HTTPS — иначе браузер не даст доступ к камере и микрофону',
  'webrtc-unsupported':
    'Ваш браузер не поддерживает видеозвонки (WebRTC). Используйте Chrome, Firefox или Edge версии 100+',
};

export function App() {
  // Окружение не меняется за время жизни вкладки — проверяем один раз.
  const [environment] = useState(checkEnvironment);

  if (environment !== 'ok') {
    return (
      <main className="screen" role="alert">
        <h1>Видеочат недоступен</h1>
        <p>{ENVIRONMENT_MESSAGES[environment]}</p>
      </main>
    );
  }

  return <Routes />;
}

function Routes() {
  const route = useRoute();

  switch (route.name) {
    case 'lobby':
      return (
        <main className="screen">
          <h1>Видеочат</h1>
        </main>
      );
    case 'room':
      return (
        <main className="screen">
          <h1>Комната {route.roomId}</h1>
        </main>
      );
    case 'invalid-link':
      return (
        <main className="screen" role="alert">
          <h1>Некорректная ссылка на комнату</h1>
          <a href="/" onClick={goHome}>
            На главную
          </a>
        </main>
      );
  }
}

function goHome(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  navigate('/');
}
