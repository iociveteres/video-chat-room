import { CHAT_HISTORY_LIMIT, type ChatMessage } from '@vcr/shared';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '../src/features/chat/MessageList';

function userMessage(n: number, overrides: Partial<ChatMessage & { kind: 'user' }> = {}) {
  return {
    kind: 'user',
    id: `m-${n}`,
    ts: Date.UTC(2026, 8, 14, 6, 5),
    authorId: 'p-maria',
    authorName: 'Мария',
    text: `#${n}`,
    ...overrides,
  } satisfies ChatMessage;
}

const joinedAlex = {
  kind: 'system',
  id: 'm-joined',
  ts: Date.UTC(2026, 8, 14, 6, 0),
  event: 'participant-joined',
  participantId: 'p-alex',
  participantName: 'Алекс',
} satisfies ChatMessage;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MessageList', () => {
  it('renders a log with user and system messages in order', () => {
    render(
      <MessageList messages={[joinedAlex, userMessage(1, { text: 'Привет' })]} selfId="p-alex" />,
    );

    const log = screen.getByRole('log', { name: 'Сообщения' });
    expect(log.tagName).toBe('OL');
    expect(log).toHaveAttribute('aria-live', 'polite');
    const items = within(log).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Алекс присоединился09:00',
      'Мария09:05Привет',
    ]);
  });

  it('shows the author name and local HH:MM time', () => {
    render(<MessageList messages={[userMessage(1)]} selfId={null} />);

    expect(screen.getByText('Мария')).toBeInTheDocument();
    const time = screen.getByText('09:05');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-09-14T06:05:00.000Z');
  });

  it('marks own messages by authorId, not by name', () => {
    render(
      <MessageList
        messages={[
          userMessage(1, { authorId: 'p-alex', authorName: 'Алекс' }),
          userMessage(2, { authorId: 'p-alex-2', authorName: 'Алекс' }),
        ]}
        selfId="p-alex"
      />,
    );

    const [own, other] = screen.getAllByRole('listitem');
    expect(own).toHaveClass('message--own');
    expect(other).not.toHaveClass('message--own');
  });

  it('renders markup in a message as plain text (XSS)', () => {
    const text = '<img src=x onerror="window.__xss = true">';
    const { container } = render(
      <MessageList messages={[userMessage(1, { text })]} selfId={null} />,
    );

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect((window as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it('renders markup in an author name as plain text', () => {
    const { container } = render(
      <MessageList messages={[userMessage(1, { authorName: '<b>x</b>' })]} selfId={null} />,
    );

    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('keeps line breaks as text inside the message', () => {
    render(<MessageList messages={[userMessage(1, { text: 'раз\nдва' })]} selfId={null} />);

    const paragraph = screen.getByText(/раз/);
    expect(paragraph).toHaveClass('message__text');
    expect(paragraph.textContent).toBe('раз\nдва');
  });

  describe('auto-scroll', () => {
    function mockScroll(scrollHeight: number) {
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
      return vi.spyOn(Element.prototype, 'scrollTop', 'set');
    }

    it('scrolls to the bottom on mount', () => {
      const setScrollTop = mockScroll(500);

      render(<MessageList messages={[userMessage(1)]} selfId={null} />);

      expect(setScrollTop).toHaveBeenLastCalledWith(500);
    });

    it('scrolls to the bottom when a new message arrives', () => {
      const setScrollTop = mockScroll(500);
      const { rerender } = render(<MessageList messages={[userMessage(1)]} selfId={null} />);
      setScrollTop.mockClear();
      vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(800);

      rerender(<MessageList messages={[userMessage(1), userMessage(2)]} selfId={null} />);

      expect(setScrollTop).toHaveBeenCalledTimes(1);
      expect(setScrollTop).toHaveBeenLastCalledWith(800);
    });

    it('scrolls when a full history shifts and the length stays the same', () => {
      const setScrollTop = mockScroll(500);
      const full = Array.from({ length: CHAT_HISTORY_LIMIT }, (_, i) => userMessage(i + 1));
      const { rerender } = render(<MessageList messages={full} selfId={null} />);
      setScrollTop.mockClear();

      rerender(
        <MessageList
          messages={[...full.slice(1), userMessage(CHAT_HISTORY_LIMIT + 1)]}
          selfId={null}
        />,
      );

      expect(setScrollTop).toHaveBeenCalledTimes(1);
    });

    it('does not scroll on a re-render without new messages', () => {
      const setScrollTop = mockScroll(500);
      const messages = [userMessage(1)];
      const { rerender } = render(<MessageList messages={messages} selfId={null} />);
      setScrollTop.mockClear();

      rerender(<MessageList messages={[...messages]} selfId="p-alex" />);

      expect(setScrollTop).not.toHaveBeenCalled();
    });
  });
});
