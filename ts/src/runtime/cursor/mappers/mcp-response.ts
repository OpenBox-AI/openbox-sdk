import type { CursorSession } from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';

// Observe-only; same reasoning as observe.ts. Skip the backend
// round-trip on after* events to avoid phantom approval rows.
export async function handleAfterMCPExecution(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return undefined;
}
