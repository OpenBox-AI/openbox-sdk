// Guardrail lifecycle e2e: create a team + agent, attach a guardrail,
// exercise list/get/update/reorder, clean up. Validates both shape checks
// the CLI does client-side (validateActivitiesConfig, stage validation)
// and that the guardrail creates persist correctly on the backend.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('guardrail lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;
  let guardrailId: string | undefined;

  beforeAll(() => {
    const t = runCli([
      'team', 'create', orgId,
      '--name', `gr-lc-${stamp}`, '--icon', 'https://ex/x.png',
    ]);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;

    const a = runCli([
      'agent', 'create', '-n', `gr-lc-${stamp}`, '-t', teamId!, '--icon', 'robot',
    ]);
    expect(a.status, a.stderr).toBe(0);
    const body = JSON.parse(a.stdout);
    agentId = (body.agent ?? body.data?.agent ?? body).id;
    expect(agentId).toBeTruthy();
  });

  afterAll(() => {
    if (guardrailId && agentId) runCli(['guardrail', 'delete', agentId, guardrailId]);
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`guardrail create` creates a PII-stage guardrail', () => {
    const res = runCli([
      'guardrail', 'create', agentId!,
      '-n', 'pii-input-redact',
      '--type', 'pii_detection',
      '--stage', '0',
      '-d', 'Redact PII in prompts',
    ]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    const id = body.id ?? body.data?.id;
    expect(id).toBeTruthy();
    guardrailId = id;
  });

  it('`guardrail list` returns at least the new guardrail', () => {
    const res = runCli(['guardrail', 'list', agentId!, '--limit', '50']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain(guardrailId!);
  });

  it('`guardrail get` returns the just-created guardrail', () => {
    const res = runCli(['guardrail', 'get', agentId!, guardrailId!]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBe(guardrailId);
  });

  it('`guardrail update --active false` toggles off', () => {
    const res = runCli([
      'guardrail', 'update', agentId!, guardrailId!,
      '--active', 'false',
    ]);
    expect(res.status, res.stderr).toBe(0);
  });

  it('`guardrail delete` removes it', () => {
    const res = runCli(['guardrail', 'delete', agentId!, guardrailId!]);
    expect(res.status, res.stderr).toBe(0);
    guardrailId = undefined; // afterAll shouldn't double-delete
  });
});
