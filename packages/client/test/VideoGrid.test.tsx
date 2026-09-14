import type { MediaState, ParticipantDTO } from '@vcr/shared';
import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getGridLayout, VideoGrid } from '../src/features/call/VideoGrid';
import { RoomSession } from '../src/session/RoomSession';
import { AppStateProvider } from '../src/state/AppStateProvider';
import { fakeMedia, flushMicrotasks } from './helpers/FakeMedia';
import { fakePeers } from './helpers/FakePeerConnection';
import { FakeSocket } from './helpers/FakeSocket';

const ALL_ON: MediaState = { audio: true, video: true };
const person = (id: string, name: string, joinedAt: number): ParticipantDTO => ({
  id,
  name,
  joinedAt,
  media: ALL_ON,
});
const alex = person('p-alex', 'Алекс', 1_000);
const maria = person('p-maria', 'Мария', 2_000);
const boris = person('p-boris', 'Борис', 3_000);
const vera = person('p-vera', 'Вера', 4_000);

describe('getGridLayout', () => {
  it.each([
    [1, { cols: 1, rows: 1, lastRowCentered: false }],
    [2, { cols: 2, rows: 1, lastRowCentered: false }],
    [3, { cols: 2, rows: 2, lastRowCentered: true }],
    [4, { cols: 2, rows: 2, lastRowCentered: false }],
  ])('%i tiles → %j', (count, layout) => {
    expect(getGridLayout(count)).toEqual(layout);
  });

  it('clamps counts outside 1–4', () => {
    expect(getGridLayout(0)).toEqual(getGridLayout(1));
    expect(getGridLayout(5)).toEqual(getGridLayout(4));
  });
});

/** Я — Алекс; participants — снимок комнаты из ack в порядке входа. */
async function renderGrid(participants: ParticipantDTO[]) {
  const socket = new FakeSocket();
  let session: RoomSession | undefined;
  render(
    <AppStateProvider
      createSession={(dispatch) =>
        (session = new RoomSession({
          dispatch,
          createSocket: () => socket.asSocket(),
          createMedia: fakeMedia().createMedia,
          createPeers: fakePeers().createPeers,
        }))
      }
    >
      <VideoGrid />
    </AppStateProvider>,
  );

  await act(async () => {
    session!.join('room1', 'Алекс');
    await flushMicrotasks();
    socket.serverConnect();
    socket.lastEmitted('room:join').respond({ ok: true, self: alex, participants, messages: [] });
  });

  const grid = () => screen.getByRole('region', { name: 'Видео' });
  const labels = () =>
    within(grid())
      .getAllByRole('figure')
      .map((figure) => figure.getAttribute('aria-label'));
  const video = (name: string) => screen.getByRole('figure', { name }).querySelector('video')!;
  const server = (event: string, payload: unknown) =>
    act(async () => {
      socket.serverEmit(event, payload);
      await flushMicrotasks();
    });
  return { grid, labels, video, server };
}

describe('VideoGrid', () => {
  it('one participant: 1×1 with only the self tile', async () => {
    const t = await renderGrid([alex]);

    expect(t.labels()).toEqual(['Вы']);
    expect(t.grid()).toHaveAttribute('data-count', '1');
    expect(t.grid()).toHaveAttribute('data-last-row-centered', 'false');
    expect(t.grid().style.getPropertyValue('--cols')).toBe('1');
    expect(t.grid().style.getPropertyValue('--rows')).toBe('1');
  });

  it('self first, then remote participants in join order', async () => {
    const t = await renderGrid([alex, maria, boris]);

    expect(t.labels()).toEqual(['Вы', 'Мария', 'Борис']);
    expect(t.grid()).toHaveAttribute('data-count', '3');
    expect(t.grid()).toHaveAttribute('data-last-row-centered', 'true');
    expect(t.grid().style.getPropertyValue('--cols')).toBe('2');
    expect(t.grid().style.getPropertyValue('--rows')).toBe('2');
    // Self: подпись «Вы», зеркало и без звука; удалённые — наоборот.
    expect(t.grid().firstElementChild).toHaveClass('video-grid__cell--self');
    expect(t.video('Вы').muted).toBe(true);
    expect(t.video('Вы')).toHaveClass('tile__video--mirrored');
    expect(t.video('Мария').muted).toBe(false);
  });

  it('a newcomer is appended to the end without moving existing tiles', async () => {
    const t = await renderGrid([maria, alex]);
    const self = t.video('Вы');
    const mariaVideo = t.video('Мария');

    await t.server('participant:joined', { participant: vera });

    expect(t.labels()).toEqual(['Вы', 'Мария', 'Вера']);
    expect(t.video('Вы')).toBe(self);
    expect(t.video('Мария')).toBe(mariaVideo);
  });

  it('someone in the middle leaves → the remaining <video> nodes are the same elements', async () => {
    const t = await renderGrid([alex, maria, boris, vera]);
    expect(t.grid()).toHaveAttribute('data-count', '4');
    const before = { self: t.video('Вы'), maria: t.video('Мария'), vera: t.video('Вера') };

    await t.server('participant:left', { participantId: boris.id });

    expect(t.labels()).toEqual(['Вы', 'Мария', 'Вера']);
    expect(t.grid()).toHaveAttribute('data-count', '3');
    // E2E находит id участника по его плитке.
    expect(
      [...t.grid().querySelectorAll('[data-participant-id]')].map((cell) =>
        cell.getAttribute('data-participant-id'),
      ),
    ).toEqual([maria.id, vera.id]);
    expect(t.video('Вы')).toBe(before.self);
    expect(t.video('Мария')).toBe(before.maria);
    expect(t.video('Вера')).toBe(before.vera);
  });

  it('everyone else left → back to 1×1, self tile kept', async () => {
    const t = await renderGrid([alex, maria]);
    const self = t.video('Вы');

    await t.server('participant:left', { participantId: maria.id });

    expect(t.grid()).toHaveAttribute('data-count', '1');
    expect(t.video('Вы')).toBe(self);
  });
});
