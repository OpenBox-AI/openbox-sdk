import { Command } from 'commander';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';

type Severity = 'error' | 'warn' | 'info';

type Finding = {
  severity: Severity;
  rule: string;
  file: string;
  line: number;
  snippet: string;
  message: string;
  fix?: string;
};

type Rule = {
  name: string;
  severity: Severity;
  message: string;
  fix?: string;
  appliesTo: (path: string) => boolean;
  detect: (content: string, lines: string[]) => Array<{ line: number; snippet: string }>;
};

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '__pycache__', '.venv', 'venv', '.pnpm-store']);
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.kt', '.rs']);

function walk(root: string, out: string[] = []): string[] {
  const entries = readdirSync(root);
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith('.') && e !== '.env.example') continue;
    const full = join(root, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && SCAN_EXTS.has(extname(e))) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Helper: find all line indexes matching a regex. By default strips comments
// before matching (so "// missing X-Openbox-Client" in a note can't fool an
// identifier-presence rule), but reports snippets from the ORIGINAL lines so
// the user sees real context. Pass { raw: true } to skip comment stripping
// - use this for rules where the pattern itself is a string literal inside
// code (invented-verdict's "deny" is in source, not a comment).
function matchLines(
  origLines: string[],
  re: RegExp,
  opts: { raw?: boolean } = {},
): Array<{ line: number; snippet: string }> {
  const out: Array<{ line: number; snippet: string }> = [];
  const scanLines = opts.raw ? origLines : stripComments(origLines.join('\n')).split('\n');
  for (let i = 0; i < scanLines.length; i++) {
    if (re.test(scanLines[i])) out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
  }
  return out;
}

// Strip comments so identifier-presence rules don't get fooled by "// missing X-Openbox-Client" etc.
// Handles //, /* */, and # (Python). Naive - does not respect strings; good enough for a lint.
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')     // block /* ... */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line // ...   (guard against http://)
    .replace(/^\s*#[^\n]*/gm, '');        // Python / shell #
}

