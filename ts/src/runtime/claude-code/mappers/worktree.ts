import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import {
  buildWorktreeCreatePayload,
  type ClaudeCodeEnvelope,
} from '../../../core-client/generated/runtime/claude-code.js';
import { stampSource } from '../../../approvals/source.js';
import { stringFrom } from '../../../internal/strings.js';
import type { ClaudeCodeConfig } from '../config.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

type WorktreeEnvelopeRecord = Record<string, unknown> & {
  worktree_path?: string;
};

export async function handleWorktreeCreate(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict> {
  const record = env as unknown as WorktreeEnvelopeRecord;
  const requestedName =
    stringFrom(record.name) ?? stringFrom(record.worktree_name) ?? 'worktree';
  const baseCwd = stringFrom(record.cwd) ?? process.cwd();
  const root = cfg.worktreeRoot
    ? path.resolve(baseCwd, cfg.worktreeRoot)
    : path.join(baseCwd, '.openbox', 'worktrees');
  const worktreePath = path.join(
    root,
    `${sanitizePathSegment(requestedName)}-${Date.now().toString(36)}`,
  );

  record.worktree_path = worktreePath;
  try {
    const verdict = await session.activity(
      EVENT.START,
      ACTIVITY_TYPES.WORKSPACE_CHANGE,
      {
        input: [
          stampSource(buildWorktreeCreatePayload(env), 'claude-code'),
        ],
      },
    );
    if (verdict.arm !== 'allow' && verdict.arm !== 'constrain') {
      delete record.worktree_path;
      return verdict;
    }
    try {
      mkdirSync(worktreePath, { recursive: true });
    } catch (error) {
      delete record.worktree_path;
      throw error;
    }
    return verdict;
  } catch (error) {
    delete record.worktree_path;
    throw error;
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'worktree';
}
