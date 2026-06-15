import { O as OpenBoxCoreClient, w as CursorSession, W as WorkflowVerdict } from '../../govern-CgRTREi0.js';
import { C as CursorEnvelope } from '../../envelopes-DnviQ3yd.js';
import '../../core-types-Dxgkbox0.js';

/**
 * Per-event handlers. Each handler receives the parsed stdin envelope
 * + an attached CursorSession (workflowId/runId resolved by
 * `config.resolveSession`). Return a WorkflowVerdict; usually by calling
 * a preset method like `session.preToolUse(...)`. The adapter writes
 * the verdict-mapped stdout JSON automatically per the operation's
 * @verdictShape. Returning undefined writes the default `allow` shape.
 */
interface CursorAdapterHandlers {
    beforeSubmitPrompt?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    beforeReadFile?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    beforeShellExecution?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    beforeMCPExecution?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    preToolUse?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    afterAgentResponse?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    afterAgentThought?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    afterShellExecution?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    afterFileEdit?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    afterMCPExecution?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    postToolUse?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    postToolUseFailure?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    sessionStart?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    stop?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    beforeTabFileRead?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    afterTabFileEdit?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    sessionEnd?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    preCompact?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    subagentStart?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
    subagentStop?: (input: CursorEnvelope, session: CursorSession) => Promise<WorkflowVerdict | undefined | void>;
}
interface CursorAdapterConfig {
    /** Authenticated core client (agent-scoped API key). */
    core: OpenBoxCoreClient;
    /** Per-stdin-message resolver; typically reads sessionStore.json. */
    resolveSession: (env: CursorEnvelope) => Promise<{
        workflowId: string;
        runId: string;
    }>;
    handlers: CursorAdapterHandlers;
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
    }, env: CursorEnvelope) => void | Promise<void>;
    /**
     * Fired when pollApproval resolves OR times out. Lets the harness
     * clear pending markers and any inline UI it staged.
     */
    onApprovalResolved?: (info: {
        approvalId: string;
        activityId: string;
        activityType: string;
        arm: string;
    }, env: CursorEnvelope) => void | Promise<void>;
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
    }, env: CursorEnvelope) => Promise<'approve' | 'reject' | undefined>;
}
/**
 * Build the cursor runtime adapter. Call `.run()` from the hook
 * binary's main(). Generated from specs/typespec/govern/adapters.tsp.
 */
declare function createCursorAdapter(config: CursorAdapterConfig): {
    run(): Promise<void>;
};

declare function runCursorHook(): Promise<void>;

type CursorInstallCheckStatus = 'pass' | 'fail' | 'skip';
interface CursorInstallCheck {
    name: string;
    status: CursorInstallCheckStatus;
    path?: string;
    detail?: string;
}
interface VerifyCursorInstallOptions {
    /** Project root for project-scoped install. Defaults to process.cwd(). */
    cwd?: string;
    /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
    pluginTarget?: string;
    /** Include the user-level approval extension check. Defaults to false. */
    includeExtension?: boolean;
    /** Include hook runtime readiness checks. Install flows keep this
     *  false so they can lay down files before a runtime key exists. */
    includeRuntime?: boolean;
    /** Validate the runtime key against core. Implies includeRuntime. */
    validateRuntime?: boolean;
}
declare function verifyCursorInstall(opts?: VerifyCursorInstallOptions & {
    includeRuntime?: false;
    validateRuntime?: false;
}): CursorInstallCheck[];
declare function verifyCursorInstall(opts: VerifyCursorInstallOptions & ({
    includeRuntime: true;
} | {
    validateRuntime: true;
})): Promise<CursorInstallCheck[]>;

type CursorPluginCheckStatus = 'pass' | 'fail' | 'skip';
interface CursorPluginCheck {
    name: string;
    status: CursorPluginCheckStatus;
    path?: string;
    detail?: string;
}
interface ExportCursorPluginOptions {
    /** Output directory for the complete plugin folder. */
    out: string;
    /** Remove an existing output directory first. Defaults to true. */
    force?: boolean;
    /** Optional per-event hook matchers copied into hooks/hooks.json. */
    matchers?: Record<string, string>;
}
interface InstallCursorPluginOptions {
    /** Project root for project-scoped install. Defaults to process.cwd(). */
    cwd?: string;
    /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
    target?: string;
    /** Symlink this complete plugin folder instead of copying generated output. */
    symlink?: string;
    /** Optional per-event hook matchers copied into hooks/hooks.json. */
    matchers?: Record<string, string>;
    /** Skip creating the hook runtime config template. Defaults to false. */
    skipRuntimeConfig?: boolean;
}
interface VerifyCursorPluginOptions {
    /** Project root for project-scoped install. Defaults to process.cwd(). */
    cwd?: string;
    /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
    target?: string;
}
interface UninstallCursorPluginOptions {
    /** Project root for project-scoped install. Defaults to process.cwd(). */
    cwd?: string;
    /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
    target?: string;
}
declare function cursorPluginTargetDir(cwd?: string): string;
declare function exportCursorPlugin(options: ExportCursorPluginOptions): string;
declare function installCursorPlugin(options?: InstallCursorPluginOptions): string;
declare function uninstallCursorPlugin(options?: UninstallCursorPluginOptions): void;
declare function verifyCursorPlugin(options?: VerifyCursorPluginOptions): CursorPluginCheck[];

/** Path of the JSONL log written by the cursor hook subprocess.
 *  Kept as a public symbol because the extension's OutputChannel
 *  tails this file. */
declare const HOOK_LOG_PATH: string;

export { type CursorAdapterConfig, type CursorAdapterHandlers, CursorEnvelope, type CursorInstallCheck, type CursorInstallCheckStatus, type CursorPluginCheck, type CursorPluginCheckStatus, type ExportCursorPluginOptions, HOOK_LOG_PATH, type InstallCursorPluginOptions, type UninstallCursorPluginOptions, type VerifyCursorInstallOptions, type VerifyCursorPluginOptions, createCursorAdapter, cursorPluginTargetDir, exportCursorPlugin, installCursorPlugin, runCursorHook, uninstallCursorPlugin, verifyCursorInstall, verifyCursorPlugin };
