import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderRulesProjection } from '../../ts/src/runtime/cursor/rules.js';
import type { RulesProjection, ProjectedRule } from '../../ts/src/governance/rules-projection.js';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openbox-rules-'));
}

function rule(over: Partial<ProjectedRule>): ProjectedRule {
  return {
    id: 'guardrail/g1',
    source: 'guardrail',
    description: 'Default test rule',
    body: 'rule body',
    trigger: 'always',
    severity: 'info',
    ...over,
  };
}

function projection(rules: ProjectedRule[]): RulesProjection {
  return {
    agentId: 'agt_test',
    fetchedAt: '2026-05-04T00:00:00Z',
    version: 1,
    rules,
  };
}

describe('renderRulesProjection', () => {
  let workspace: string;
  beforeEach(() => { workspace = tempWorkspace(); });
  afterEach(() => { fs.rmSync(workspace, { recursive: true, force: true }); });

  it('writes one mdc per rule into .cursor/rules with our header marker', () => {
    const result = renderRulesProjection(projection([rule({ id: 'guardrail/g1' })]), { workspace });
    expect(result.written).toEqual(['openbox-guardrail-g1.mdc']);
    const content = fs.readFileSync(path.join(result.rulesDir, 'openbox-guardrail-g1.mdc'), 'utf-8');
    expect(content.startsWith('<!-- openbox-managed: do-not-edit -->')).toBe(true);
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('# openbox.id: guardrail/g1');
  });

  it('emits globs frontmatter only when trigger is globMatch', () => {
    const r = rule({ id: 'guardrail/glob1', trigger: 'globMatch', globs: ['src/**/*.ts'] });
    const { rulesDir } = renderRulesProjection(projection([r]), { workspace });
    const content = fs.readFileSync(path.join(rulesDir, 'openbox-guardrail-glob1.mdc'), 'utf-8');
    expect(content).toContain('globs: ["src/**/*.ts"]');
    expect(content).not.toContain('alwaysApply');
  });

  it('agentRequested trigger emits description but no alwaysApply or globs', () => {
    const r = rule({ id: 'policy/p1', source: 'policy', trigger: 'agentRequested' });
    const { rulesDir } = renderRulesProjection(projection([r]), { workspace });
    const content = fs.readFileSync(path.join(rulesDir, 'openbox-policy-p1.mdc'), 'utf-8');
    expect(content).toContain('description:');
    expect(content).not.toContain('alwaysApply');
    expect(content).not.toContain('globs:');
  });

  it('EXHAUSTIVE_SPEC_PROOF: Cursor rules renderer covers every spec rule trigger, severity, and source', () => {
    const rules: ProjectedRule[] = [];
    const expectedTriples = new Set<string>();
    const expectedFiles: string[] = [];
    for (const trigger of GOVERNANCE_SPEC_DOMAINS.ruleTriggers) {
      for (const severity of GOVERNANCE_SPEC_DOMAINS.ruleSeverities) {
        for (const source of GOVERNANCE_SPEC_DOMAINS.projectedRuleSources) {
          expectedTriples.add(`${source}:${trigger}:${severity}`);
          expectedFiles.push(`openbox-${source}-${trigger}-${severity}.mdc`);
          rules.push(rule({
            id: `${source}/${trigger}-${severity}`,
            source: source as ProjectedRule['source'],
            trigger: trigger as ProjectedRule['trigger'],
            severity: severity as ProjectedRule['severity'],
            description: `${source} ${trigger} ${severity}`,
            body: `body for ${source} ${trigger} ${severity}`,
            ...(trigger === 'globMatch' ? { globs: [`src/${source}/**/*`] } : {}),
          }));
        }
      }
    }

    const { rulesDir, written } = renderRulesProjection(projection(rules), { workspace });
    expect(written).toHaveLength(
      GOVERNANCE_SPEC_DOMAINS.ruleTriggers.length *
        GOVERNANCE_SPEC_DOMAINS.ruleSeverities.length *
        GOVERNANCE_SPEC_DOMAINS.projectedRuleSources.length,
    );
    expect([...written].sort()).toEqual([...expectedFiles].sort());
    expect(rules.map((entry) => `${entry.source}:${entry.trigger}:${entry.severity}`).sort()).toEqual(
      [...expectedTriples].sort(),
    );

    const observedTriples = new Set<string>();
    for (const trigger of GOVERNANCE_SPEC_DOMAINS.ruleTriggers) {
      for (const severity of GOVERNANCE_SPEC_DOMAINS.ruleSeverities) {
        for (const source of GOVERNANCE_SPEC_DOMAINS.projectedRuleSources) {
          const file = `openbox-${source}-${trigger}-${severity}.mdc`;
          const content = fs.readFileSync(path.join(rulesDir, file), 'utf-8');
          observedTriples.add(`${source}:${trigger}:${severity}`);
          expect(content).toContain(`# openbox.source: ${source}`);
          expect(content).toContain(`# openbox.severity: ${severity}`);
          expect(content).toContain(`# openbox.id: ${source}/${trigger}-${severity}`);
          if (trigger === 'always') {
            expect(content).toContain('alwaysApply: true');
            expect(content).toContain('description:');
            expect(content).not.toContain('globs:');
          } else if (trigger === 'globMatch') {
            expect(content).toContain(`globs: ["src/${source}/**/*"]`);
            expect(content).toContain('description:');
            expect(content).not.toContain('alwaysApply');
          } else if (trigger === 'agentRequested') {
            expect(content).toContain('description:');
            expect(content).not.toContain('alwaysApply');
            expect(content).not.toContain('globs:');
          } else if (trigger === 'manual') {
            expect(content).not.toContain('description:');
            expect(content).not.toContain('alwaysApply');
            expect(content).not.toContain('globs:');
          } else {
            throw new Error(`Unhandled RuleTrigger ${trigger}`);
          }
        }
      }
    }

    expect([...observedTriples].sort()).toEqual([...expectedTriples].sort());
  });

  it('reruns are idempotent; written list is empty when nothing changed', () => {
    const p = projection([rule({})]);
    const first = renderRulesProjection(p, { workspace });
    expect(first.written.length).toBe(1);
    const second = renderRulesProjection(p, { workspace });
    expect(second.written).toEqual([]);
    expect(second.pruned).toEqual([]);
  });

  it('prunes OpenBox-managed rule files no longer in projection', () => {
    const first = renderRulesProjection(
      projection([rule({ id: 'guardrail/keep' }), rule({ id: 'guardrail/drop' })]),
      { workspace },
    );
    expect(first.written.length).toBe(2);

    const second = renderRulesProjection(
      projection([rule({ id: 'guardrail/keep' })]),
      { workspace },
    );
    expect(second.pruned).toEqual(['openbox-guardrail-drop.mdc']);
    expect(fs.existsSync(path.join(first.rulesDir, 'openbox-guardrail-drop.mdc'))).toBe(false);
    expect(fs.existsSync(path.join(first.rulesDir, 'openbox-guardrail-keep.mdc'))).toBe(true);
  });

  it('does not delete user-authored mdc files even if name starts with openbox-', () => {
    const rulesDir = path.join(workspace, '.cursor', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const userFile = path.join(rulesDir, 'openbox-user-handcrafted.mdc');
    fs.writeFileSync(userFile, '---\nalwaysApply: true\n---\nuser content');

    renderRulesProjection(projection([rule({})]), { workspace });
    expect(fs.existsSync(userFile)).toBe(true);
  });

  it('noPrune skips deletion of stale managed files', () => {
    renderRulesProjection(projection([rule({ id: 'guardrail/stale' })]), { workspace });
    const after = renderRulesProjection(projection([rule({ id: 'guardrail/keep' })]), { workspace, noPrune: true });
    expect(after.pruned).toEqual([]);
    const dir = path.join(workspace, '.cursor', 'rules');
    expect(fs.existsSync(path.join(dir, 'openbox-guardrail-stale.mdc'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'openbox-guardrail-keep.mdc'))).toBe(true);
  });
});
