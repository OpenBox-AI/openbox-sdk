import { O as OpenBoxCoreClient, r as ClaudeCodeSession, W as WorkflowVerdict } from '../../govern-DGn7jMgd.js';
import { a as ClaudeCodeEnvelope } from '../../envelopes-DnviQ3yd.js';
import { InstallOptions } from '../../install/index.js';
import '../../core-types-Dxgkbox0.js';

/**
 * Per-event handlers. Each handler receives the parsed stdin envelope
 * + an attached ClaudeCodeSession (workflowId/runId resolved by
 * `config.resolveSession`). Return a WorkflowVerdict; usually by calling
 * a preset method like `session.preToolUse(...)`. The adapter writes
 * the verdict-mapped stdout JSON automatically per the operation's
 * @verdictShape. Returning undefined writes the default `allow` shape.
 */
interface ClaudeCodeAdapterHandlers {
    preToolUse?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    postToolUse?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    postToolUseFailure?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    postToolBatch?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    userPromptSubmit?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    userPromptExpansion?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    permissionRequest?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    permissionDenied?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    setup?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    instructionsLoaded?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    preCompact?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    postCompact?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    sessionStart?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    sessionEnd?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    subagentStart?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    subagentStop?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    taskCreated?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    taskCompleted?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    stop?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    stopFailure?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    teammateIdle?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    notification?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    messageDisplay?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    configChange?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    cwdChanged?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    fileChanged?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    worktreeRemove?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    elicitation?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
    elicitationResult?: (input: ClaudeCodeEnvelope, session: ClaudeCodeSession) => Promise<WorkflowVerdict | undefined | void>;
}
interface ClaudeCodeAdapterConfig {
    /** Authenticated core client (agent-scoped API key). */
    core: OpenBoxCoreClient;
    /** Per-stdin-message resolver; typically reads sessionStore.json. */
    resolveSession: (env: ClaudeCodeEnvelope) => Promise<{
        workflowId: string;
        runId: string;
    }>;
    handlers: ClaudeCodeAdapterHandlers;
    /** Override stdin source (test injection). Default: process.stdin. */
    readStdin?: () => Promise<string>;
    /** Override stdout sink (test injection). Default: process.stdout.write. */
    writeStdout?: (data: string) => void;
    /** Override exit (test injection). Default: process.exit. */
    exit?: (code: number) => never;
    /**
     * Cap (ms) on how long the SDK polls a require_approval verdict
     * before giving up. The actual wait is min(this, server-side
     * approvalExpiresAt). Hook subprocesses have a finite lifetime
     * imposed by the host IDE; set this slightly under that ceiling so
     * the poll resolves before the host kills the process. Default: SDK
     * default (60s).
     */
    approvalMaxWaitMs?: number;
    /**
     * When true, the SDK skips the in-process poll loop on a
     * require_approval verdict and renders `permissionDecision: 'ask'`
     * (or the host equivalent), which makes the host's native
     * permission dialog pop inline. The local user becomes the
     * approver. External approval clients such as the dashboard, mobile
     * app, or editor extension can still resolve the backend row, but
     * the hook subprocess does not wait for them. Adapters wire this
     * from the `APPROVAL_MODE` config.
     */
    inlineApproval?: boolean;
    deferApproval?: boolean;
    /**
     * Fired the moment the backend returns require_approval; before
     * the SDK starts polling. Receives the approval metadata plus the
     * stdin envelope (so harness code can correlate on conversation_id /
     * hook_event_name / prompt). Used by the hook handler to write a
     * pending-approval marker for the OpenBox extension.
     */
    onPendingApproval?: (info: {
        approvalId: string;
        governanceEventId?: string;
        activityId: string;
        activityType: string;
        expiresAt?: string;
        reason?: string;
    }, env: ClaudeCodeEnvelope) => void | Promise<void>;
    /**
     * Fired when pollApproval resolves OR times out. Lets the harness
     * clear pending markers and any inline UI it staged.
     */
    onApprovalResolved?: (info: {
        approvalId: string;
        activityId: string;
        activityType: string;
        arm: string;
    }, env: ClaudeCodeEnvelope) => void | Promise<void>;
    /**
     * Optional out-of-band decision channel. When the harness has a
     * faster path than HTTP polling (e.g. a local IPC socket from a UI
     * extension that received an Approve / Deny click) it can return a
     * promise that resolves when that decision is in. The poll loop
     * races this promise against its normal HTTP cycle and runs a
     * confirmatory pollApproval as soon as either fires.
     */
    awaitExternalDecision?: (info: {
        approvalId: string;
        governanceEventId?: string;
        activityId: string;
        activityType: string;
        expiresAt?: string;
    }, env: ClaudeCodeEnvelope) => Promise<'approve' | 'reject' | undefined>;
}
/**
 * Build the claude-code runtime adapter. Call `.run()` from the hook
 * binary's main(). Generated from specs/typespec/govern/adapters.tsp.
 */
declare function createClaudeCodeAdapter(config: ClaudeCodeAdapterConfig): {
    run(): Promise<void>;
};

declare function runClaudeHook(): Promise<void>;

declare function installClaudeCode(opts?: InstallOptions): void;
declare function uninstallClaudeCode(opts?: InstallOptions): void;

