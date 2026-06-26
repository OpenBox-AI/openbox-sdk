// specs/typespec/govern/rules-projection.tsp; how live guardrails and
// policies project into editor-side rule files (Cursor `.cursor/rules/
// *.mdc`, Claude Code `AGENTS.md`, Windsurf `.windsurfrules`, etc.).
//
// The hook protocol gates actions at fire-time; rule files let the
// agent self-restrict up-front by reading the same policies as ambient
// context every turn. Same source of truth, two surfaces:
//
//   - Backend keeps guardrails + OPA rules canonical.
//   - This spec describes the projection contract: what fields a rule
//     entry exposes, how it's keyed, how globs are derived.
//   - Per-editor renderers (e.g. ts/src/runtime/cursor/rules.ts) consume
//     the projection and emit the editor's native rule format.
//
// Programming-model spec, not an HTTP API. Renderers live in adapter
// runtimes; this file just nails down the shape.

import "typespec-workflow";

using OpenBox.Workflow;

namespace OpenboxGovern.RulesProjection;

/**
 * Trigger semantics for a rule. Mirrors the Cursor `.mdc` frontmatter
 * vocabulary because that's the strictest of the editor-rule surfaces;
 * Claude Code / Windsurf renderers drop down to the equivalent (always
 * vs. nothing).
 */
enum RuleTrigger {
  /** Read every turn regardless of context. Use sparingly. */
  always,
  /** Read when the agent's current file matches `globs`. */
  globMatch,
  /** Read when the description matches the agent's current task semantically. */
  agentRequested,
  /** Read only when explicitly `@`-mentioned. */
  manual,
}

/** Severity surfaced to the agent so it can prioritize. */
enum RuleSeverity {
  /** Hard policy; deny verdict expected at hook time. */
  block,
  /** Soft policy; approval flow expected. */
  warn,
  /** Informational; observation only. */
  info,
}

/**
 * One projected rule entry. The renderer maps these to the editor's
 * native format (Cursor mdc with frontmatter; Claude Code as a section
 * in AGENTS.md; etc.). Keep the shape minimal; anything that doesn't
 * fit every editor goes in `rendererHints` rather than promoting a
 * field to the contract.
 */
model ProjectedRule {
  /** Stable identifier, e.g. `gr_pii_redaction` or `policy_123`. */
  id: string;

  /**
   * Source kind, so renderers can tag entries. Behavior rules are
   * included because backend-owned behavior-rule evaluation is a
   * first-class policy source and SDK renderers must not hand-author a
   * separate shape per language.
   */
  source: "guardrail" | "policy" | "behavior-rule";

  /** One-line description shown to the agent. */
  description: string;

  /** Long-form guidance the agent reads when triggered. Markdown allowed. */
  body: string;

  /** When the agent should consult this rule. */
  trigger: RuleTrigger;

  /** Severity hint; renderers may surface as a callout. */
  severity: RuleSeverity;

  /**
   * File globs (only meaningful when `trigger == globMatch`). Empty
   * for other triggers. Editor-specific syntax differences are the
   * renderer's problem.
   */
  globs?: string[];

  /**
   * Free-form bag of renderer-specific hints. Examples: a Cursor mdc
   * `alwaysApply: true` override, a Claude Code section anchor, a
   * Windsurf priority. Renderers must tolerate unknown keys.
   */
  rendererHints?: Record<unknown>;
}

/**
 * The full projection an editor renderer consumes. Comes from a single
 * `check_governance`-equivalent fetch keyed by agent id; renderers
 * write the file deterministically (sorted by id) so reruns produce
 * stable diffs.
 */
model RulesProjection {
  /** Agent the projection is scoped to. */
  agentId: string;

  /** ISO-8601 timestamp the projection was fetched at. */
  fetchedAt: string;

  /** Projection version; bumped when the contract changes shape. */
  version: int32;

  /** All rules, sorted by id for deterministic file output. */
  rules: ProjectedRule[];
}
