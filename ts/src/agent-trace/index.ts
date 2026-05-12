// Agent Trace: vendor-neutral attribution format for AI-generated
// code, per cursor/agent-trace v0.1.0 RFC.
//
// We emit one TraceRecord per classified non-keystroke insert in the
// extension's TabObserver. The records land at
// ~/.openbox/log/agent-trace.jsonl (JSONL; one record per line) so
// downstream tools (Cursor canvas, git blame integrations, audit
// pipelines) can ingest the same shape that any compliant emitter
// produces.
//
// We do NOT bundle the upstream zod schema; that would drag a
// runtime dep and a JSON-schema generator into the SDK. Types here
// match the upstream wire shape exactly. Validation against the
// canonical schema happens server-side / at consumption.
//
// Spec: https://github.com/cursor/agent-trace
//
// Public sub-path: `import { writeTraceRecord, ... } from 'openbox-sdk/agent-trace'`

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openboxDataRoot } from '../env/os-paths.js';

export type ContributorType = 'human' | 'ai' | 'mixed' | 'unknown';

export interface Tool {
  name: string;
  version: string;
}

export interface Contributor {
  type: ContributorType;
  /** models.dev convention, e.g. 'anthropic/claude-opus-4-5-20251101'. */
  model_id?: string;
}

export interface RelatedResource {
  type: string;
  url: string;
}

export interface Range {
  start_line: number;
  end_line: number;
  content_hash?: string;
  contributor?: Contributor;
}

export interface Conversation {
  url?: string;
  contributor?: Contributor;
  ranges: Range[];
  related?: RelatedResource[];
}

export interface FileTrace {
  path: string;
  conversations: Conversation[];
}

export type VcsType = 'git' | 'jj' | 'hg' | 'svn';

export interface Vcs {
  type: VcsType;
  revision: string;
}

export interface TraceRecord {
  version: string;
  id: string;
  timestamp: string;
  vcs?: Vcs;
  tool?: Tool;
  files: FileTrace[];
  metadata?: Record<string, unknown>;
}

// Spec-current as of cursor/agent-trace v0.1.0 (RFC, January 2026).
const SPEC_VERSION = '0.1.0';
const LOG_DIR = path.join(openboxDataRoot(), 'log');
const LOG_FILE = path.join(LOG_DIR, 'agent-trace.jsonl');

/** Hash inserted content with sha256; deterministic for
 *  position-independent tracking per the spec's `content_hash`
 *  field. Hex-encoded; no truncation. */
export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export interface BuildRecordArgs {
  /** Absolute path on disk. We compute the relative path from the
   *  workspace root if `workspaceRoot` is provided; otherwise we
   *  emit the absolute path (consumers can normalize). */
  filePath: string;
  /** 1-indexed line range covered by the contribution. */
  startLine: number;
  endLine: number;
  /** The inserted/edited text. Used to compute `content_hash`. */
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
export function buildRecord(args: BuildRecordArgs): TraceRecord {
  const rel =
    args.workspaceRoot && args.filePath.startsWith(args.workspaceRoot)
      ? path.relative(args.workspaceRoot, args.filePath) || args.filePath
      : args.filePath;
  const contributor: Contributor = args.modelId
    ? { type: args.contributorType, model_id: args.modelId }
    : { type: args.contributorType };
  const range: Range = {
    start_line: args.startLine,
    end_line: args.endLine,
    content_hash: hashContent(args.content),
  };
  const conversation: Conversation = {
    contributor,
    ranges: [range],
    ...(args.conversationUrl ? { url: args.conversationUrl } : {}),
  };
  return {
    version: SPEC_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...(args.tool ? { tool: args.tool } : {}),
    ...(args.vcs ? { vcs: args.vcs } : {}),
    files: [{ path: rel, conversations: [conversation] }],
    ...(args.metadata ? { metadata: args.metadata } : {}),
  };
}

/** Append a record to the JSONL log. Idempotent on the directory
 *  (mkdirs as needed). Any IO failure is swallowed; telemetry
 *  must never break the caller. */
export function writeTraceRecord(record: TraceRecord, opts: { logFile?: string } = {}): void {
  const file = opts.logFile ?? LOG_FILE;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

/** Read the JSONL log back as parsed records. Used by ingesters,
 *  tests, and tooling. Skips malformed lines silently. */
export function readTraceLog(opts: { logFile?: string } = {}): TraceRecord[] {
  const file = opts.logFile ?? LOG_FILE;
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8');
  const out: TraceRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as TraceRecord);
    } catch {
      /* skip */
    }
  }
  return out;
}

export const TRACE_LOG_PATH = LOG_FILE;
export const TRACE_SPEC_VERSION = SPEC_VERSION;
