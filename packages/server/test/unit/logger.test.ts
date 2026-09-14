import { describe, expect, it } from 'vitest';
import { createLogger, type LogSink } from '../../src/logger';

function captureLogger(level: Parameters<typeof createLogger>[0]) {
  const lines: { level: string; line: string }[] = [];
  const sink: LogSink = (lvl, line) => lines.push({ level: lvl, line });
  return { logger: createLogger(level, sink), lines };
}

describe('createLogger', () => {
  it('drops messages below the configured level', () => {
    const { logger, lines } = captureLogger('warn');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('writes nothing when silent', () => {
    const { logger, lines } = captureLogger('silent');
    logger.error('e');
    expect(lines).toEqual([]);
  });

  it('formats timestamp, level, message and fields', () => {
    const { logger, lines } = captureLogger('debug');

    logger.info('Participant joined', { roomId: 'r1', participantId: 'p1' });

    expect(lines[0]?.line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\S+Z INFO Participant joined {"roomId":"r1","participantId":"p1"}$/,
    );
  });

  it('serializes errors with their stack', () => {
    const { logger, lines } = captureLogger('debug');

    logger.error('Boom', { err: new Error('kaput') });

    expect(lines[0]?.line).toContain('Error: kaput');
  });
});
