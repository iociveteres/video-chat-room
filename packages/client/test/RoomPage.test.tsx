import type { ChatMessage, ParticipantDTO } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { RoomPage } from '../src/features/room/RoomPage';
import { FakeSocket } from './helpers/FakeSocket';

const ROOM = 'q7Z3kP0aX_2m';
const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 2_000 };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 1_000 };
const boris: ParticipantDTO = { id: 'p-boris', name: 'Борис', joinedAt: 3_000 };

function renderRoom() {
  const sockets: FakeSocket[] = [];
  const createSession = (dispatch: ConstructorParameters<typeof RoomSession>[0]['dispatch']) =>
    new RoomSession({
      dispatch,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket.asSocket();
      },
    });

  render(
    <StrictMode>
      <AppStateProvider createSession={createSession}>
        <RoomPage roomId={ROOM} />
      </AppStateProvider>
    </StrictMode>,
  );

  const lastSocket = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket');
    return socket;
  };

  /** Сервер принимает подключение и отвечает на room:join (в act — это меняет state). */
  const serverAcceptsJoin = (response: unknown) =>
    act(() => {
      lastSocket().serverConnect();
      lastSocket().lastEmitted('room:join').respond(response);
    });

  return { sockets, lastSocket, serverAcceptsJoin, user: userEvent.setup() };
}

