import type { ChatMessage, SystemEvent } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import { formatSystemMessage } from '../src/features/chat/formatSystemMessage';

function systemMessage(event: SystemEvent, participantName: string) {
  return {
    kind: 'system',
    id: 'm-1',
    ts: 1_000,
    event,
    participantId: 'p-1',
    participantName,
  } satisfies ChatMessage;
}

describe('formatSystemMessage', () => {
  it('participant-joined → «присоединился»', () => {
    expect(formatSystemMessage(systemMessage('participant-joined', 'Алекс'))).toEqual({
      name: 'Алекс',
      action: 'присоединился',
    });
  });

  it('participant-left → «отключился»', () => {
    expect(formatSystemMessage(systemMessage('participant-left', 'Мария'))).toEqual({
      name: 'Мария',
      action: 'отключился',
    });
  });

  it('returns the name as is, without markup or escaping', () => {
    expect(formatSystemMessage(systemMessage('participant-joined', '<b>x</b>')).name).toBe(
      '<b>x</b>',
    );
  });
});
