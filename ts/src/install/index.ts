// Public sub-path: `openbox-sdk/install`.
//
// Generic installer that consumes a host's spec-emitted
// `HOOK_SPEC` (file path, JSON key, style, command, config
// directory, and event list) and writes the appropriate
// `hooks.json` or `settings.json` block.

export {
  installAdapter,
  uninstallAdapter,
  installMcpEntry,
  uninstallMcpEntry,
  resolveInstallPaths,
  type HookSpec,
  type InstallOptions,
  type InstallScope,
  type McpServerEntry,
} from './from-spec.js';
