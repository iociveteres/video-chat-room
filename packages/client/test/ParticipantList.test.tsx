import type { ParticipantDTO } from '@vcr/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParticipantList } from '../src/features/room/ParticipantList';

const participants: ParticipantDTO[] = [
  { id: 'p1', name: 'Мария', joinedAt: 1_000 },
  { id: 'p2', name: 'Алекс', joinedAt: 2_000 },
  { id: 'p3', name: 'Алекс', joinedAt: 3_000 },
];

describe('ParticipantList', () => {
  it('renders names in the given order with a counter', () => {
    render(<ParticipantList participants={participants} selfId={null} />);

    expect(screen.getByRole('heading', { name: 'Участники (3/4)' })).toBeInTheDocument();
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
      <ParticipantList participants={[{ id: 'evil', name, joinedAt: 1 }]} selfId={null} />,
    );

    expect(screen.getByText(name)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect((window as { __xss?: boolean }).__xss).toBeUndefined();
  });
});
