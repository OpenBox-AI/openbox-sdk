export { D as DateRangeKey, E as EMPTY_FILTERS, F as FilterState, S as SummaryLookups, a as applyClientFilters, d as dateRangeBounds, h as hasActiveFilters, s as summarizeFilters } from '../filters-DvdU2K2C.js';
import { b as OpenBoxClient } from '../client-C43Hkmge.js';
import { c as Approval } from '../responses-C2s9PwZF.js';
import '../env-bindings-CCaolEHB.js';

declare function verdictLabel(v: number | undefined | null): string | undefined;
declare const UPPERCASE_WORDS: Set<string>;
declare function formatLabel(s?: string | null): string;

/**
 * Pull the most informative single-string summary from `approval.input`
 * for the given activity_type. The approval sheet shows this as the
 * "Action" row; it's what the agent is asking permission to do.
 *
 * Returns null when there's nothing to render (no input, unknown type
 * with non-stringifiable payload). Caller hides the row in that case.
 *
 * Design: the wire shape (`input`) is `unknown[]` per the govern
 * protocol; singletons are always wrapped in a one-element array.
 * We read input[0] as the relevant payload object and pull the field
 * that matters for that activity type.
 */
declare function summarizeInput(activityType: string | null | undefined, input: unknown): string | null;

type SectionStatus = 'approved' | 'rejected' | 'expired';
type ApprovalBucket = SectionStatus | 'pending';
interface Bucketable {
    status?: string | null;
    verdict?: number | null;
    decided_at?: string | null;
    approval_expired_at?: string | null;
}
declare function statusOf(a: Bucketable): ApprovalBucket;

declare function tierColor(tier?: number | null): string;
declare function tierBg(tier?: number | null): string;

declare function timeAgo(createdAt?: string | null): string;
declare function timeRemaining(expiresAt?: string | null): string;

declare function defaultApprovalSocketPath(): string;
declare const APPROVAL_SOCKET_PATH: string;
interface PendingNotification {
    governance_event_id: string;
    agent_id: string;
    hook_event_name: string;
    /** Source runtime ("cursor", "claude-code", ...). Drives extension
     *  notification copy. */
    source: 'cursor' | 'claude-code';
    /** One-line summary the extension shows (file path, command, etc). */
    summary: string;
    /** Backend reject_message verbatim; extension sanitizes for display. */
    reason: string;
    /** ISO-8601 deadline; the extension reaps past this. */
    expires_at: string;
}
type SocketResult = {
    kind: 'decision';
    decision: 'approve' | 'reject';
} | {
    kind: 'timeout';
} | {
    kind: 'unreachable';
} | {
    kind: 'closed';
};
interface ActiveConnection {
    socket: unknown;
    /** Push a "pending" notification (idempotent if reconnecting). */
    notifyPending: (p: PendingNotification) => void;
    /** Wait for a decision matching the given governance_event_id, or
     *  resolve to a non-decision outcome on timeout / disconnect. */
    awaitDecision: (geid: string, deadlineMs: number) => Promise<SocketResult>;
    close: () => void;
}
/**
 * Connect to the extension's approval socket. Resolves to a handle
 * that can send pendings and await decisions. If the extension
 * isn't running (no socket file, ECONNREFUSED, etc.) resolves to
 * `null` so the caller can fall back to pollApproval-only.
 */
declare function connectApprovalSocket(socketPath?: string): Promise<ActiveConnection | null>;

