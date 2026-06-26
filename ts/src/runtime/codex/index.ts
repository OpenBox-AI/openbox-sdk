// Public sub-path: `import { ... } from '@openbox-ai/openbox-sdk/runtime/codex'`

export {
  createCodexAdapter,
  type CodexEnvelope,
  type CodexAdapterConfig,
  type CodexAdapterHandlers,
} from '../../core-client/generated/runtime/codex.js';

export { runCodexHook } from './hook-handler.js';
export {
  installCodex,
  uninstallCodex,
  configureCodexRuntime,
  codexRuntimeConfigFile,
  verifyCodexInstall,
  type CodexInstallCheck,
  type CodexInstallCheckStatus,
  type CodexApprovalMode,
  type ConfigureCodexRuntimeOptions,
  type VerifyCodexInstallOptions,
} from './install.js';
export {
  codexMarketplaceFile,
  codexPluginTargetDir,
  codexRepoSkillTargetDir,
  exportCodexPlugin,
  installCodexPlugin,
  uninstallCodexPlugin,
  verifyCodexPlugin,
  type CodexPluginCheck,
  type CodexPluginCheckStatus,
  type ExportCodexPluginOptions,
  type InstallCodexPluginOptions,
  type UninstallCodexPluginOptions,
  type VerifyCodexPluginOptions,
} from './plugin.js';
export {
  CODEX_HOOK_MATRIX,
  codexGovernanceSummary,
  defaultCodexHookEvents,
  optInCodexHookEvents,
  type CodexGovernanceStatus,
  type CodexHookMatrixEntry,
} from './governance-matrix.js';

import { makeHookLog } from '../../logging/hook-log.js';

export const HOOK_LOG_PATH = makeHookLog('codex').path;
