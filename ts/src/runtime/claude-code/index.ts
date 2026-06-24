// Public sub-path: `import { ... } from '@openbox-ai/openbox-sdk/runtime/claude-code'`
//
// Two surfaces in this folder:
//
//  1. Adapter primitive (spec-emitted); `createClaudeCodeAdapter`,
//     plus its config + handlers + envelope types. Generic transport:
//     stdin JSON → dispatch by hook_event_name → verdict-mapped stdout.
//     Use this if you're building your own Claude Code integration on
//     top of the OpenBox SDK.
//
//  2. Platform integration; the OpenBox SDK's own pre-built integration
//     for Claude Code. Used by `openbox claude-code hook` and
//     `openbox claude-code plugin ...`. The
//     entry points (runHook, plugin install, plugin uninstall, doctor)
//     are exposed for contributors but the primary surface is the CLI.
//
// Most consumers want #1. #2 is here for parity with the standalone
// platform repo before it was merged in.

// ─── Adapter primitive (spec-emitted) ───────────────────────────────
export {
  createClaudeCodeAdapter,
  type ClaudeCodeEnvelope,
  type ClaudeCodeAdapterConfig,
  type ClaudeCodeAdapterHandlers,
} from '../../core-client/generated/runtime/claude-code.js';

// ─── Platform integration (called from the CLI) ─────────────────────
export { runClaudeHook } from './hook-handler.js';
export { installClaudeCode, uninstallClaudeCode } from './install.js';
export {
  claudeCodePluginTargetDir,
  claudeCodeRuntimeConfigDir,
  claudeCodeRuntimeConfigFile,
  claudeCodeSettingsLocalFile,
  configureClaudeCodeRuntime,
  exportClaudeCodePlugin,
  installClaudeCodePlugin,
  readClaudeCodeSettingsLocalEnv,
  uninstallClaudeCodePlugin,
  verifyClaudeCodePlugin,
  type ClaudeCodePluginCheck,
  type ClaudeCodePluginCheckStatus,
  type ClaudeCodePluginScope,
  type ClaudeCodeApprovalMode,
  type ConfigureClaudeCodeRuntimeOptions,
  type ExportClaudeCodePluginOptions,
  type InstallClaudeCodePluginOptions,
  type UninstallClaudeCodePluginOptions,
  type VerifyClaudeCodePluginOptions,
} from './plugin.js';
export {
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  claudeCodeGovernanceSummary,
  defaultClaudeCodeHookEvents,
  optInClaudeCodeHookEvents,
  type ClaudeCodeGovernanceStatus,
  type ClaudeCodeHookMatrixEntry,
  type ClaudeCodeSdkCapabilityMatrixEntry,
  type ClaudeCodeSurfaceMatrixEntry,
} from './governance-matrix.js';
export {
  claudeCodeRuntimeDiagnostics,
  summarizeClaudeCodeChecks,
  verifyClaudeCodeInstall,
  type ClaudeCodeInstallCheck,
  type ClaudeCodeInstallCheckStatus,
  type VerifyClaudeCodeInstallOptions,
} from './doctor.js';

import { makeHookLog } from '../../logging/hook-log.js';
/** Path of the JSONL log written by the claude-code hook subprocess.
 *  Mirrors cursor's HOOK_LOG_PATH so the extension can tail both. */
export const HOOK_LOG_PATH = makeHookLog('claude-code').path;
