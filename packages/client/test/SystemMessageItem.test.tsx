import type { ChatMessage, SystemEvent } from '@vcr/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemMessageItem } from '../src/features/chat/SystemMessageItem';

function systemMessage(event: SystemEvent, participantName: string) {
  return {
    kind: 'system',
    id: 'm-1',
    ts: Date.UTC(2026, 8, 14, 6, 5),
    event,
    participantId: 'p-1',
    participantName,
  } satisfies ChatMessage;
}

function renderItem(event: SystemEvent, name: string) {
  return render(
    <ol>
      <SystemMessageItem message={systemMessage(event, name)} />
    </ol>,
  );
}

describe('SystemMessageItem', () => {
  it.each<[SystemEvent, string]>([
    ['participant-joined', 'Алекс присоединился'],
    ['participant-left', 'Алекс отключился'],
  ])('%s → «%s» with the name in <strong>', (event, expected) => {
    renderItem(event, 'Алекс');

    const item = screen.getByRole('listitem');
    expect(item).toHaveClass('message--system');
    expect(item.querySelector('.message__system-text')?.textContent).toBe(expected);
    expect(screen.getByText('Алекс').tagName).toBe('STRONG');
    expect(screen.getByText('09:05').tagName).toBe('TIME');
  });

  it('renders markup in the name as plain text', () => {
    const { container } = renderItem('participant-joined', '<b>x</b>');

    expect(screen.getByText('<b>x</b>').tagName).toBe('STRONG');
    expect(container.querySelector('b')).toBeNull();
  });
});
