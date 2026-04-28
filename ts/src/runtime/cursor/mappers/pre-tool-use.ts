import * as fs from 'node:fs';
import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorHookEnvelope } from '../../../core-client/generated/runtime/cursor-hooks.js';
import type { CursorHooksConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

const SKIP_PATTERNS = [
  /\.cursor\//,
  /\.claude\//,
  /\/mcps\//,
  /\/node_modules\//,
  /\.git\//,
  /INSTRUCTIONS\.md$/,
  /SERVER_METADATA\.json$/,
  /SKILL\.md$/,
  /\.env(\..*)?$/,
  /\.aws\//,
  /\.ssh\//,
  /\.kube\//,
  /\.gnupg\//,
];

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
  env: CursorHookEnvelope,
  session: CursorSession,
  cfg: CursorHooksConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;

  const fire = async (activityType: string, payload: Record<string, unknown>) => {
    const v = await session.activity(EVENT.START, activityType, { input: [payload] });
    if (v.arm === 'halt') markHalted(env.conversation_id, cfg);
    return v;
  };

  switch (toolName) {
    case 'Read': {
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (!filePath) return undefined;
      if (SKIP_PATTERNS.some((p) => p.test(filePath))) return undefined;
      let content = '';
      try {
        if (fs.existsSync(filePath)) content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        /* skip content; still govern the path */
      }
      return fire(ACTIVITY_TYPES.FILE_READ, {
        file_path: filePath,
        content,
        event_category: 'file_read',
      });
    }

    case 'Write': {
      // Cursor sends "Write" for both Write and Edit tools.
      const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
      if (filePath && SKIP_PATTERNS.some((p) => p.test(filePath))) return undefined;
      return fire(ACTIVITY_TYPES.FILE_WRITE, {
        file_path: filePath,
        content: (toolInput.content ?? toolInput.new_string ?? '') as string,
        event_category: 'file_write',
      });
    }

    case 'Shell': {
      const command = (toolInput.command ?? '') as string;
      const cwd = (toolInput.cwd ?? env.cwd ?? '') as string;
      // Cursor has no dedicated Delete tool - detect file-destructive commands
      // here and route them as file_write so file-write guardrails / policies match.
      const isDelete = /\b(rm|unlink|rmdir|shred)\b/.test(command);
      const activityType = isDelete ? ACTIVITY_TYPES.FILE_WRITE : ACTIVITY_TYPES.AGENT_ACTION;
      return fire(activityType, {
        command,
        cwd,
        event_category: isDelete ? 'file_delete' : 'agent_action',
      });
    }

    default:
      // Unknown tool - allow by default; afterAgentResponse can still observe.
      return undefined;
  }
}
