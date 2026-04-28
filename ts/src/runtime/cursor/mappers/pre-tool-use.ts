import * as fs from 'node:fs';
import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
// Spec-driven Cursor-tool → activity_type table, declared via @activityRouting.
import { PRE_TOOL_USE_ROUTING } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { isSkipped } from '../../_shared/skip-patterns.js';

/**
 * preToolUse: Cursor 3.x's primary agent-action hook (dispatched per
 * agent tool call). Cursor's tool-name mapping (claude-code-types.ts):
 *   Bash → "Shell", Read → "Read", Write → "Write", Edit → "Write".
 *
 * Routing here picks the right activity_type:
 *   "Read"  → file_read (with on-disk content for PII scan)
 *   "Write" → file_write (covers Write + Edit)
 *   "Shell" → agent_action (or file_write if rm/unlink/rmdir detected)
 */
export async function handlePreToolUse(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;

  const fire = async (activityType: string, payload: Record<string, unknown>) => {
    const v = await session.activity(EVENT.START, activityType, { input: [payload] });
    if (v.arm === 'halt') markHalted(env.conversation_id, cfg);
    return v;
  };

  // Activity-type lookup is spec-driven; per-tool payload shape stays
  // here. PRE_TOOL_USE_ROUTING covers the main cases; we override Shell
  // to file_write when the command pattern matches `rm`/`unlink`/etc.
  // (no dedicated Delete tool in Cursor - file deletes go through Shell).
  const baseActivity = PRE_TOOL_USE_ROUTING[toolName];
  if (!baseActivity) return undefined;

  switch (toolName) {
    case 'Read': {
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (!filePath) return undefined;
      if (isSkipped(filePath)) return undefined;
      let content = '';
      try {
        if (fs.existsSync(filePath)) content = fs.readFileSync(filePath, 'utf-8');
      } catch { /* skip content; still govern the path */ }
      return fire(baseActivity, { file_path: filePath, content, event_category: 'file_read' });
    }

    case 'Write': {
      // Cursor sends "Write" for both Write and Edit tools.
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (filePath && isSkipped(filePath)) return undefined;
      return fire(baseActivity, {
        file_path: filePath,
        content: (toolInput.content ?? toolInput.new_string ?? '') as string,
        event_category: 'file_write',
      });
    }

    case 'Shell': {
      const command = (toolInput.command ?? '') as string;
      const cwd = (toolInput.cwd ?? env.cwd ?? '') as string;
      // Cursor's Shell tool covers file deletes (no dedicated Delete tool).
      // Detect rm/unlink/rmdir/shred and reroute to file_write so existing
      // file-write guardrails / policies match.
      const isDelete = /\b(rm|unlink|rmdir|shred)\b/.test(command);
      return fire(isDelete ? ACTIVITY_TYPES.FILE_WRITE : baseActivity, {
        command,
        cwd,
        event_category: isDelete ? 'file_delete' : 'agent_action',
      });
    }

    default:
      return undefined;
  }
}
