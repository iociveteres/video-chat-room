import type { ChatMessage, ParticipantDTO } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomSidebar } from '../src/features/room/RoomSidebar';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { FakeSocket } from './helpers/FakeSocket';

const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 1_000 };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 2_000 };

const fromMaria = {
  kind: 'user',
  id: 'm-1',
  ts: Date.UTC(2026, 8, 14, 6, 5),
  authorId: maria.id,
  authorName: maria.name,
  text: 'Привет',
} satisfies ChatMessage;

function renderSidebar() {
  const socket = new FakeSocket();
  let session: RoomSession | undefined;
  render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({ dispatch, createSocket: () => socket.asSocket() }))
      }
    >
      <RoomSidebar />
    </AppStateProvider>,
  );
  act(() => {
    session!.join('room1', alex.name);
    socket.serverConnect();
    socket
      .lastEmitted('room:join')
      .respond({ ok: true, self: alex, participants: [maria, alex], messages: [] });
  });

  const tab = (name: string | RegExp) => screen.getByRole('tab', { name });
  return { socket, tab, user: userEvent.setup() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoomSidebar', () => {
  it('renders «Чат» and «Участники (n/4)» tabs with the chat open by default', () => {
    const { tab } = renderSidebar();

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Чат',
      'Участники (2/4)',
    ]);
    expect(tab('Чат')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Чат')).toHaveAttribute('tabindex', '0');
    expect(tab(/Участники/)).toHaveAttribute('aria-selected', 'false');
    expect(tab(/Участники/)).toHaveAttribute('tabindex', '-1');

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAccessibleName('Чат');
    expect(tab('Чат')).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByRole('log')).toBeInTheDocument();
  });

  it('switches to the participants tab on click and back', async () => {
    const { tab, user } = renderSidebar();

    await user.click(tab(/Участники/));

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAccessibleName('Участники (2/4)');
    expect(
      within(panel)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Мария', 'Алекс (вы)']);
    expect(screen.queryByRole('log')).toBeNull();

    await user.click(tab('Чат'));
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('updates the participant counter in the tab label while the chat is open', () => {
    const { socket, tab } = renderSidebar();

    act(() => socket.serverEmit('participant:left', { participantId: maria.id }));

    expect(tab('Участники (1/4)')).toBeInTheDocument();
  });

  it('keeps the message draft when switching tabs', async () => {
    const { tab, user } = renderSidebar();
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'черновик');

    await user.click(tab(/Участники/));
    await user.click(tab('Чат'));

    expect(screen.getByRole('textbox', { name: 'Сообщение' })).toHaveValue('черновик');
  });

  it.each([
    ['{ArrowRight}', /Участники/],
    ['{ArrowLeft}', /Участники/],
    ['{End}', /Участники/],
  ])('%s moves focus and selection', async (key, expected) => {
    const { tab, user } = renderSidebar();
    await user.click(tab('Чат'));

    await user.keyboard(key);

    expect(tab(expected)).toHaveFocus();
    expect(tab(expected)).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(tab('Чат')).toHaveFocus();
    expect(tab('Чат')).toHaveAttribute('aria-selected', 'true');
  });

  it('scrolls the chat to the bottom when it is opened after messages arrived in the background', async () => {
    const { socket, tab, user } = renderSidebar();
    await user.click(tab(/Участники/));
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(700);
    const setScrollTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');

    act(() => socket.serverEmit('chat:message', { message: fromMaria }));
    expect(setScrollTop).not.toHaveBeenCalled();

    await user.click(tab('Чат'));

    expect(setScrollTop).toHaveBeenLastCalledWith(700);
  });
});
