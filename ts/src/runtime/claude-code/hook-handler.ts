// Hook handler - invoked by `openbox claude-code hook` from Claude
// Code's hooks.json config. Reads stdin, dispatches via the spec-driven
// claude-hooks adapter, returns appropriate stdout per hook event,
// exits 0 (fail-open).
import { createClaudeHooksAdapter } from '../claude-hooks.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { loadConfig } from './config.js';
import { initLogger } from './logger.js';
import { resolveSession } from './session-resolver.js';
import { handlePreToolUse } from './mappers/pre-tool-use.js';
import { handlePostToolUse } from './mappers/post-tool-use.js';
import { handleUserPromptSubmit } from './mappers/user-prompt.js';
import { handlePermissionRequest } from './mappers/permission-request.js';
import {
  handleSessionStart,
  handleSessionEnd,
  handleStop,
} from './mappers/session.js';
import { handleSubagentStart, handleSubagentStop } from './mappers/subagent.js';

export async function runClaudeHook(): Promise<void> {
  const cfg = loadConfig();
  initLogger(cfg);

  // Pass-through if not configured. The adapter would still be willing to
  // run but with no API key the core client can't call /evaluate; better to
  // exit cleanly than emit confusing errors.
  if (!cfg.openboxApiKey) {
    if (cfg.verbose) console.error('[openbox claude-code] no OPENBOX_API_KEY set, passing through');
    process.exit(0);
  }

  // Dry-run: handlers immediately return undefined (= allow / no decision).
  // The adapter still writes the right stdout shape per @verdictShape.
  const dryRun = cfg.dryRun;

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    timeoutMs: cfg.governanceTimeout * 1000,
  });

  await createClaudeHooksAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    handlers: {
      preToolUse:        (env, s) => dryRun ? undefined : handlePreToolUse(env, s, cfg),
      postToolUse:       (env, s) => dryRun ? undefined : handlePostToolUse(env, s, cfg),
      userPromptSubmit:  (env, s) => dryRun ? undefined : handleUserPromptSubmit(env, s, cfg),
      permissionRequest: (env, s) => dryRun ? undefined : handlePermissionRequest(env, s, cfg),
      sessionStart:      (env, s) => dryRun ? undefined : handleSessionStart(env, s, cfg),
      sessionEnd:        (env, s) => dryRun ? undefined : handleSessionEnd(env, s, cfg),
      stop:              (env, s) => dryRun ? undefined : handleStop(env, s, cfg),
      subagentStart:     (env, s) => dryRun ? undefined : handleSubagentStart(env, s, cfg),
      subagentStop:      (env, s) => dryRun ? undefined : handleSubagentStop(env, s, cfg),
    },
  }).run();
}
