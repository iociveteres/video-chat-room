import type { ChatMessage } from '@vcr/shared';
import { SystemMessageItem } from './SystemMessageItem';
import { UserMessageItem } from './UserMessageItem';
import { useStickToBottom } from './useStickToBottom';

export interface MessageListProps {
  /** От старых к новым. */
  messages: ChatMessage[];
  selfId: string | null;
}

export function MessageList({ messages, selfId }: MessageListProps) {
  const listRef = useStickToBottom<HTMLOListElement>(messages.at(-1)?.id);

  return (
    <ol ref={listRef} className="message-list" role="log" aria-live="polite" aria-label="Сообщения">
      {messages.map((message) =>
        message.kind === 'user' ? (
          <UserMessageItem
            key={message.id}
            message={message}
            own={selfId !== null && message.authorId === selfId}
          />
        ) : (
          <SystemMessageItem key={message.id} message={message} />
        ),
      )}
    </ol>
  );
}
