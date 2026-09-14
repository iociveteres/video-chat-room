export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Закрытый набор полей лога. Имена участников, тексты сообщений и другие PII сюда
 * не попадают (TDD §10): идентифицируем только по roomId, participantId и messageId.
 */
export interface LogFields {
  roomId?: string;
  participantId?: string;
  messageId?: string;
  /** Длина сообщения в code points — вместо самого текста. */
  length?: number;
  /** Тип сигнала WebRTC (offer / answer / candidate) — вместо SDP и кандидатов. */
  signalType?: string;
  socketId?: string;
  reason?: string;
  path?: string;
  err?: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

type WritableLevel = Exclude<LogLevel, 'silent'>;
export type LogSink = (level: WritableLevel, line: string) => void;

const consoleSink: LogSink = (level, line) => {
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
};

function serializeFields({ err, ...rest }: LogFields): string {
  const payload: Record<string, unknown> = { ...rest };
  if (err !== undefined) payload.err = err instanceof Error ? (err.stack ?? err.message) : err;
  return Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : '';
}

export function createLogger(level: LogLevel, sink: LogSink = consoleSink): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  const log =
    (messageLevel: WritableLevel) =>
    (message: string, fields: LogFields = {}): void => {
      if (LOG_LEVELS.indexOf(messageLevel) < threshold) return;
      const time = new Date().toISOString();
      sink(
        messageLevel,
        `${time} ${messageLevel.toUpperCase()} ${message}${serializeFields(fields)}`,
      );
    };

  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}
