import type { ChatMessage } from '@vcr/shared';
import { memo } from 'react';
import { formatSystemMessage } from './formatSystemMessage';
import { MessageTime } from './MessageTime';

export interface SystemMessageItemProps {
  message: Extract<ChatMessage, { kind: 'system' }>;
}

/** «**Имя** присоединился» / «**Имя** покинул комнату» — одинаково для себя и для других. */
export const SystemMessageItem = memo(function SystemMessageItem({
  message,
}: SystemMessageItemProps) {
  const { name, action } = formatSystemMessage(message);
  return (
    <li className="message message--system">
      <span className="message__system-text">
        {/* Имя подставляется текстовым узлом JSX, HTML-шаблонов нет. */}
        <strong>{name}</strong> {action}
      </span>
      <MessageTime ts={message.ts} />
    </li>
  );
});
