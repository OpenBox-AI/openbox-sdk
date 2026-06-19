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
  verifyCodexInstall,
  type CodexInstallCheck,
  type CodexInstallCheckStatus,
  type VerifyCodexInstallOptions,
} from './install.js';

import { makeHookLog } from '../../logging/hook-log.js';

export const HOOK_LOG_PATH = makeHookLog('codex').path;
