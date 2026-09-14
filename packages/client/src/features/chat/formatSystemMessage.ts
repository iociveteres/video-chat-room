import type { ChatMessage, SystemEvent } from '@vcr/shared';

export type SystemMessageAction = 'присоединился' | 'отключился';

export interface FormattedSystemMessage {
  name: string;
  action: SystemMessageAction;
}

// Одна форма для себя и для других, без согласования рода (TDD v2 §4.3.1).
// «отключился» не называет причину: выход и обрыв сервер не различает (FR-31).
const ACTIONS: Record<SystemEvent, SystemMessageAction> = {
  'participant-joined': 'присоединился',
  'participant-left': 'отключился',
};

/** Части текста системного сообщения; разметку («<strong>Имя</strong> действие») строит компонент. */
export function formatSystemMessage(
  message: Extract<ChatMessage, { kind: 'system' }>,
): FormattedSystemMessage {
  return { name: message.participantName, action: ACTIONS[message.event] };
}
