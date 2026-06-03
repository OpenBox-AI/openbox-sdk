// Approval activity-label formatter. Spec-driven primary path, with an
// acronym-aware fallback for free-form custom-preset activity_types.
//
// Originally implemented for the iOS app; lifted here so every consumer
// (mobile, web, CLI, IDE extensions) renders the same label for the same
// activity_type.

import { CANONICAL_ACTIVITY_LABELS } from '../core-client/index.js';

const VERDICT_LABEL: Record<number, string> = {
  0: 'Allow',
  1: 'Constrain',
  2: 'Require Approval',
  3: 'Block',
  4: 'Halt',
};

export function verdictLabel(v: number | undefined | null): string | undefined {
  return v == null ? undefined : VERDICT_LABEL[v];
}

// Acronyms the spec table doesn't cover (see fallback path below). The
// canonical activity_type vocabulary all routes through CANONICAL_ACTIVITY_LABELS;
// this allowlist is only consulted for free-form custom-preset activity_types
// that domain agents (FinOps/IAM/RPA/...) emit outside the canonical set.
export const UPPERCASE_WORDS = new Set([
  'api',
  'id',
  'url',
  'http',
  'sql',
  'db',
  'ui',
  'io',
  'ip',
  'llm',
  'mcp',
  'sdk',
  'sse',
  'rpc',
  'sso',
  'iam',
  'pii',
  'json',
  'xml',
  'css',
  'html',
  'cli',
  'aws',
  'gcp',
  'jwt',
  'oauth',
]);

export function formatLabel(s?: string | null): string {
  if (!s) return '';
  // Spec-driven path: every canonical activity_type has a curated label
  // in the @activityLabels table on OpenboxGovern (specs/typespec/govern/main.tsp).
  // Single source of truth across every consumer; no per-consumer drift on
  // acronyms (LLM/MCP/HTTP) or naming conventions (snake/kebab/dotted).
  const specLabel = CANONICAL_ACTIVITY_LABELS[s];
  if (specLabel) return specLabel;

  // Fallback: free-form custom-preset activity_types (domain agents) and
  // any other non-canonical strings flow through a generic Title-Case
  // formatter. Splits on _ first, then on case-boundary segments inside
  // each chunk. Two boundaries that matter:
  //   1) lower→upper (camelCase): `toolPlanner` → ['tool', 'Planner']
  //   2) ACRONYM→Word boundary:   `LLMCompleted` → ['LLM', 'Completed']
  //                               `MCPToolCall`   → ['MCP', 'Tool', 'Call']
  // The naive `(?=[A-Z])` regex split would yield `['L','L','M','Completed']`
  //; the bug we're guarding against here. Two-look-around regex below
  // keeps consecutive uppercase letters together until the next lowercase
  // starts a new word.
  return s
    .split('_')
    .flatMap((chunk) =>
      chunk
        // Insert space at lower→upper boundary: `aB` → `a B`
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        // Insert space at ACRONYM→Word boundary: `XMLParser` → `XML Parser`
        // (uppercase run followed by uppercase+lowercase).
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(' '),
    )
    .filter((w) => w.length > 0)
    .map((w) => {
      const lower = w.toLowerCase();
      if (UPPERCASE_WORDS.has(lower)) return w.toUpperCase();
      // Already-all-uppercase tokens (acronyms not in the allowlist
      // but flagged by the splitter as a single uppercase run) stay
      // upper-cased. Mixed-case words get standard Title Case.
      if (w.length > 1 && w === w.toUpperCase()) return w;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