async function enterName(user: ReturnType<typeof userEvent.setup>, name = 'Алекс') {
  await user.type(screen.getByLabelText('Ваше имя'), name);
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

beforeEach(() => {
  window.history.replaceState(null, '', `/r/${ROOM}`);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('RoomPage', () => {
  it('asks for a name when opened by link and does not join before submit', () => {
    const t = renderRoom();

    expect(screen.getByRole('heading', { name: 'Вход в комнату' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled();
    expect(t.sockets).toHaveLength(0);
  });

  it('joins by link: name form → spinner → participant list with «(вы)»', async () => {
    const t = renderRoom();

    await enterName(t.user);

    expect(screen.getByRole('status')).toHaveTextContent('Подключаемся к комнате…');
    expect(t.sockets).toHaveLength(1);

    t.serverAcceptsJoin({ ok: true, self: alex, participants: [maria, alex], messages: [] });

    expect(t.lastSocket().lastEmitted('room:join').args).toEqual([{ roomId: ROOM, name: 'Алекс' }]);
    expect(screen.getByRole('heading', { name: `Комната ${ROOM}` })).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Мария', 'Алекс (вы)']);
  });

  it('updates the list in real time', async () => {
    const t = renderRoom();
    await enterName(t.user);
    t.serverAcceptsJoin({ ok: true, self: alex, participants: [maria, alex], messages: [] });

    act(() => t.lastSocket().serverEmit('participant:joined', { participant: boris }));
    act(() => t.lastSocket().serverEmit('participant:left', { participantId: maria.id }));

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Алекс (вы)', 'Борис']);
    expect(screen.getByRole('heading', { name: 'Участники (2/4)' })).toBeInTheDocument();
  });

  it('«Выйти» leaves the room and goes to the lobby', async () => {
    const t = renderRoom();
    await enterName(t.user);
    t.serverAcceptsJoin({ ok: true, self: alex, participants: [alex], messages: [] });

    await t.user.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(window.location.pathname).toBe('/');
    expect(t.lastSocket().lastEmitted('room:leave')).toBeDefined();
  });

  it('ROOM_FULL → «Комната заполнена»; «Повторить вход» joins again without asking the name', async () => {
    const t = renderRoom();
    await enterName(t.user);

    t.serverAcceptsJoin({ ok: false, error: { code: 'ROOM_FULL' } });
    expect(screen.getByRole('heading', { name: 'Комната заполнена' })).toBeInTheDocument();

    await t.user.click(screen.getByRole('button', { name: 'Повторить вход' }));
    expect(t.sockets).toHaveLength(2);

    t.serverAcceptsJoin({ ok: true, self: alex, participants: [alex], messages: [] });
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });

  it('SERVER_UNAVAILABLE → «Сервер недоступен»; «На главную» goes to the lobby', async () => {
    const t = renderRoom();
    await enterName(t.user);

    act(() => t.lastSocket().serverConnectError());
    expect(screen.getByRole('heading', { name: 'Сервер недоступен' })).toBeInTheDocument();

    await t.user.click(screen.getByRole('button', { name: 'На главную' }));
    expect(window.location.pathname).toBe('/');
  });

  it('connection loss → «Соединение с сервером прервано»; «Войти снова» reconnects', async () => {
    const t = renderRoom();
    await enterName(t.user);
    t.serverAcceptsJoin({ ok: true, self: alex, participants: [alex], messages: [] });

    act(() => t.lastSocket().serverDisconnect('transport close'));
    expect(
      screen.getByRole('heading', { name: 'Соединение с сервером прервано' }),
    ).toBeInTheDocument();

    await t.user.click(screen.getByRole('button', { name: 'Войти снова' }));
    expect(t.sockets).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Подключаемся к комнате…');
  });

  describe('chat', () => {
    const joinedAlex = {
      kind: 'system',
      id: 'm-1',
      ts: Date.UTC(2026, 8, 14, 6, 0),
      event: 'participant-joined',
      participantId: alex.id,
      participantName: alex.name,
    } satisfies ChatMessage;

    it('shows the chat next to the participants with the history from the ack', async () => {
      const t = renderRoom();
      await enterName(t.user);

      t.serverAcceptsJoin({ ok: true, self: alex, participants: [alex], messages: [joinedAlex] });

      const sidebar = screen.getByRole('complementary');
      expect(within(sidebar).getByRole('region', { name: /Участники/ })).toBeInTheDocument();
      const chat = within(sidebar).getByRole('region', { name: 'Чат' });
      expect(within(chat).getByRole('log')).toHaveTextContent('Алекс присоединился09:00');
      expect(within(chat).getByRole('textbox', { name: 'Сообщение' })).toBeInTheDocument();
    });

    it('sends a message with Enter and shows it after the broadcast', async () => {
      const t = renderRoom();
      await enterName(t.user);
      t.serverAcceptsJoin({ ok: true, self: alex, participants: [alex], messages: [] });

      await t.user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Привет{Enter}');

      const command = t.lastSocket().lastEmitted('chat:send');
      expect(command.args).toEqual([{ text: 'Привет' }]);
      const message = {
        kind: 'user',
        id: 'm-2',
        ts: Date.UTC(2026, 8, 14, 6, 5),
        authorId: alex.id,
        authorName: alex.name,
        text: 'Привет',
      } satisfies ChatMessage;
      await act(async () => {
        t.lastSocket().serverEmit('chat:message', { message });
        command.respond({ ok: true, messageId: message.id });
        await Promise.resolve();
      });

      const item = within(screen.getByRole('log')).getByRole('listitem');
      expect(item).toHaveTextContent('Алекс09:05Привет');
      expect(item).toHaveClass('message--own');
      expect(screen.getByRole('textbox', { name: 'Сообщение' })).toHaveValue('');
    });

    it('returns the text to the field when the server rate-limits it', async () => {
      const t = renderRoom();
      await enterName(t.user);
      t.serverAcceptsJoin({ ok: true, self: alex, participants: [alex], messages: [] });
      const field = screen.getByRole('textbox', { name: 'Сообщение' });

      await t.user.type(field, 'флуд{Enter}');
      await act(async () => {
        t.lastSocket()
          .lastEmitted('chat:send')
          .respond({ ok: false, error: { code: 'RATE_LIMITED' } });
        await Promise.resolve();
      });

      expect(field).toHaveValue('флуд');
    });
  });

  it('INVALID_NAME → back to the name form with a server hint', async () => {
    const t = renderRoom();
    await enterName(t.user);

    t.serverAcceptsJoin({ ok: false, error: { code: 'INVALID_NAME' } });

    expect(screen.getByLabelText('Ваше имя')).toHaveValue('Алекс');
    expect(screen.getByText('Сервер не принял это имя. Попробуйте другое.')).toBeInTheDocument();
  });
});
