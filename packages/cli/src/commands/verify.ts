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

// Helper: find all line indexes matching a regex.
function matchLines(lines: string[], re: RegExp): Array<{ line: number; snippet: string }> {
  const out: Array<{ line: number; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
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
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const lines = content.split('\n');
      // Look for "activity_input": { (object literal start, not [)
      const re = /["']?activity_input["']?\s*[:=]\s*\{/;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]) && !/\[\s*\{/.test(lines[i])) {
          out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
        }
      }
      return out;
    },
  },
  {
    name: 'invented-verdict',
    severity: 'error',
    message: 'Invented verdict string. The four production verdicts are `allow`, `require_approval`, `block`, `halt`. `deny`/`ask`/`constrain` are not emitted by the live server.',
    fix: 'Use one of the four production verdicts. `constrain` is defined in the spec but never returned; remove it from switch statements.',
    appliesTo: () => true,
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const lines = content.split('\n');
      // Only flag in contexts that look like verdict comparison: === "deny" / case "ask" / "verdict": "constrain"
      const re = /(["'])(deny|ask)\1\s*(===|==|,|:\s*\/\/|\))/;
      const constrainRe = /(verdict|decision|action)\s*[:=]\s*["']constrain["']|case\s+["']constrain["']|===\s*["']constrain["']|==\s*["']constrain["']/;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]) || constrainRe.test(lines[i])) {
          out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
        }
      }
      return out;
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
      const invented = /\b(LLMCompletion|LLMInvocation|ToolInvocation|ToolCall|FileReading|FileWriting|ShellCommand|MCPInvocation|PromptSubmitted)\b/;
      return matchLines(lines, invented);
    },
  },
  {
    name: 'raw-approval-response-verdict',
    severity: 'warn',
    message: '`/api/v1/governance/approval` wire response is `{ id, action, reason, approval_expiration_time }` - `action`, not `verdict`. The TS SDK normalizes; raw-HTTP callers must read `.action`.',
    fix: 'Read `response.action` for raw HTTP polling, or `response.verdict || response.action` to work with both shapes.',
    appliesTo: () => true,
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      // Only flag if file mentions /governance/approval
      if (!/\/governance\/approval/.test(content)) return out;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\.verdict\b/.test(lines[i]) && !/\.verdict\s*\|\|\s*.*\.action/.test(lines[i])) {
          // Check there's an approval context nearby (within 20 lines back)
          const start = Math.max(0, i - 20);
          if (lines.slice(start, i + 1).some((l) => /approval/i.test(l))) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    },
  },
  {
    name: 'missing-x-openbox-client-header',
    severity: 'error',
    message: '`X-Openbox-Client` header is required on every backend call (edge proxy enforces it). Missing it → 401 even with a valid bearer.',
    fix: 'Add `X-Openbox-Client: <your-client-name>` alongside `Authorization: Bearer`.',
    appliesTo: () => true,
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const stripped = stripComments(content);
      const backendHost = /api\.openbox\.ai|openbox-api\.node\.lat/;
      if (!backendHost.test(stripped)) return out;
      // If the file mentions the backend host but never has the header outside comments, flag once.
      if (!/X-Openbox-Client/i.test(stripped)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (backendHost.test(lines[i])) {
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
    appliesTo: (path) => !/test|spec|\.md$|fixture|seed/i.test(path),
    detect: (content) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const lines = content.split('\n');
      const uuidRe = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      const contextRe = /(agent|team|org|organization|policy|guardrail).{0,20}(id|_id|Id)/i;
      for (let i = 0; i < lines.length; i++) {
        if (uuidRe.test(lines[i]) && contextRe.test(lines[i])) {
          out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
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
    detect: (content, lines) => {
      const out: Array<{ line: number; snippet: string }> = [];
      const startRe = /\bActivityStarted\b|activity_?started\b/;
      const completedRe = /\bActivityCompleted\b|activity_?completed\b/;
      if (!startRe.test(content)) return out;
      for (let i = 0; i < lines.length; i++) {
        if (startRe.test(lines[i])) {
          // Look within ±40 lines for a completion.
          const start = Math.max(0, i - 40);
          const end = Math.min(lines.length, i + 40);
          const window = lines.slice(start, end).join('\n');
          if (!completedRe.test(window)) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
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
