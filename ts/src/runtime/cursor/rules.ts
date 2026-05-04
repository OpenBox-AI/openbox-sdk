// Cursor renderer for the editor-agnostic rules projection. Emits one
// `.cursor/rules/openbox-{kind}-{id}.mdc` per ProjectedRule (Cursor
// reads every mdc in the rules dir; per-rule files keep diffs small
// and let operators delete individual rules without re-running sync).
//
// Frontmatter mapping:
//   trigger == always         → { alwaysApply: true }
//   trigger == globMatch      → { globs: [...] }
//   trigger == agentRequested → { description: <one-liner> }   (model decides)
//   trigger == manual         → no frontmatter triggers; @-mention only
//
// We delete any *previously-written* OpenBox rule files that aren't in
// the new projection, so removing a guardrail server-side cleans up
// the local file. User-authored mdc files (those without our header
// marker) are never touched.
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectedRule, RulesProjection } from '../_shared/rules-projection.js';

const FILE_PREFIX = 'openbox-';
const HEADER_MARKER = '<!-- openbox-managed: do-not-edit -->';

function escapeYaml(s: string): string {
  // Keep it simple: wrap in quotes if the string contains anything
  // that mdc frontmatter might mis-parse (colons, hashes, leading
  // punctuation). Backslash and double-quote get escaped.
  if (/^[\w \-./]+$/.test(s) && !s.startsWith(' ')) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function frontmatter(rule: ProjectedRule): string {
  const lines: string[] = ['---'];
  switch (rule.trigger) {
    case 'always':
      lines.push('alwaysApply: true');
      lines.push(`description: ${escapeYaml(rule.description)}`);
      break;
    case 'globMatch':
      lines.push(`globs: ${JSON.stringify(rule.globs ?? [])}`);
      lines.push(`description: ${escapeYaml(rule.description)}`);
      break;
    case 'agentRequested':
      lines.push(`description: ${escapeYaml(rule.description)}`);
      break;
    case 'manual':
      // No frontmatter triggers; agent only reads on @-mention.
      break;
  }
  // Persist source + severity as renderer hints so audits can map a
  // rule file back to its backend object without re-fetching.
  lines.push(`# openbox.source: ${rule.source}`);
  lines.push(`# openbox.severity: ${rule.severity}`);
  lines.push(`# openbox.id: ${rule.id}`);
  lines.push('---');
  return lines.join('\n');
}

function fileNameFor(rule: ProjectedRule): string {
  // rule.id is `guardrail/<id>` or `policy/<id>`; flatten the slash for
  // the filename.
  const safe = rule.id.replace(/\//g, '-').replace(/[^A-Za-z0-9_\-]/g, '_');
  return `${FILE_PREFIX}${safe}.mdc`;
}

function renderRuleFile(rule: ProjectedRule): string {
  return [HEADER_MARKER, frontmatter(rule), '', rule.body, ''].join('\n');
}

function isOpenBoxManaged(file: string): boolean {
  if (!file.startsWith(FILE_PREFIX) || !file.endsWith('.mdc')) return false;
  return true;
}

export interface RenderOpts {
  /** Workspace root; rules land at `<workspace>/.cursor/rules/`. */
  workspace?: string;
  /** Skip stale-file deletion (useful for previewing). */
  noPrune?: boolean;
}

export interface RenderResult {
  rulesDir: string;
  written: string[];
  pruned: string[];
}

export function renderRulesProjection(
  projection: RulesProjection,
  opts: RenderOpts = {},
): RenderResult {
  const workspace = opts.workspace ?? process.cwd();
  const rulesDir = path.join(workspace, '.cursor', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });

  const wantedFiles = new Set<string>();
  const written: string[] = [];
  for (const rule of projection.rules) {
    const name = fileNameFor(rule);
    wantedFiles.add(name);
    const dest = path.join(rulesDir, name);
    const next = renderRuleFile(rule);
    let prev: string | null = null;
    try {
      prev = fs.readFileSync(dest, 'utf-8');
    } catch {
      /* missing; first write */
    }
    if (prev !== next) {
      fs.writeFileSync(dest, next, 'utf-8');
      written.push(name);
    }
  }

  const pruned: string[] = [];
  if (!opts.noPrune) {
    const present = fs.readdirSync(rulesDir);
    for (const f of present) {
      if (!isOpenBoxManaged(f)) continue;
      if (wantedFiles.has(f)) continue;
      // Sanity-check the file is one we wrote before deleting; a
      // user-named "openbox-foo.mdc" without our header marker stays.
      const full = path.join(rulesDir, f);
      try {
        const content = fs.readFileSync(full, 'utf-8');
        if (!content.startsWith(HEADER_MARKER)) continue;
      } catch {
        continue;
      }
      fs.unlinkSync(full);
      pruned.push(f);
    }
  }

  return { rulesDir, written, pruned };
}
