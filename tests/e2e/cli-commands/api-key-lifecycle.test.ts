// API-key lifecycle e2e: rotate + revoke on a disposable agent. Rotate is
// destructive to the agent's live SDK clients; we run it against a dedicated
// throwaway agent so nothing else depends on the key. Revoke happens last.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('api-key lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;
  let originalToken: string | undefined;

  beforeAll(() => {
    const t = runCli(['team', 'create', orgId, '--name', `key-lc-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;
    const a = runCli(['agent', 'create', '-n', `key-lc-${stamp}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    const body = JSON.parse(a.stdout);
    const agent = body.agent ?? body.data?.agent ?? body;
    agentId = agent.id;
    originalToken = body.token ?? body.data?.token;
    expect(originalToken).toBeTruthy();
  });

  afterAll(() => {
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`api-key rotate` returns a new token that differs from the original', () => {
    const res = runCli(['api-key', 'rotate', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    const newToken = body.token ?? body.data?.token ?? body.api_key ?? body.data?.api_key;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(originalToken);
  });

  it('`api-key revoke` returns success', () => {
    const res = runCli(['api-key', 'revoke', agentId!]);
    expect(res.status, res.stderr).toBe(0);
  });
});
