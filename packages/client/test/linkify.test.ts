import { describe, expect, it } from 'vitest';
import { linkify, type TextSegment } from '../src/features/chat/linkify';

const text = (value: string): TextSegment => ({ kind: 'text', value });
const link = (value: string, href = value): TextSegment => ({ kind: 'link', value, href });

describe('linkify', () => {
  it('returns no segments for an empty string', () => {
    expect(linkify('')).toEqual([]);
  });

  it('returns a single text segment when there are no links', () => {
    expect(linkify('Привет, как дела?')).toEqual([text('Привет, как дела?')]);
  });

  it.each(['https://a.b/c', 'http://example.com/', 'https://example.com:8443/a?b=1#c'])(
    'turns %s into a link',
    (url) => {
      expect(linkify(url)).toEqual([link(url)]);
    },
  );

  it('keeps the surrounding text', () => {
    expect(linkify('Ссылка на доку: https://example.com/spec — смотри')).toEqual([
      text('Ссылка на доку: '),
      link('https://example.com/spec'),
      text(' — смотри'),
    ]);
  });

  it('normalizes href but keeps the original text', () => {
    expect(linkify('HTTPS://Example.COM')).toEqual([
      link('HTTPS://Example.COM', 'https://example.com/'),
    ]);
    expect(linkify('https://example.com/a b')).toEqual([
      link('https://example.com/a', 'https://example.com/a'),
      text(' b'),
    ]);
  });

  describe('trailing punctuation', () => {
    it.each(['.', ',', '!', '?', ';', ':', '»', '"', "'", ')', '...', '?!', ').'])(
      'cuts %j off the end of the link',
      (tail) => {
        expect(linkify(`https://example.com/doc${tail}`)).toEqual([
          link('https://example.com/doc'),
          text(tail),
        ]);
      },
    );

    it('handles a sentence ending with a link', () => {
      expect(linkify('см. https://example.com/doc.')).toEqual([
        text('см. '),
        link('https://example.com/doc'),
        text('.'),
      ]);
    });

    it('keeps punctuation inside the link', () => {
      expect(linkify('https://example.com/a.b,c!d?e=1')).toEqual([
        link('https://example.com/a.b,c!d?e=1'),
      ]);
    });

    it('handles «quoted» links', () => {
      expect(linkify('«https://example.com/x»')).toEqual([
        text('«'),
        link('https://example.com/x'),
        text('»'),
      ]);
    });
  });

  describe('brackets', () => {
    it('keeps a balanced bracket inside the link', () => {
      expect(linkify('http://x.y/(z)')).toEqual([link('http://x.y/(z)')]);
    });

    it('cuts an unbalanced closing bracket around the link', () => {
      expect(linkify('(см. https://example.com/doc)')).toEqual([
        text('(см. '),
        link('https://example.com/doc'),
        text(')'),
      ]);
    });

    it('keeps the inner pair and cuts the outer bracket', () => {
      const wiki = 'https://ru.wikipedia.org/wiki/Mesh_(топология)';
      expect(linkify(`(см. ${wiki})`)).toEqual([
        text('(см. '),
        link(
          wiki,
          'https://ru.wikipedia.org/wiki/Mesh_(%D1%82%D0%BE%D0%BF%D0%BE%D0%BB%D0%BE%D0%B3%D0%B8%D1%8F)',
        ),
        text(')'),
      ]);
    });

    it.each([
      ['[https://a.b/c]', '[', ']'],
      ['{https://a.b/c}', '{', '}'],
    ])('cuts unbalanced %s', (input, open, close) => {
      expect(linkify(input)).toEqual([text(open), link('https://a.b/c'), text(close)]);
    });
  });

  describe('unsafe or unsupported links stay text', () => {
    it.each([
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/file',
      'www.example.com',
      'example.com',
      'mailto:a@b.c',
      'xhttps://example.com',
    ])('%s', (input) => {
      expect(linkify(input)).toEqual([text(input)]);
    });

    it.each(['https://', 'http://.', 'https://[::1', 'http://exa%mple.com'])(
      'an invalid URL %s',
      (input) => {
        expect(linkify(input)).toEqual([text(input)]);
      },
    );

    it('keeps an invalid candidate as text between valid links', () => {
      expect(linkify('https://a.b https://[x https://c.d')).toEqual([
        link('https://a.b', 'https://a.b/'),
        text(' https://[x '),
        link('https://c.d', 'https://c.d/'),
      ]);
    });
  });

  it('finds several links in a row', () => {
    expect(linkify('https://a.b/1, https://a.b/2\nhttp://a.b/3')).toEqual([
      link('https://a.b/1'),
      text(', '),
      link('https://a.b/2'),
      text('\n'),
      link('http://a.b/3'),
    ]);
  });

  it('stops the link at HTML-like characters', () => {
    expect(linkify('<a href="https://evil.com/">x</a>')).toEqual([
      text('<a href="'),
      link('https://evil.com/'),
      text('">x</a>'),
    ]);
  });

  it('converts an IDN host to punycode in href', () => {
    const [segment] = linkify('https://пример.рф/путь');
    expect(segment).toEqual({
      kind: 'link',
      value: 'https://пример.рф/путь',
      href: 'https://xn--e1afmkfd.xn--p1ai/%D0%BF%D1%83%D1%82%D1%8C',
    });
  });

  it('concatenated segments reproduce the original text', () => {
    const input = 'a (https://x.y/(z)). b https://[bad c «https://пример.рф»!';
    expect(
      linkify(input)
        .map((s) => s.value)
        .join(''),
    ).toBe(input);
  });
});
