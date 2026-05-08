// LIVE verdict-matrix coverage. The bootstrap plants 6 rules covering
// every numeric verdict the backend emits:
//   verdict 0 (allow)            - no rule fires (file_read)
//   verdict 1 (constrain)        - e2e-constrain-db on database_query
//   verdict 2 (require_approval) - e2e-approve-llm on llm_completion
//   verdict 3 (block)            - e2e-deny-write on file_write
//   verdict 4 (halt)             - e2e-halt-http on http_post
//
// Each test invokes governance.check directly with the matching
// span_type + activity_input and asserts the SDK's verdictToOutcome
// mapping returns the expected tri-state.

import { expect } from '@wdio/globals';

interface Result {
  outcome: 'allow' | 'require_approval' | 'deny' | 'unknown';
  reason?: string;
  approvalId?: string;
  error?: string;
}

async function check(spanType: string, activityInput: Record<string, unknown>): Promise<Result> {
  return browser.executeWorkbench(
    async (vscode: any, st: string, ai: Record<string, unknown>) => {
      return vscode.commands.executeCommand('openbox.__diag.governanceCheck', st, ai);
    },
    spanType,
    activityInput,
  ) as Promise<Result>;
}

async function activate(): Promise<void> {
  await browser.executeWorkbench(async (vscode: any) => {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.openbox');
    } catch {
      /* ignore */
    }
    const ext = vscode.extensions.getExtension('openbox.openbox');
    if (ext && !ext.isActive) await ext.activate();
  });
  await new Promise((r) => setTimeout(r, 2000));
}

describe('LIVE verdicts — full BehaviorVerdict enum matrix', () => {
  before(async () => {
    await activate();
  });

  it('verdict 0 (allow): file_read with no matching rule → outcome allow', async () => {
    const r = await check('file_read', { file_path: '/tmp/whatever-no-rule-fires.txt' });
    expect(r.outcome).toBe('allow');
  });

  it('verdict 1 (constrain): database_query → e2e-constrain-db → outcome allow (score lowered)', async () => {
    const r = await check('db', { query: 'SELECT 1' });
    // verdict 1 maps to 'allow' (with score lowered) per
    // governanceClient.verdictToOutcome.
    expect(r.outcome).toBe('allow');
  });

  it('verdict 2 (require_approval): llm_completion → e2e-approve-llm', async () => {
    const r = await check('llm', { prompt: 'summarize this' });
    expect(r.outcome).toBe('require_approval');
    // approvalId may or may not be returned in the verdict envelope
    // depending on whether core's check_governance materialises a
    // row at verdict time vs. on the first follow-up poll. Either
    // way, the require_approval outcome is the assertion that
    // matters; the approval row visibility is covered by the
    // approvals-view suites.
  });

  it('verdict 3 (block): file_write → e2e-deny-write → outcome deny', async () => {
    const r = await check('file_write', { file_path: '/tmp/blocked.txt' });
    expect(r.outcome).toBe('deny');
    expect(r.reason).toMatch(/e2e-deny-write/);
  });

  it('verdict 4 (halt): http_post → e2e-halt-http → outcome deny', async () => {
    const r = await check('http', {
      method: 'POST',
      url: 'https://example.com/blocked',
    });
    expect(r.outcome).toBe('deny');
    expect(r.reason).toMatch(/e2e-halt-http/);
  });
});
