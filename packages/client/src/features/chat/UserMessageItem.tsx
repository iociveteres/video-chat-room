import type { ChatMessage } from '@vcr/shared';
import { memo } from 'react';
import { MessageText } from './MessageText';
import { MessageTime } from './MessageTime';

export interface UserMessageItemProps {
  message: Extract<ChatMessage, { kind: 'user' }>;
  /** Своё сообщение: определяется по authorId, имена могут совпадать. */
  own: boolean;
}

export const UserMessageItem = memo(function UserMessageItem({
  message,
  own,
}: UserMessageItemProps) {
  return (
    <li className={own ? 'message message--user message--own' : 'message message--user'}>
      <div className="message__meta">
        {/* Имя — текстовый узел React (FR-39). */}
        <span className="message__author">{message.authorName}</span>
        <MessageTime ts={message.ts} />
      </div>
      <p className="message__text">
        <MessageText text={message.text} />
      </p>
    </li>
  );
});
