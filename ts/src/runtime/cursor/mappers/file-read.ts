import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { isSkipped } from '../../_shared/skip-patterns.js';

/** beforeReadFile: scan file content for PII / banned terms before Cursor reads it. */
export async function handleBeforeReadFile(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const filePath = env.file_path ?? '';
  if (!filePath) return undefined;
  if (isSkipped(filePath)) return undefined;

  // Cursor includes file content in the hook envelope for beforeReadFile -
  // pull it via a permissive `as` since the spec envelope is the union.
  const content = ((env as unknown as { content?: string }).content) ?? '';

  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.FILE_READ, {
    input: [{
      file_path: filePath,
      content,
      generation_id: env.generation_id,
      event_category: 'file_read',
    }],
  });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
