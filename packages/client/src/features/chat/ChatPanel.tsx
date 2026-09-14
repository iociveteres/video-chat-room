import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';

export interface ChatPanelProps {
  /** Вкладка чата видна; скрытая лента не прокручивается, при открытии — прокрутка вниз. */
  active?: boolean;
}

/** Содержимое вкладки «Чат»: лента сообщений и поле ввода. */
export function ChatPanel({ active = true }: ChatPanelProps) {
  const { chat, selfId } = useAppState();
  const session = useRoomSession();

  return (
    <div className="chat">
      <MessageList messages={chat.messages} selfId={selfId} active={active} />
      <MessageInput onSend={(text) => session.sendChatMessage(text)} />
    </div>
  );
}
