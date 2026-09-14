import type { ParticipantDTO } from '@vcr/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParticipantList } from '../src/features/room/ParticipantList';

const participants: ParticipantDTO[] = [
  { id: 'p1', name: 'Мария', joinedAt: 1_000, media: { audio: false, video: false } },
  { id: 'p2', name: 'Алекс', joinedAt: 2_000, media: { audio: false, video: false } },
  { id: 'p3', name: 'Алекс', joinedAt: 3_000, media: { audio: false, video: false } },
];

describe('ParticipantList', () => {
  it('renders names in the given order', () => {
    render(<ParticipantList participants={participants} selfId={null} />);

    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Мария', 'Алекс', 'Алекс']);
  });

  it('marks only the own participant with «(вы)», even with duplicate names', () => {
    render(<ParticipantList participants={participants} selfId="p3" />);

    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Мария', 'Алекс', 'Алекс (вы)']);
  });

  it('renders markup in a name as plain text (XSS)', () => {
    const name = '<img src=x onerror="window.__xss = true">';
    const { container } = render(
      <ParticipantList
        participants={[{ id: 'evil', name, joinedAt: 1, media: { audio: false, video: false } }]}
        selfId={null}
      />,
    );

    expect(screen.getByText(name)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect((window as { __xss?: boolean }).__xss).toBeUndefined();
  });

  describe('media icons', () => {
    const icons = (item: HTMLElement) =>
      within(item)
        .queryAllByRole('img')
        .map((icon) => icon.getAttribute('aria-label'));

    it('shows crossed-out microphone and camera by the server state of others', () => {
      render(
        <ParticipantList
          participants={[
            { id: 'a', name: 'Все вкл', joinedAt: 1, media: { audio: true, video: true } },
            { id: 'b', name: 'Без звука', joinedAt: 2, media: { audio: false, video: true } },
            { id: 'c', name: 'Без видео', joinedAt: 3, media: { audio: true, video: false } },
            { id: 'd', name: 'Всё выкл', joinedAt: 4, media: { audio: false, video: false } },
          ]}
          selfId={null}
        />,
      );

      expect(screen.getAllByRole('listitem').map(icons)).toEqual([
        [],
        ['Микрофон выключен'],
        ['Камера выключена'],
        ['Микрофон выключен', 'Камера выключена'],
      ]);
    });

    it('uses selfMedia instead of the server copy for self', () => {
      render(
        <ParticipantList
          participants={[
            { id: 'me', name: 'Я', joinedAt: 1, media: { audio: true, video: true } },
            { id: 'other', name: 'Он', joinedAt: 2, media: { audio: true, video: true } },
          ]}
          selfId="me"
          selfMedia={{ audio: false, video: true }}
        />,
      );

      const [self, other] = screen.getAllByRole('listitem');
      expect(icons(self!)).toEqual(['Микрофон выключен']);
      expect(icons(other!)).toEqual([]);
    });
  });
});
