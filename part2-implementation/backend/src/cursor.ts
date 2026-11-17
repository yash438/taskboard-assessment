import { badInput, isUuid } from './validation';

// Position in the (created_at DESC, id DESC) order. createdAt stays the Postgres string with
// microseconds; a JS Date would round it and skip or repeat rows.
interface TaskCursor {
  createdAt: string;
  id: string;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/;

// Opaque to clients.
export function encodeCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

export function decodeCursor(raw: string): TaskCursor {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    // Rejected by the shape check below.
  }
  if (
    Array.isArray(parsed) &&
    parsed.length === 2 &&
    typeof parsed[0] === 'string' &&
    TIMESTAMP_RE.test(parsed[0]) &&
    typeof parsed[1] === 'string' &&
    isUuid(parsed[1])
  ) {
    return { createdAt: parsed[0], id: parsed[1] };
  }
  throw badInput('Invalid cursor');
}
