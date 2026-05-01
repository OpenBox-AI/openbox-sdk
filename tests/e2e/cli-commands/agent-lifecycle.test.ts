// Agent lifecycle e2e: create a team, create an agent on it, exercise the
// agent-management surface, clean up. Needs the local backend's KMS bypass
// since agent create mints a signing key.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('agent lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;

  beforeAll(() => {
    const res = runCli([
      'team', 'create', orgId,
      '--name', `agent-lc-${stamp}`,
      '--icon', 'https://example.com/icon.png',
    ]);
    expect(res.status, res.stderr).toBe(0);
    teamId = JSON.parse(res.stdout).id;
    expect(teamId).toBeTruthy();
  });

  afterAll(() => {
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`agent create` returns an agent with an API key', () => {
    const res = runCli([
      'agent', 'create',
      '-n', `agent-lc-${stamp}`,
      '-t', teamId!,
      '--icon', 'robot',
    ]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    // Envelope is either {status, data: {agent, token}} or {agent, token} -
    // the CLI unwraps when possible; assert both shapes.
    const agent = body.agent ?? body.data?.agent ?? body;
    const token = body.token ?? body.data?.token;
    expect(agent.id).toBeTruthy();
    expect(agent.agent_name).toBe(`agent-lc-${stamp}`);
    expect(token).toMatch(/^obx_(test|live)_/);
    agentId = agent.id;
  });

  it('`agent get` returns the just-created agent', () => {
    const res = runCli(['agent', 'get', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBe(agentId);
  });

  it('`agent list` includes the new agent', () => {
    const res = runCli(['agent', 'list', '--limit', '200']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain(agentId!);
  });

  it('`agent update` changes the description', () => {
    const res = runCli([
      'agent', 'update', agentId!,
      '--json', JSON.stringify({ description: 'updated by e2e' }),
    ]);
    expect(res.status, res.stderr).toBe(0);
  });
});