interface ApprovalPendingMessage {
    type: 'pending';
    governance_event_id: string;
    agent_id: string;
    hook_event_name: string;
    source: 'cursor' | 'claude-code' | string;
    summary: string;
    reason: string;
    expires_at: string;
}
interface ApprovalServerConnection {
    /** Pushes a `decision` message back to the hook subprocess on
     *  this connection. Safe to call multiple times; writes that
     *  arrive after the socket closes are dropped silently. */
    writeDecision(geid: string, decision: 'approve' | 'reject'): void;
    /** Governance event ids this connection currently holds. The
     *  server drops these from the consumer's resolver map when the
     *  connection closes (for example after a hook subprocess crash
     *  or exit). */
    readonly geids: ReadonlySet<string>;
}
interface ApprovalSocketServerOptions {
    /** Override socket path. Defaults to
     *  `<project>/.openbox/run/openbox.sock`. */
    socketPath?: string;
    /** Diagnostic logger for non-fatal I/O errors. */
    log?: (line: string) => void;
}
interface ApprovalSocketServerHandlers {
    /** Invoked when a pending message lands. The handler typically
     *  builds a host-side state record, attaches `conn.writeDecision`
     *  as the resolver, and stores the record. */
    onPending(msg: ApprovalPendingMessage, conn: ApprovalServerConnection): void;
    /** Invoked when a connection closes. The handler should release
     *  any resolver or state tied to the connection's governance
     *  event ids. */
    onConnectionClosed(conn: ApprovalServerConnection): void;
}
declare class ApprovalSocketServer {
    private readonly handlers;
    private server;
    private readonly conns;
    private readonly socketPath;
    private readonly log;
    constructor(handlers: ApprovalSocketServerHandlers, options?: ApprovalSocketServerOptions);
    /** Path the server is (or will be) listening on. */
    get path(): string;
    start(): void;
    private onConnection;
    stop(): void;
}

interface ApprovalIdentityHint {
    /** Governance event id from the socket message, hook envelope,
     *  or caller's pre-known value. Acts as both the lookup needle
     *  and the fallback path parameter when no fresher row is
     *  available. */
    governanceEventId: string;
    /** Optional caller-supplied agent id (often pre-cached in a
     *  toast or detail panel). Takes precedence over store and
     *  backend lookups. */
    agentId?: string;
    /** Optional consumer-side row that already carries an agent id
     *  or a backend-authoritative governance event id. */
    storeRow?: {
        agent_id?: string;
        governance_event_id?: string;
    };
}
interface ResolvedApprovalIdentity {
    /** Agent id to use in the `/decide` path. */
    agentId: string;
    /** Approval row id to use in the `/decide` path. */
    eventId: string;
    /** Core governance event id, when the backend approval row exposes it. */
    governanceEventId?: string;
}
/**
 * Resolves an `{agentId, eventId}` pair from a partial hint by
 * consulting, in order: the caller's `agentId`, then the
 * `storeRow`, then the backend pending-approvals list. Throws
 * when no agent id can be determined.
 */
declare function resolveApprovalIdentity(client: OpenBoxClient, hint: ApprovalIdentityHint): Promise<ResolvedApprovalIdentity>;
/** Raised when no agent id can be resolved for a governance event id. */
declare class ApprovalIdentityNotFoundError extends Error {
    readonly hint: ApprovalIdentityHint;
    constructor(message: string, hint: ApprovalIdentityHint);
}
/**
 * Convenience helper that resolves the identity and posts the
 * decision in one call. Throws on either lookup or decide failure.
 * Returns the resolved identity so consumers can correlate logs
 * and store updates with the values actually sent on the wire.
 */
declare function decideApproval(client: OpenBoxClient, hint: ApprovalIdentityHint, decision: 'approve' | 'reject'): Promise<ResolvedApprovalIdentity>;

/** Canonical host names. Free-form so a third-party host
 *  integration can use its own slug without an SDK change. */
type ApprovalSource = string;
/**
 * Infers the originating host for an approval. The file header
 * describes the three read paths. Returns `undefined` when none
 * carries a value; callers should treat that as "unknown".
 */
declare function approvalSource(a: Approval): ApprovalSource | undefined;

export { APPROVAL_SOCKET_PATH, type ApprovalBucket, type ApprovalIdentityHint, ApprovalIdentityNotFoundError, type ApprovalPendingMessage, type ApprovalServerConnection, ApprovalSocketServer, type ApprovalSocketServerHandlers, type ApprovalSocketServerOptions, type ApprovalSource, type PendingNotification, type ResolvedApprovalIdentity, type SectionStatus, type SocketResult, UPPERCASE_WORDS, approvalSource, connectApprovalSocket, decideApproval, defaultApprovalSocketPath, formatLabel, resolveApprovalIdentity, statusOf, summarizeInput, tierBg, tierColor, timeAgo, timeRemaining, verdictLabel };
