import type { ChatMessage } from '@vcr/shared';
import { SystemMessageItem } from './SystemMessageItem';
import { UserMessageItem } from './UserMessageItem';
import { useStickToBottom } from './useStickToBottom';

export interface MessageListProps {
  /** От старых к новым. */
  messages: ChatMessage[];
  selfId: string | null;
  /**
   * Лента видна. В скрытой вкладке прокрутка бессмысленна (scrollHeight = 0), поэтому она
   * откладывается до открытия: смена null → id последнего сообщения прокручивает вниз.
   */
  active?: boolean;
}

export function MessageList({ messages, selfId, active = true }: MessageListProps) {
  const listRef = useStickToBottom<HTMLOListElement>(active ? messages.at(-1)?.id : null);

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
