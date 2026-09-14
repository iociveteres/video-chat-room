import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LobbyPage } from '../src/features/lobby/LobbyPage';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, flushMicrotasks } from './helpers/FakeMedia';
import { FakeSocket } from './helpers/FakeSocket';

function renderLobby() {
  const sockets: FakeSocket[] = [];
  const media = fakeMedia();
  render(
    <StrictMode>
      <AppStateProvider
        createSession={(dispatch) =>
          new RoomSession({
            dispatch,
            createSocket: () => {
              const socket = new FakeSocket();
              sockets.push(socket);
              return socket.asSocket();
            },
            createMedia: media.createMedia,
          })
        }
      >
        <LobbyPage />
      </AppStateProvider>
    </StrictMode>,
  );
  return { sockets, media, user: userEvent.setup() };
}

describe('LobbyPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('creates a room: generates an id, joins once and navigates to /r/:roomId', async () => {
    const { sockets, media, user } = renderLobby();

    await user.type(screen.getByLabelText('Ваше имя'), 'Алекс');
    await user.click(screen.getByRole('button', { name: 'Создать комнату' }));
    await act(() => flushMicrotasks());

    expect(window.location.pathname).toMatch(/^\/r\/[A-Za-z0-9_-]{12}$/);
    // Даже в StrictMode — ровно один захват медиа, один сокет и одна попытка подключения.
    expect(media.devices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.connectCalls).toBe(1);

    const roomId = window.location.pathname.slice('/r/'.length);
    sockets[0]!.serverConnect();
    expect(sockets[0]!.lastEmitted('room:join').args).toEqual([
      { roomId, name: 'Алекс', media: { audio: true, video: true } },
    ]);
  });

  it('does not join before the user submits', () => {
    const { sockets } = renderLobby();
    expect(sockets).toHaveLength(0);
    expect(window.location.pathname).toBe('/');
  });
});
