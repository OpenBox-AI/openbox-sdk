type ContributorType = 'human' | 'ai' | 'mixed' | 'unknown';
interface Tool {
    name: string;
    version: string;
}
interface Contributor {
    type: ContributorType;
    /** models.dev convention, e.g. 'anthropic/claude-opus-4-5-20251101'. */
    model_id?: string;
}
interface RelatedResource {
    type: string;
    url: string;
}
interface Range {
    start_line: number;
    end_line: number;
    content_hash?: string;
    contributor?: Contributor;
}
interface Conversation {
    url?: string;
    contributor?: Contributor;
    ranges: Range[];
    related?: RelatedResource[];
}
interface FileTrace {
    path: string;
    conversations: Conversation[];
}
type VcsType = 'git' | 'jj' | 'hg' | 'svn';
interface Vcs {
    type: VcsType;
    revision: string;
}
interface TraceRecord {
    version: string;
    id: string;
    timestamp: string;
    vcs?: Vcs;
    tool?: Tool;
    files: FileTrace[];
    metadata?: Record<string, unknown>;
}
declare function defaultTraceLogPath(): string;
/** Hash inserted content with sha256; deterministic for
 *  position-independent tracking per the spec's `content_hash`
 *  field. Hex-encoded; no truncation. */
declare function hashContent(text: string): string;
interface BuildRecordArgs {
    /** Absolute path on disk. We compute the relative path from the
     *  workspace root if `workspaceRoot` is provided; otherwise we
     *  emit the absolute path (consumers can normalize). */
    filePath: string;
    /** 1-indexed line range covered by the contribution. */
    startLine: number;
    endLine: number;
    /** Inserted or edited text for computing `content_hash`. */
    content: string;
    /** Contribution origin: 'ai', 'human', 'mixed', 'unknown'. */
    contributorType: ContributorType;
    /** Optional model id (models.dev convention). */
    modelId?: string;
    /** Workspace root for the relative-path computation. */
    workspaceRoot?: string;
    /** Optional VCS info if the consumer can resolve it cheaply. */
    vcs?: Vcs;
    /** Optional tool tag. Defaults to {name: 'openbox', version}. */
    tool?: Tool;
    /** Conversation URL (Cursor's chat link, etc.). Optional. */
    conversationUrl?: string;
    /** Implementation-specific extras. */
    metadata?: Record<string, unknown>;
}
/** Build a TraceRecord for a single contribution. The shape matches
 *  the upstream Zod schema field-for-field. */
declare function buildRecord(args: BuildRecordArgs): TraceRecord;
/** Append a record to the JSONL log. Idempotent on the directory
 *  (mkdirs as needed). Any IO failure is swallowed; telemetry
 *  must never break the caller. */
declare function writeTraceRecord(record: TraceRecord, opts?: {
    logFile?: string;
}): void;
/** Read the JSONL log back as parsed records. Used by ingesters,
 *  tests, and tooling. Skips malformed lines silently. */
declare function readTraceLog(opts?: {
    logFile?: string;
}): TraceRecord[];
declare const TRACE_LOG_PATH: string;
declare const TRACE_SPEC_VERSION = "0.1.0";

export { type BuildRecordArgs, type Contributor, type ContributorType, type Conversation, type FileTrace, type Range, type RelatedResource, TRACE_LOG_PATH, TRACE_SPEC_VERSION, type Tool, type TraceRecord, type Vcs, type VcsType, buildRecord, defaultTraceLogPath, hashContent, readTraceLog, writeTraceRecord };
