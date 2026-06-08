type InstallScope = 'project';
interface HookSpec {
    file: string;
    key: string;
    style: 'claude-array' | 'cursor-keyed';
    command: string;
    configDir: string;
    events: Array<{
        name: string;
        timeout?: number;
        /**
         * Cursor-only: regex string scoping when this hook fires.
         * Cursor skips invoking the hook command entirely if the
         * matcher does not hit, so a properly-scoped matcher cuts
         * process spawns by an order of magnitude for shell-heavy
         * sessions. Optional; absent means the hook fires on every
         * occurrence.
         *
         * Matcher semantics differ per Cursor event:
         *   beforeShellExecution → matched against the command string
         *   beforeReadFile / afterFileEdit → matched against file_path
         *   preToolUse → matched against tool_name
         */
        matcher?: string;
    }>;
}
interface InstallOptions {
    /** Scope of the install. Defaults to `project`; no global host install is supported. */
    scope?: InstallScope;
    /** Project root used for the install. Defaults to `process.cwd()`. */
    cwd?: string;
}
interface ResolvedPaths {
    scope: InstallScope;
    /** Path the hook block is written to. */
    hooksFile: string;
    /** Directory that holds the host's `config.json` template. */
    configDir: string;
    /** Path the MCP `mcpServers` map is written to. */
    mcpFile: string;
    /** Key under which MCP servers live in `mcpFile`. */
    mcpKey: 'mcpServers';
}
/** Compute concrete file paths for the given scope. Pure: a unit
 *  test can call this without touching disk. */
declare function resolveInstallPaths(spec: HookSpec, options?: InstallOptions): ResolvedPaths;
declare function installAdapter(spec: HookSpec, options?: InstallOptions): void;
declare function uninstallAdapter(spec: HookSpec, options?: InstallOptions): void;
interface McpServerEntry {
    command: string;
    args?: string[];
}
/**
 * Writes an MCP server entry into the host's configured location
 * for the chosen scope. Used by `openbox install <host>` so the
 * MCP server registration follows the same scope as the hooks.
 *
 * Returns the resolved path so the CLI can surface it.
 */
declare function installMcpEntry(spec: HookSpec, serverName: string, serverEntry: McpServerEntry, options?: InstallOptions): string;
/**
 * Removes an MCP server entry from the scope's mcpServers map.
 * Drops the surrounding map when it ends up empty.
 */
declare function uninstallMcpEntry(spec: HookSpec, serverName: string, options?: InstallOptions): string;

export { type HookSpec, type InstallOptions, type InstallScope, type McpServerEntry, installAdapter, installMcpEntry, resolveInstallPaths, uninstallAdapter, uninstallMcpEntry };
