import type { AckError, ServerErrorCode } from '@vcr/shared';

export function ackError(code: ServerErrorCode): AckError {
  return { ok: false, error: { code } };
}
