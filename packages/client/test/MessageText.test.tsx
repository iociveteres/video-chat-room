import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageText } from '../src/features/chat/MessageText';

function renderText(text: string) {
  return render(
    <p data-testid="text">
      <MessageText text={text} />
    </p>,
  );
}

describe('MessageText', () => {
  it('renders plain text as a text node', () => {
    renderText('Привет');
    expect(screen.getByTestId('text')).toHaveTextContent('Привет');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders an http(s) link with safe attributes', () => {
    renderText('см. https://example.com/doc.');

    const link = screen.getByRole('link', { name: 'https://example.com/doc' });
    expect(link).toHaveAttribute('href', 'https://example.com/doc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveAttribute('title', 'https://example.com/doc');
    expect(screen.getByTestId('text').textContent).toBe('см. https://example.com/doc.');
  });

  it('shows the punycode href in the title of an IDN link', () => {
    renderText('https://пример.рф/');

    const link = screen.getByRole('link', { name: 'https://пример.рф/' });
    expect(link).toHaveAttribute('title', 'https://xn--e1afmkfd.xn--p1ai/');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'www.example.com'])(
    'does not create a link for %s',
    (text) => {
      const { container } = renderText(text);

      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('a[href^="javascript"]')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByTestId('text').textContent).toBe(text);
    },
  );

  it('keeps markup around a link as text', () => {
    const text = '<a href="javascript:alert(1)">https://example.com/</a>';
    const { container } = renderText(text);

    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com/');
    expect(screen.getByTestId('text').textContent).toBe(text);
  });
});