const rules: Rule[] = [
  {
    name: 'activity_input-must-be-array',
    severity: 'error',
    message: '`activity_input` must be an ARRAY, not an object. Sending a bare object returns 422 at core (or 500 downstream from AGE).',
    fix: 'Wrap as [{...}]. Single payloads: `"activity_input": [{ "prompt": "..." }]`.',
    appliesTo: () => true,
    detect: (_content, lines) => {
      // Match "activity_input": {  (object literal start, not [{).
      // Comment-stripping via matchLines prevents JSDoc / annotation text
      // from firing. We skip lines that already show the array wrap on the
      // same line.
      const all = matchLines(lines, /["']?activity_input["']?\s*[:=]\s*\{/);
      return all.filter((hit) => !/\[\s*\{/.test(hit.snippet));
    },
  },
  {
    name: 'invented-verdict',
    severity: 'error',
    message: 'Invented verdict string. The four production verdicts are `allow`, `require_approval`, `block`, `halt`. `deny`/`ask`/`constrain` are not emitted by the live server.',
    fix: 'Use one of the four production verdicts. `constrain` is defined in the spec but never returned; remove it from switch statements.',
    appliesTo: () => true,
    detect: (_content, lines) => {
      // Only flag in verdict-comparison contexts. Tightened from the original
      // which matched ", " and "(" as triggers - too broad; caught normal English
      // usage of "deny"/"ask" in unrelated prose. Now requires the string to be
      // next to a comparison operator (===, ==, case) or inside a verdict field.
      const re = /(verdict|decision|action)\s*[:=]\s*["'](deny|ask|constrain)["']|case\s+["'](deny|ask|constrain)["']|(===|==)\s*["'](deny|ask|constrain)["']/;
      return matchLines(lines, re);
    },
  },
  {
    name: 'stage-both-silent-noop',
    severity: 'error',
    message: '`--stage both` (or any non-0/1 value) is silently ignored by the guardrails service - the guardrail never fires.',
    fix: 'Use `--stage 0` (input/ActivityStarted) or `--stage 1` (output/ActivityCompleted). For both coverage, create two separate guardrails.',
    appliesTo: () => true,
    detect: (content, lines) => matchLines(lines, /--stage\s+both\b|processing_stage["']?\s*[:=]\s*["']both["']/),
  },
  {
    name: 'invented-activity-type',
    severity: 'warn',
    message: 'Non-canonical `activity_type` string. First-party SDKs use past-tense PascalCase (`LLMCompleted`, `ToolCompleted`, `PromptSubmission`, `FileRead`, `ShellExecution`, `MCPToolCall`). Non-canonical strings silently miss guardrail config.',
    fix: 'Use the canonical names from references/governance-flow.md § "Canonical activity_type Names" so guardrail bindings match.',
    appliesTo: () => true,
    detect: (content, lines) => {
      // Context-aware: only flag these strings when they appear as an activity_type
      // value (in JSON payload, CLI --json, or SDK config). A file coincidentally using
      // `ToolCall` as a workflow-name or type alias isn't an integration bug.
      const invented = /(["']?activity[_-]?type["']?\s*[:=]\s*["']|["']?activityType["']?\s*[:=]\s*["']|--type\s+["']?)(LLMCompletion|LLMInvocation|ToolInvocation|FileReading|FileWriting|ShellCommand|MCPInvocation|PromptSubmitted)/;
      return matchLines(lines, invented);
    },
  },
  {
    name: 'raw-approval-response-verdict',
    severity: 'warn',
    message: '`/api/v1/governance/approval` wire response is `{ id, action, reason, approval_expiration_time }` - `action`, not `verdict`. The TS SDK normalizes; raw-HTTP callers must read `.action`.',
    fix: 'Read `response.action` for raw HTTP polling, or `response.verdict || response.action` to work with both shapes.',
    appliesTo: () => true,
    detect: (content, origLines) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const stripped = stripComments(content);
      if (!/\/governance\/approval/.test(stripped)) return out;
      const lines = stripped.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\.verdict\b/.test(lines[i]) && !/\.verdict\s*\|\|\s*.*\.action/.test(lines[i])) {
          const start = Math.max(0, i - 20);
          if (lines.slice(start, i + 1).some((l) => /approval/i.test(l))) {
            out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    },
  },
  {
    name: 'missing-x-openbox-client-header',
    severity: 'error',
    message: '`X-Openbox-Client` header is required on every backend call (enforced at the edge on hosted deploys, and by middleware on self-hosted deploys that run feat/x-openbox-client-middleware). Missing it → 401 even with a valid bearer.',
    fix: 'Add `X-Openbox-Client: <your-client-name>` alongside `Authorization: Bearer`.',
    appliesTo: () => true,
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const stripped = stripComments(content);
      // Universal: detect calls to any OpenBox backend endpoint by PATH pattern,
      // not host - so self-hosted deploys on arbitrary domains are covered too.
      // These paths are on the backend API (not core); any HTTP call whose URL
      // contains one of them is a backend call that needs the header.
      const backendPath = /\/(auth\/(profile|refresh|login|set-token|roles|change-password|permissions|features)|agent(\/|s\?|s$)|guardrail|policy|behavior-rule|session|team|org|member|trust|violation|observability|aivss|goal|approval|audit|api-key|health\?|health$)/;
      if (!backendPath.test(stripped)) return out;
      if (!/X-Openbox-Client/i.test(stripped)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (backendPath.test(lines[i])) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    name: 'hardcoded-uuid',
    severity: 'warn',
    message: 'UUID literal that looks like an agent/team/org ID. These are user-specific and must be resolved at runtime.',
    fix: 'Derive from `openbox auth profile` (orgId, teamIds) or `openbox agent list`; pass via env var / config.',
    appliesTo: (path) => !/test|spec|\.md$|fixture|seed|examples?\//i.test(path),
    detect: (_content, origLines) => {
      // Strip comments so UUIDs inside commented-out code or TODO notes don't fire.
      const strippedLines = stripComments(origLines.join('\n')).split('\n');
      const out: Array<{ line: number; snippet: string }> = [];
      const uuidRe = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      const contextRe = /(agent|team|org|organization|policy|guardrail).{0,20}(id|_id|Id)/i;
      for (let i = 0; i < strippedLines.length; i++) {
        if (uuidRe.test(strippedLines[i]) && contextRe.test(strippedLines[i])) {
          out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
        }
      }
      return out;
    },
  },
  {
    name: 'missing-finally-workflow-complete',
    severity: 'info',
    message: 'A `WorkflowStarted` event appears without an obvious `finally`/`defer`/`try/catch` structure nearby guaranteeing `WorkflowCompleted` / `WorkflowFailed` on failure paths.',
    fix: 'Wrap the lifecycle: emit start inside try, emit completed/failed in finally (JS/Python) or defer (Go). See references/governance-flow.md § "Nothing dangles".',
    appliesTo: (path) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(path),
    detect: (content, lines) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const strippedLines = stripComments(content).split('\n');
      const startRe = /WorkflowStarted|workflow_?started|workflowStarted/;
      const closerRe = /\b(finally|defer|except|__exit__|ensure)\b/;
      for (let i = 0; i < lines.length; i++) {
        if (startRe.test(lines[i])) {
          const window = strippedLines.slice(Math.max(0, i - 20), Math.min(strippedLines.length, i + 40)).join('\n');
          if (!closerRe.test(window)) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    },
  },
  {
    name: 'activity-started-without-completed',
    severity: 'info',
    message: 'A path emits `ActivityStarted` without an obvious paired `ActivityCompleted` in the same scope. Orphan activities break output-stage guardrails and trust scoring.',
    fix: 'Every Started must be Completed - on success AND failure. See references/governance-flow.md § "Nothing dangles".',
    appliesTo: (path) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(path),
    detect: (content, origLines) => {
      // Strip comments so docstrings mentioning "ActivityStarted" but not
      // "ActivityCompleted" don't fire.
      const stripped = stripComments(content);
      const strippedLines = stripped.split('\n');
      const out: Array<{ line: number; snippet: string }> = [];
      const startRe = /\bActivityStarted\b|activity_?started\b/;
      const completedRe = /\bActivityCompleted\b|activity_?completed\b/;
      if (!startRe.test(stripped)) return out;
      for (let i = 0; i < strippedLines.length; i++) {
        if (startRe.test(strippedLines[i])) {
          const start = Math.max(0, i - 40);
          const end = Math.min(strippedLines.length, i + 40);
          const window = strippedLines.slice(start, end).join('\n');
          if (!completedRe.test(window)) {
            out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    },
  },
  {
    name: 'non-canonical-event-type',
    severity: 'error',
    message: 'Non-canonical `event_type` string. Core accepts exactly six: WorkflowStarted, SignalReceived, ActivityStarted, ActivityCompleted, WorkflowCompleted, WorkflowFailed.',
    fix: 'Use one of the six canonical event types. Unknown strings silently no-op downstream classifiers (no guardrail / AGE / trust evaluation).',
    appliesTo: () => true,
    detect: (_content, origLines) => {
      // Strip comments so a doc note like `// event_type: "Foo"` doesn't fire.
      const strippedLines = stripComments(origLines.join('\n')).split('\n');
      const out: Array<{ line: number; snippet: string }> = [];
      const canonical = new Set(['WorkflowStarted', 'SignalReceived', 'ActivityStarted', 'ActivityCompleted', 'WorkflowCompleted', 'WorkflowFailed']);
      const re = /["']?event_type["']?\s*[:=]\s*["']([A-Za-z_]+)["']/g;
      for (let i = 0; i < strippedLines.length; i++) {
        for (const m of strippedLines[i].matchAll(re)) {
          if (!canonical.has(m[1])) {
            out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    },
  },
  {
    name: 'span-missing-gate-attribute',
    severity: 'warn',
    message: 'Span construction missing the gate attribute its classifier needs - core will fall through to `internal` semantic type and behavior rules won\'t fire.',
    fix: 'HTTP spans need `http.method`; DB spans need `db.system`; file spans need `file.path`; LLM spans need http.method=POST + http.url matching a known LLM domain (gen_ai.system alone is NOT sufficient).',
    appliesTo: () => true,
    detect: (content, lines) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const stripped = stripComments(content);
      // Heuristic: if a spans: / "spans": [ array is being built with hook_type like "http_request" / "db_query" / "file_read", the gate attr should be nearby.
      const hookTypes: Array<[string, RegExp, string]> = [
        ['http_request', /http\.method/, 'http.method'],
        ['db_query',     /db\.system/,   'db.system'],
        ['file_read',    /file\.path/,   'file.path'],
        ['file_write',   /file\.path/,   'file.path'],
      ];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const [hook, attrRe, attrName] of hookTypes) {
          if (new RegExp(`hook_type["']?\\s*[:=]\\s*["']${hook}["']`).test(line)) {
            const window = stripped.split('\n').slice(Math.max(0, i - 8), Math.min(lines.length, i + 12)).join('\n');
            if (!attrRe.test(window)) {
              out.push({ line: i + 1, snippet: `${line.trim().slice(0, 120)} - missing gate attr \`${attrName}\` nearby` });
            }
          }
        }
      }
      return out;
    },
  },
  {
    name: 'id-generated-per-event-not-reused',
    severity: 'warn',
    message: '`workflow_id` or `run_id` appears to be generated inline per event instead of generated once and reused. IDs must stay constant across every event in a session, otherwise core creates orphan workflows and trust scoring never finalizes.',
    fix: 'Generate workflow_id + run_id once at session start, store them, reuse on every subsequent event. activity_id is per-action.',
    appliesTo: () => true,
    detect: (_content, lines) => {
      // Pattern: workflow_id: uuid()/randomUUID()/uuid4() - inline generation
      // on the assignment line. Can't reliably distinguish "correct: generated
      // once at session start" from "wrong: inside a loop" - the warn flags
      // inline generation and lets the reader decide.
      const re = /(["']?)(workflow_id|run_id)\1\s*[:=]\s*(uuid4\(\)|uuid\.uuid4\(\)|uuid\(\)|randomUUID\(\)|crypto\.randomUUID\(\)|nanoid\(\))/;
      return matchLines(lines, re);
    },
  },
  {
    name: 'approval-poll-unbounded',
    severity: 'warn',
    message: 'Approval polling loop with no obvious timeout/max-wait bound. An indefinite poll on `/governance/approval` can hang forever if the human decision is never made.',
    fix: 'Bound the loop: use the SDK\'s `hitlMaxWait` (default 300s), or check `approval_expiration_time` against now(), or track elapsed time and give up after N seconds and treat as block.',
    appliesTo: () => true,
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      if (!/\/governance\/approval/.test(content)) return out;
      // Strip comments so "// no timeout" (documentation noise) doesn't fool the check.
      const strippedLines = stripComments(content).split('\n');
      const lines = content.split('\n');
      const boundRe = /(maxWait|max_wait|hitlMaxWait|approval_expiration_time|elapsed|\btimeout\b|AbortSignal|deadline|Date\.now\(\)\s*[-+])/i;
      for (let i = 0; i < lines.length; i++) {
        if (/\/governance\/approval/.test(lines[i])) {
          const start = Math.max(0, i - 15);
          const end = Math.min(strippedLines.length, i + 30);
          const window = strippedLines.slice(start, end).join('\n');
          if (!boundRe.test(window)) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    name: 'require-approval-no-hitl-enabled',
    severity: 'warn',
    message: 'Code branches on the `require_approval` verdict but doesn\'t set `hitlEnabled: true` on the SDK config - the SDK will throw `ApprovalDisabledError` instead of polling.',
    fix: 'Set `hitlEnabled: true` in the SDK config, or if using raw HTTP, make sure the approval-polling loop is wired (see references/governance-flow.md § "Approval Polling").',
    appliesTo: () => true,
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      // Strip comments so notes like "// no hitl" don't affect detection.
      const stripped = stripComments(content);
      const branchesOnApproval = /["']require_approval["']/.test(stripped);
      if (!branchesOnApproval) return out;
      const usesSdk = /from ['"]openbox-typescript-sdk['"]|govern\s*\(/.test(stripped);
      const hasHitlEnabled = /hitlEnabled\s*:\s*true/.test(stripped);
      const hasPollingLoop = /\/governance\/approval/.test(stripped);
      const lines = content.split('\n');
      if (usesSdk && !hasHitlEnabled) {
        for (let i = 0; i < lines.length; i++) {
          if (/["']require_approval["']/.test(lines[i])) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
            return out;
          }
        }
      } else if (!usesSdk && !hasPollingLoop) {
        for (let i = 0; i < lines.length; i++) {
          if (/["']require_approval["']/.test(lines[i])) {
            out.push({ line: i + 1, snippet: `${lines[i].trim().slice(0, 120)} - no approval-poll loop visible` });
            return out;
          }
        }
      }
      return out;
    },
  },
];

// ---------------------------------------------------------------------------
// Scan + report
// ---------------------------------------------------------------------------

function scanFile(file: string, root: string): Finding[] {
  let content: string;
  try { content = readFileSync(file, 'utf-8'); } catch { return []; }
  const lines = content.split('\n');
  const rel = relative(root, file);
  const findings: Finding[] = [];
  for (const rule of rules) {
    if (!rule.appliesTo(file)) continue;
    const hits = rule.detect(content, lines);
    for (const h of hits) {
      findings.push({
        severity: rule.severity,
        rule: rule.name,
        file: rel,
        line: h.line,
        snippet: h.snippet,
        message: rule.message,
        fix: rule.fix,
      });
    }
  }
  return findings;
}

function printReport(findings: Finding[], totalFiles: number, rootLabel: string): { errors: number; warns: number; infos: number } {
  const errs = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  const infos = findings.filter((f) => f.severity === 'info');

  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule)!.push(f);
  }

  console.log(`openbox verify - scanned ${totalFiles} file(s) under ${rootLabel}`);
  console.log();

  if (findings.length === 0) {
    console.log('✓ No drift patterns detected.');
    console.log('  (This is a static scan. Use `openbox session inspect` to validate live protocol behavior.)');
    return { errors: 0, warns: 0, infos: 0 };
  }

  for (const [rule, hits] of byRule) {
    const sev = hits[0].severity;
    const mark = sev === 'error' ? '✗' : sev === 'warn' ? '!' : 'ℹ';
    console.log(`${mark} ${rule} (${sev}) - ${hits.length} finding${hits.length === 1 ? '' : 's'}`);
    console.log(`  ${hits[0].message}`);
    if (hits[0].fix) console.log(`  Fix: ${hits[0].fix}`);
    for (const h of hits.slice(0, 10)) {
      console.log(`    ${h.file}:${h.line}  ${h.snippet}`);
    }
    if (hits.length > 10) console.log(`    … and ${hits.length - 10} more`);
    console.log();
  }

  console.log(`Summary: ${errs.length} error, ${warns.length} warn, ${infos.length} info`);
  return { errors: errs.length, warns: warns.length, infos: infos.length };
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerVerifyCommand(program: Command) {
  program
    .command('verify [path]')
    .description('Static lint: scan integration code for OpenBox protocol drift')
    .option('--fail-on <severity>', 'Exit non-zero on this severity or worse (error|warn|info)', 'error')
    .option('--json', 'Emit findings as JSON instead of human-readable', false)
    .action(async (path: string | undefined, opts) => {
      const root = path ? (path.startsWith('/') ? path : join(process.cwd(), path)) : process.cwd();
      if (!existsSync(root)) {
        console.error(`path not found: ${root}`);
        process.exit(1);
      }

      const st = statSync(root);
      const files = st.isDirectory() ? walk(root) : [root];

      const findings: Finding[] = [];
      for (const f of files) {
        findings.push(...scanFile(f, st.isDirectory() ? root : process.cwd()));
      }

      if (opts.json) {
        console.log(JSON.stringify({ root, scanned: files.length, findings }, null, 2));
      } else {
        printReport(findings, files.length, root);
      }

      // Exit policy.
      const bySev = { error: 3, warn: 2, info: 1 } as const;
      const threshold = bySev[opts.failOn as keyof typeof bySev] ?? 3;
      const worst = Math.max(
        0,
        ...findings.map((f) => bySev[f.severity as keyof typeof bySev] ?? 0),
      );
      if (worst >= threshold) process.exit(1);
    });
}
