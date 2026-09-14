import { useAppState } from '../../state/AppStateProvider';
import { MessageList } from './MessageList';

/** Боковая панель чата: лента сообщений и поле ввода. */
export function ChatPanel() {
  const { chat, selfId } = useAppState();

  return (
    <section className="chat" aria-labelledby="chat-title">
      <h2 id="chat-title">Чат</h2>
      <MessageList messages={chat.messages} selfId={selfId} />
      {/* Здесь будет MessageInput. */}
    </section>
  );
}
