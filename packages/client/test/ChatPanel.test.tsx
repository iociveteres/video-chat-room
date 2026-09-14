import type { ChatMessage, ParticipantDTO } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatPanel } from '../src/features/chat/ChatPanel';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, flushMicrotasks } from './helpers/FakeMedia';
import { FakeSocket } from './helpers/FakeSocket';

const alex: ParticipantDTO = {
  id: 'p-alex',
  name: 'Алекс',
  joinedAt: 1_000,
  media: { audio: false, video: false },
};

const joinedAlex = {
  kind: 'system',
  id: 'm-1',
  ts: Date.UTC(2026, 8, 14, 6, 0),
  event: 'participant-joined',
  participantId: alex.id,
  participantName: alex.name,
} satisfies ChatMessage;

const fromMaria = {
  kind: 'user',
  id: 'm-2',
  ts: Date.UTC(2026, 8, 14, 6, 5),
  authorId: 'p-maria',
  authorName: 'Мария',
  text: 'Привет, https://example.com/doc',
} satisfies ChatMessage;

function renderChat() {
  const socket = new FakeSocket();
  let session: RoomSession | undefined;
  render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({
          dispatch,
          createSocket: () => socket.asSocket(),
          createMedia: fakeMedia().createMedia,
        }))
      }
    >
      <ChatPanel />
    </AppStateProvider>,
  );

  const joinWith = (messages: ChatMessage[]) =>
    act(async () => {
      session!.join('room1', alex.name);
      await flushMicrotasks();
      socket.serverConnect();
      socket
        .lastEmitted('room:join')
        .respond({ ok: true, self: alex, participants: [alex], messages });
    });

  return { socket, joinWith };
}

describe('ChatPanel', () => {
  it('renders an empty log before joining', () => {
    renderChat();

    expect(within(screen.getByRole('log')).queryAllByRole('listitem')).toEqual([]);
  });

  it('shows the history from the join ack and new messages from the socket', async () => {
    const { socket, joinWith } = renderChat();

    await joinWith([joinedAlex]);
    expect(within(screen.getByRole('log')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Алекс').tagName).toBe('STRONG');

    act(() => socket.serverEmit('chat:message', { message: fromMaria }));

    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[1]!).getByText('Мария')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('link')).toHaveAttribute('href', 'https://example.com/doc');
  });

  it('marks own messages using selfId from state', async () => {
    const { socket, joinWith } = renderChat();
    await joinWith([]);

    act(() =>
      socket.serverEmit('chat:message', {
        message: { ...fromMaria, id: 'm-3', authorId: alex.id, authorName: alex.name },
      }),
    );

    expect(screen.getByRole('listitem')).toHaveClass('message--own');
  });
});
