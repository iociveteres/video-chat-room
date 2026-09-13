import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/app/router';

describe('parseRoute', () => {
  it('parses / as the lobby', () => {
    expect(parseRoute('/')).toEqual({ name: 'lobby' });
  });

  it.each(['/r/abc', '/r/q7Z3kP0aX_2m', '/r/abc/'])('parses %s as a room', (pathname) => {
    expect(parseRoute(pathname)).toEqual({
      name: 'room',
      roomId: pathname.split('/')[2],
    });
  });

  it.each([
    '/r/',
    '/r',
    '/r/<script>',
    '/r/%3Cscript%3E',
    '/r/a.b',
    '/r/a/b',
    `/r/${'x'.repeat(65)}`,
    '/unknown',
    '',
  ])('parses %j as an invalid link', (pathname) => {
    expect(parseRoute(pathname)).toEqual({ name: 'invalid-link' });
  });
});
