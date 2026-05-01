// Behavior rule lifecycle e2e: attach a behavior rule to an agent, exercise
// list/current/get/toggle/versions/delete. Uses a canonical trigger+states
// pair that passes client-side validation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('behavior lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;
  let ruleId: string | undefined;

  beforeAll(() => {
    const t = runCli(['team', 'create', orgId, '--name', `bhv-lc-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;
    const a = runCli(['agent', 'create', '-n', `bhv-lc-${stamp}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    const body = JSON.parse(a.stdout);
    agentId = (body.agent ?? body.data?.agent ?? body).id;
  });

  afterAll(() => {
    if (ruleId && agentId) runCli(['behavior', 'delete', agentId, ruleId]);
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`behavior types` lists canonical triggers', () => {
    const res = runCli(['behavior', 'types']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('http_get');
    expect(res.stdout).toContain('llm_tool_call');
  });

  // SKIP: pending upstream backend fix for X-API-Key behavior-rule create.
  // Backend writes `created_by: user.email` which is undefined under api-key
  // auth, violating a NOT NULL column. Patch ready on openbox-backend
  // bug/api-key-behavior-rule-create-null-created-by; re-enable once that
  // lands on upstream/main.
  it.skip('`behavior create` creates an http_get allow rule', () => {
    const res = runCli([
      'behavior', 'create', agentId!,
      '-n', 'rate-limit-http',
      '--trigger', 'http_get',
      '--states', 'http_get', 'http_post',
      '--window', '60',
      '--verdict', '0',
      '--message', 'allowed by test',
      '--priority', '5',
    ]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    ruleId = body.id ?? body.data?.id;
    expect(ruleId).toBeTruthy();
  });

  // Skipped; depends on `behavior create` ruleId. Same upstream bug.
  it.skip('`behavior list` returns the new rule', () => {
    const res = runCli(['behavior', 'list', agentId!, '--limit', '50']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain(ruleId!);
  });

  // Skipped; depends on `behavior create` ruleId. Same upstream bug.
  it.skip('`behavior current` includes the active rule', () => {
    const res = runCli(['behavior', 'current', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain(ruleId!);
  });

  // Skipped; depends on `behavior create` ruleId. Same upstream bug.
  it.skip('`behavior get` returns the rule detail', () => {
    const res = runCli(['behavior', 'get', agentId!, ruleId!]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBe(ruleId);
  });

  // Skipped; depends on `behavior create` ruleId. Same upstream bug.
  it.skip('`behavior toggle --active false` toggles it off', () => {
    const res = runCli(['behavior', 'toggle', agentId!, ruleId!, '--active', 'false']);
    expect(res.status, res.stderr).toBe(0);
  });
});
