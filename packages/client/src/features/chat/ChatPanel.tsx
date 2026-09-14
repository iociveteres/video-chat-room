import { useAppState, useRoomSession } from '../../state/AppStateProvider';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';

/** Боковая панель чата: лента сообщений и поле ввода. */
export function ChatPanel() {
  const { chat, selfId } = useAppState();
  const session = useRoomSession();

  return (
    <section className="chat" aria-labelledby="chat-title">
      <h2 id="chat-title">Чат</h2>
      <MessageList messages={chat.messages} selfId={selfId} />
      <MessageInput onSend={(text) => session.sendChatMessage(text)} />
    </section>
  );
}
