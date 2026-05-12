// Shared verdict-matrix fixture consumed by every host-runtime
// integration test (claude-code headless runner, cursor wdio
// suite). Each case names a planted behavior rule in the local
// stack (`openbox-local/scripts/bootstrap-rules.json`) and pins
// the verdict + outcome the SDK's evaluator is expected to return
// when the rule fires.
//
// Adding a host-runtime test means consuming this array and
// translating each `spanType` + `activityInput` pair into the
// host-specific tool invocation. Adding a new case means adding
// the rule to the bootstrap manifest and a row here.

export type SpanType =
  | 'llm'
  | 'file_read'
  | 'file_write'
  | 'shell'
  | 'http'
  | 'db'
  | 'mcp';

export type Verdict =
  | 'allow'
  | 'constrain'
  | 'require_approval'
  | 'block'
  | 'halt';

export type Outcome = 'allow' | 'require_approval' | 'deny';

export interface VerdictMatrixCase {
  /** Short human-readable label. */
  name: string;
  /** SDK `SpanType` enum value the case drives. */
  spanType: SpanType;
  /** Free-form input passed to the SDK's `checkGovernance` (or to
   *  the equivalent host-mediated tool invocation). */
  activityInput: Record<string, unknown>;
  /** Bootstrap rule name expected to match. */
  expectedRule: string;
  /** Backend verdict the rule emits. */
  expectedVerdict: Verdict;
  /** Resolved outcome after the SDK translates verdict to
   *  pass / pending / fail. */
  expectedOutcome: Outcome;
}

export const VERDICT_MATRIX: readonly VerdictMatrixCase[] = [
  {
    name: 'db query is constrained (score lowered, action allowed)',
    spanType: 'db',
    activityInput: { query: 'SELECT 1' },
    expectedRule: 'e2e-constrain-db',
    expectedVerdict: 'constrain',
    expectedOutcome: 'allow',
  },
  {
    name: 'llm completion requires approval',
    spanType: 'llm',
    activityInput: { prompt: 'summarize this' },
    expectedRule: 'e2e-approve-llm',
    expectedVerdict: 'require_approval',
    expectedOutcome: 'require_approval',
  },
  {
    name: 'file_write is blocked',
    spanType: 'file_write',
    activityInput: { file_path: '/tmp/blocked.txt' },
    expectedRule: 'e2e-deny-write',
    expectedVerdict: 'block',
    expectedOutcome: 'deny',
  },
  {
    name: 'http POST halts',
    spanType: 'http',
    activityInput: { method: 'POST', url: 'https://example.com/blocked' },
    expectedRule: 'e2e-halt-http',
    expectedVerdict: 'halt',
    expectedOutcome: 'deny',
  },
] as const;
