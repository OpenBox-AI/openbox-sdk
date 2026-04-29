// Coverage for ts/src/cli/commands/verify.ts. The verify command is a
// hand-written static linter over governance-integration TS files; it
// scans for ~20 rules (non-canonical event types, missing X-Openbox-Client
// header, hardcoded UUIDs, etc.) defined inline.
//
// Existing fixture set under tests/fixtures/verify-samples/verify/ is
// the source of truth for "which rules MUST fire on which file".
// expected.json declares it. We drive registerVerifyCommand against
// each fixture in --json mode and assert the manifest holds.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'verify-samples', 'verify');
const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, 'expected.json'), 'utf-8'));

interface VerifyFinding {
  severity: 'error' | 'warn' | 'info';
  rule: string;
  file: string;
  line: number;
  snippet: string;
  message: string;
  fix?: string;
}

interface VerifyJson {
  root: string;
  scanned: number;
  findings: VerifyFinding[];
}

async function runVerify(targetPath: string): Promise<VerifyJson> {
  const { registerVerifyCommand } = await import('../../ts/src/cli/commands/verify');
  const program = new Command();
  program.exitOverride();
  registerVerifyCommand(program);

  const log: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: any[]) => log.push(a.join(' '));
  console.error = () => {};

  // verify exits with bailWith(EXIT.GENERIC) when severity threshold
  // is breached. tests/setup.ts has OPENBOX_ASSUME_YES set, but the
  // process.exit call still fires - wrap it to capture cleanly.
  const origExit = process.exit;
  let exitCode: number | undefined;
  (process as any).exit = ((code?: number) => {
    exitCode = code;
    throw new Error('process.exit:' + code);
  }) as never;

  try {
    await program.parseAsync(['node', 'openbox', 'verify', targetPath, '--json']);
  } catch (e) {
    // Either commander's exitOverride or our process.exit shim - both
    // expected. Coverage doesn't care; we want the linter to have run.
  } finally {
    console.log = origLog;
    console.error = origErr;
    (process as any).exit = origExit;
  }

  // Find the JSON line in the captured stdout.
  for (const line of log) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return JSON.parse(trimmed) as VerifyJson;
    }
  }
  throw new Error('verify did not emit JSON to stdout. Captured: ' + JSON.stringify(log));
}

describe('verify command - coverage via fixture suite', () => {
  it('clean.ts has no findings (or no errors)', async () => {
    const result = await runVerify(join(FIXTURE_DIR, 'clean.ts'));
    expect(result.scanned).toBe(1);
    const errors = result.findings.filter((f) => f.severity === 'error');
    expect(errors.length).toBe(0);
  });

  for (const [fixtureName, manifest] of Object.entries(expected) as Array<
    [string, { must_fire: string[]; must_fire_at_line?: Record<string, number> }]
  >) {
    it(`${fixtureName} - every must_fire rule produces a finding`, async () => {
      const result = await runVerify(join(FIXTURE_DIR, fixtureName));
      const ruleNames = new Set(result.findings.map((f) => f.rule));
      for (const required of manifest.must_fire) {
        expect(ruleNames, `${fixtureName} did not fire ${required}; got rules: ${[...ruleNames].join(', ')}`).toContain(required);
      }
      // Optional: must_fire_at_line for line-precision rules.
      if (manifest.must_fire_at_line) {
        for (const [rule, line] of Object.entries(manifest.must_fire_at_line)) {
          const hit = result.findings.find((f) => f.rule === rule);
          expect(hit, `${fixtureName}: ${rule} not present`).toBeDefined();
          expect(hit?.line, `${fixtureName}: ${rule} expected line ${line}`).toBe(line);
        }
      }
    });
  }

  it('verify against a directory walks all .ts files', async () => {
    const result = await runVerify(FIXTURE_DIR);
    expect(result.scanned).toBeGreaterThan(1);
  });

  it('hardcoded-uuid rule fires when path is NOT a fixture/test/spec', async () => {
    // The rule's appliesTo filter intentionally skips paths matching
    // `test|spec|fixture|seed|examples?/`, which means our verify-samples
    // fixtures self-suppress that rule. To still exercise the detect()
    // closure for coverage, we copy the bad fixture content into a TMP
    // path that doesn't match the skip pattern.
    const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-verify-real-'));
    try {
      const dst = join(tmp, 'agent-config.ts');
      const sample = `
        const AGENT_ID = 'fdf0718b-b3e8-4c68-b33a-136f6da1d156';
        const TEAM_ID = 'a1b2c3d4-5555-6666-7777-888899990000';
        export { AGENT_ID, TEAM_ID };
      `;
      writeFileSync(dst, sample);
      const result = await runVerify(dst);
      const ruleNames = new Set(result.findings.map((f) => f.rule));
      expect(ruleNames).toContain('hardcoded-uuid');
    } finally {
      if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    }
  });
});