type ClaudeCodePluginScope = 'project';
type ClaudeCodePluginCheckStatus = 'pass' | 'fail';
interface ClaudeCodePluginCheck {
    name: string;
    status: ClaudeCodePluginCheckStatus;
    path?: string;
    detail?: string;
}
interface ExportClaudeCodePluginOptions {
    /** Output directory for the complete plugin folder. */
    out: string;
    /** Remove an existing output directory first. Defaults to true. */
    force?: boolean;
    /** Optional per-event hook matchers copied into hooks/hooks.json. */
    matchers?: Record<string, string>;
    /** Include opt-in invasive hooks such as WorktreeCreate. Defaults to false. */
    includeOptInHooks?: boolean;
}
interface InstallClaudeCodePluginOptions {
    /** Project-only install scope. Defaults to project. */
    scope?: ClaudeCodePluginScope;
    /** Project root for project-scoped install. Defaults to process.cwd(). */
    cwd?: string;
    /** Project-local plugin target. Defaults to <cwd>/.claude/skills/openbox. */
    target?: string;
    /** Symlink this complete plugin folder instead of copying generated output. */
    symlink?: string;
    /** Optional per-event hook matchers copied into hooks/hooks.json. */
    matchers?: Record<string, string>;
    /** Include opt-in invasive hooks such as WorktreeCreate. Defaults to false. */
    includeOptInHooks?: boolean;
    /** Skip creating the hook runtime config template. Defaults to false. */
    skipRuntimeConfig?: boolean;
}
interface VerifyClaudeCodePluginOptions {
    scope?: ClaudeCodePluginScope;
    cwd?: string;
    target?: string;
}
interface UninstallClaudeCodePluginOptions {
    scope?: ClaudeCodePluginScope;
    cwd?: string;
    target?: string;
}
declare function claudeCodePluginTargetDir(cwd?: string): string;
declare function claudeCodeRuntimeConfigDir(cwd?: string): string;
declare function exportClaudeCodePlugin(options: ExportClaudeCodePluginOptions): string;
declare function installClaudeCodePlugin(options?: InstallClaudeCodePluginOptions): string;
declare function uninstallClaudeCodePlugin(options?: UninstallClaudeCodePluginOptions): void;
declare function verifyClaudeCodePlugin(options?: VerifyClaudeCodePluginOptions): ClaudeCodePluginCheck[];

type ClaudeCodeGovernanceStatus = 'implement_now' | 'observe_only' | 'diagnose_only' | 'explicit_out_of_scope';
interface ClaudeCodeHookMatrixEntry {
    event: string;
    status: ClaudeCodeGovernanceStatus;
    defaultInstall: boolean;
    decisionSurface: string;
    notes: string;
}
interface ClaudeCodeSurfaceMatrixEntry {
    surface: string;
    status: ClaudeCodeGovernanceStatus;
    notes: string;
}
declare const CLAUDE_CODE_GOVERNANCE_AUDIT: {
    readonly capturedAt: "2026-06-15";
    readonly installedClaudeCodeVersion: "2.1.177 (Claude Code)";
    readonly officialDocs: readonly ["https://code.claude.com/docs/en/hooks", "https://code.claude.com/docs/en/plugins-reference", "https://code.claude.com/docs/en/plugins", "https://code.claude.com/docs/en/mcp", "https://code.claude.com/docs/en/skills", "https://code.claude.com/docs/en/settings", "https://code.claude.com/docs/en/tools-reference", "https://code.claude.com/docs/en/channels", "https://code.claude.com/docs/en/changelog"];
    readonly auditedSdkSurfaces: readonly ["@openbox-ai/openbox-sdk/runtime/claude-code", "@openbox-ai/openbox-sdk/runtime/mcp", "@openbox-ai/openbox-sdk/runtime/cursor", "@openbox-ai/openbox-sdk/copilotkit", "@openbox-ai/openbox-sdk/copilotkit/react", "apps/extension", "skill", "example/n8n"];
};
declare const CLAUDE_CODE_HOOK_MATRIX: readonly ClaudeCodeHookMatrixEntry[];
declare const CLAUDE_CODE_SURFACE_MATRIX: readonly ClaudeCodeSurfaceMatrixEntry[];
declare function defaultClaudeCodeHookEvents(): string[];
declare function optInClaudeCodeHookEvents(): string[];
declare function claudeCodeGovernanceSummary(): Record<string, unknown>;

/** Path of the JSONL log written by the claude-code hook subprocess.
 *  Mirrors cursor's HOOK_LOG_PATH so the extension can tail both. */
declare const HOOK_LOG_PATH: string;

export { CLAUDE_CODE_GOVERNANCE_AUDIT, CLAUDE_CODE_HOOK_MATRIX, CLAUDE_CODE_SURFACE_MATRIX, type ClaudeCodeAdapterConfig, type ClaudeCodeAdapterHandlers, ClaudeCodeEnvelope, type ClaudeCodeGovernanceStatus, type ClaudeCodeHookMatrixEntry, type ClaudeCodePluginCheck, type ClaudeCodePluginCheckStatus, type ClaudeCodePluginScope, type ClaudeCodeSurfaceMatrixEntry, type ExportClaudeCodePluginOptions, HOOK_LOG_PATH, type InstallClaudeCodePluginOptions, type UninstallClaudeCodePluginOptions, type VerifyClaudeCodePluginOptions, claudeCodeGovernanceSummary, claudeCodePluginTargetDir, claudeCodeRuntimeConfigDir, createClaudeCodeAdapter, defaultClaudeCodeHookEvents, exportClaudeCodePlugin, installClaudeCode, installClaudeCodePlugin, optInClaudeCodeHookEvents, runClaudeHook, uninstallClaudeCode, uninstallClaudeCodePlugin, verifyClaudeCodePlugin };
