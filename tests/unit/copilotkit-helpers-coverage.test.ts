import { describe, expect, it } from 'vitest';

import type { WorkflowVerdict } from '../../ts/src/core-client/index.ts';
import {
  compactRuntimeValue,
  cloneValue,
  errorMessage,
  errorOutput,
  isRecord,
  mergeMessageContent,
  modelInput,
  objectRecord,
  parseToolResult,
  sameJson,
  sessionKeyFromConfig,
  shouldStopForGate,
  swallow,
  summarizeMessages,
  toPlain,
  toolCallInput,
  truncate,
  withGovernedAssistantOutput,
  withGovernedModelInput,
  withGovernedToolInput,
  workflowIdFromState,
  runIdFromState,
} from '../../ts/src/copilotkit/internal-utils.ts';
import {
  applyCompletedRedaction,
  applyOpenBoxTransform,
  applyStartedRedaction,
  approvalRequiredResult,
  baseResult,
  errorResult,
  executedResult,
  isAllowed,
  mapGuardrailsResult,
  mergedVerdictMetadata,
  normalizeArm,
  resultForAllowedVerdict,
  rejectedResult,
  safePayload,
  safePayloadToCopilotResult,
  stoppedResult,
  verdictMetadata,
} from '../../ts/src/copilotkit/results.ts';

const ids = {
  workflowId: 'workflow-1',
  runId: 'run-1',
  activityId: 'activity-1',
};

const input = {
  action: 'review_queue',
  request: 'Review queue',
  destination: 'ops',
  amountUsd: 10,
  fields: ['id'],
  audience: 'internal',
  sensitivity: 'low',
  approvalId: 'drop-me',
  custom: 'keep-me',
};

function verdict(partial: Partial<WorkflowVerdict>): WorkflowVerdict {
  return {
    arm: 'allow',
    riskScore: 0,
    ...partial,
  };
}

describe('copilotkit helper coverage', () => {
  it('summarizes runtime model input and truncates nested values', () => {
    const messages = [
      { type: 'human', id: '1', name: 'user', content: 'hello' },
      {
        getType: () => 'system',
        content: 'x'.repeat(10_000),
        tool_calls: [{ name: 'ignored' }],
      },
      {
        _getType: () => 'ai',
        content: [
          'visible',
          { _private: 'hidden', nested: { value: 1n, fn: () => null } },
        ],
        toolCalls: Array.from({ length: 40 }, (_, i) => ({ id: i })),
      },
    ];

    const summary = modelInput({
      systemPrompt: 'system'.repeat(2_000),
      messages,
      tools: [
        { name: 'lookup', description: 'desc'.repeat(2_000) },
        null,
      ],
    });

    expect(summary.systemPrompt).toContain('[truncated]');
    expect(summary.messages).toHaveLength(3);
    expect(summary.tools[0]).toMatchObject({ name: 'lookup' });
    expect(summary.tools[0].description).toContain('[truncated]');
    expect(summary.tools[1]).toEqual({
      name: undefined,
      description: undefined,
    });
    expect(modelInput({ messages: 'not-an-array' as any, tools: 'bad' as any })).toEqual({
      systemPrompt: undefined,
      messages: [],
      tools: [],
    });
    expect(
      summarizeMessages(
        Array.from({ length: 12 }, (_, i) => ({
          id: `message-${i}`,
          type: i === 0 ? 'system' : 'human',
          content: `message ${i}`,
        })),
      ).map((message: any) => message.index),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const compact = compactRuntimeValue({
      keep: ['a', 2, true, 3n, () => null],
      _secret: 'hidden',
      deep: { a: { b: { c: { d: { e: 'too deep' } } } } },
    });
    expect(compact).toMatchObject({
      keep: ['a', 2, true, '3', '[Function]'],
    });
    expect(JSON.stringify(compact)).not.toContain('_secret');
    expect(JSON.stringify(compact)).toContain('[MaxDepth]');
    expect(compactRuntimeValue(Symbol('x'))).toBe('Symbol(x)');
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('long-value', 4)).toBe('long...[truncated]');
  });

  it('merges governed model, tool, and assistant payloads across edge shapes', () => {
    const originalMessages = [
      { content: 'old-0', lc_kwargs: { content: 'old-0', other: true } },
      { content: 'old-1' },
      'not-object',
    ];
    const safeMessages = [
      { index: '0', content: 'new-0' },
      { content: 'new-1' },
      { index: 2, content: 'new-2' },
    ];

    expect(mergeMessageContent('nope', safeMessages)).toBe('nope');
    expect(mergeMessageContent(originalMessages, safeMessages)).toEqual([
      { content: 'new-0', lc_kwargs: { content: 'new-0', other: true } },
      { content: 'new-1' },
      { content: 'new-2' },
    ]);
    const governedModelInput = (
      withGovernedModelInput(
        { messages: originalMessages },
        { messages: safeMessages },
      ) as { messages: Array<Record<string, unknown>> }
    );
    expect(governedModelInput.messages[0]).toMatchObject({
      content: 'new-0',
      lc_kwargs: { content: 'new-0', other: true },
    });
    expect(governedModelInput.messages[1]).toMatchObject({ content: 'new-1' });
    expect(governedModelInput.messages[2]).toMatchObject({ content: 'new-2' });
    expect(
      withGovernedModelInput(
        { messages: originalMessages },
        { messages: safeMessages },
        false,
      ),
    ).toEqual({ messages: originalMessages });
    expect(withGovernedModelInput({ messages: originalMessages }, { other: true })).toEqual({
      messages: originalMessages,
    });

    expect(
      withGovernedToolInput(
        { toolCall: { args: { old: true } } },
        { args: { ok: true } },
      ),
    ).toMatchObject({ toolCall: { args: { ok: true } } });
    expect(
      withGovernedToolInput(
        { toolCall: {} },
        { toolCall: { args: { nested: true } } },
      ),
    ).toMatchObject({ toolCall: { args: { nested: true } } });
    expect(withGovernedToolInput({ toolCall: { args: 1 } }, {})).toEqual({ toolCall: { args: 1 } });

    const response = { a: 1 };
    expect(withGovernedAssistantOutput(response, response)).toBe(response);
    expect(withGovernedAssistantOutput(null, { safe: true })).toEqual({ safe: true });
    expect(withGovernedAssistantOutput(response, {})).toBe(response);
    expect(withGovernedAssistantOutput(response, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('normalizes plain values, parse results, session ids, and error helpers', async () => {
    expect(toolCallInput({
      toolCall: { id: 'call-1', name: 'tool', args: { n: 1n } },
      tool: { description: 'does work' },
    })).toEqual({
      id: 'call-1',
      name: 'tool',
      args: { n: '1' },
      description: 'does work',
    });
    expect(parseToolResult('{"ok":true}')).toEqual({ ok: true });
    expect(parseToolResult('{bad json')).toEqual({});
    expect(parseToolResult(null)).toEqual({});
    expect(parseToolResult({ ok: true })).toEqual({ ok: true });

    expect(toPlain(Symbol('s'))).toBe('Symbol(s)');
    expect(toPlain({ _private: 'hidden', value: [1, () => null, 2n] })).toEqual({
      value: [1, '[Function]', '2'],
    });
    expect(toPlain({ a: { b: { c: { d: { e: { f: 'too deep' } } } } } })).toEqual({
      a: { b: { c: { d: { e: '[MaxDepth]' } } } },
    });
    expect(objectRecord('nope')).toEqual({});
    expect(objectRecord({ ok: true })).toEqual({ ok: true });
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(errorOutput(new TypeError('bad'))).toEqual({
      errorName: 'TypeError',
      message: 'bad',
    });
    expect(errorOutput('bad')).toEqual({ message: 'bad' });
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(sessionKeyFromConfig({ configurable: { thread_id: 'a' } })).toBe('a');
    expect(sessionKeyFromConfig({ configurable: { threadId: 'b' } })).toBe('b');
    expect(sessionKeyFromConfig({ thread_id: 'c' })).toBe('c');
    expect(sessionKeyFromConfig({})).toBe('default');
    expect(workflowIdFromState({ openboxSession: { workflowId: 'wf' } })).toBe('wf');
    expect(workflowIdFromState({ openboxWorkflowId: 'legacy-wf' })).toBe('legacy-wf');
    expect(runIdFromState({ openboxSession: { runId: 'run' } })).toBe('run');
    expect(runIdFromState({ openboxRunId: 'legacy-run' })).toBe('legacy-run');
    expect(sameJson({ a: 1 }, { a: 1 })).toBe(true);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sameJson(circular, { self: null })).toBe(false);
    const original = { nested: { value: 1 } };
    const cloned = cloneValue(original);
    expect(cloned).toEqual({ nested: { value: 1 } });
    expect(cloned.nested).not.toBe(original.nested);
    await expect(swallow(async () => {
      throw new Error('telemetry failed');
    })).resolves.toBeUndefined();
  });

  it('maps CopilotKit result branches for availability, halt, constrain, and metadata', () => {
    expect(baseResult(input, ids)).toMatchObject({
      action: 'review_queue',
      destination: 'ops',
      amountUsd: 10,
      custom: 'keep-me',
      workflowId: ids.workflowId,
    });
    expect(baseResult({ action: 'a', request: 'r', fields: 'bad' as any })).toMatchObject({
      destination: null,
      amountUsd: null,
      fields: null,
      audience: null,
      sensitivity: null,
    });

    const allow = verdict({
      arm: 'allow',
      reason: 'allowed',
      riskScore: 0.1,
      trustTier: 2,
      policyId: 'policy-abc',
      behavioralViolations: ['rule-a'],
      constraints: ['mask field'],
      metadata: { evaluator: 'opa' },
      fallbackUsed: false,
    });
    const constrainedBySummary = resultForAllowedVerdict(
      input,
      ids,
      allow,
      { ok: true },
      'ok',
      'redacted field',
    );
    expect(constrainedBySummary).toMatchObject({
      status: 'constrained',
      verdict: 'constrain',
      riskScore: 0.1,
      trustTier: 2,
      policyId: 'policy-abc',
      behavioralViolations: ['rule-a'],
      constraints: ['mask field'],
      metadata: { evaluator: 'opa' },
      fallbackUsed: false,
      redactionSummary: 'redacted field',
    });
    expect(
      resultForAllowedVerdict(
        input,
        ids,
        verdict({ arm: 'constrain', reason: '' }),
        {},
        'ok',
      ),
    ).toMatchObject({
      status: 'constrained',
      verdict: 'constrain',
      reason: 'OpenBox constrained this output.',
    });
    expect(executedResult(input, ids, { ok: true }, 'done')).toMatchObject({
      status: 'executed',
      executed: true,
      session: { status: 'active' },
    });

    expect(
      stoppedResult(input, ids, verdict({ arm: 'halt', reason: 'halt now' })),
    ).toMatchObject({
      status: 'halted',
      verdict: 'halt',
      session: { status: 'halted', reason: 'halt now' },
    });
    expect(
      stoppedResult(
        input,
        ids,
        verdict({ arm: 'block', reason: 'policy unavailable' }),
        true,
      ),
    ).toMatchObject({
      status: 'error',
      verdict: 'error',
      executed: true,
      session: { status: 'active' },
    });
    expect(errorResult(input, ids, new Error('fetch failed'))).toMatchObject({
      status: 'error',
      message: expect.stringContaining('availability failure'),
    });
    expect(
      stoppedResult(input, ids, verdict({ arm: 'block', reason: '' })),
    ).toMatchObject({
      status: 'blocked',
      verdict: 'block',
      session: { status: 'active' },
      reason: 'OpenBox stopped this action.',
    });
    expect(
      stoppedResult(input, ids, verdict({ arm: 'halt', reason: '' })),
    ).toMatchObject({
      status: 'halted',
      session: {
        status: 'halted',
        reason: 'OpenBox halted this conversation.',
      },
    });
    expect(errorResult(input, ids, new Error('business code failed'))).toMatchObject({
      status: 'error',
      message: expect.stringContaining('No business result'),
    });
    expect(verdictMetadata(undefined)).toEqual({
      riskScore: undefined,
      trustTier: undefined,
      policyId: undefined,
      behavioralViolations: undefined,
      constraints: undefined,
      metadata: undefined,
      fallbackUsed: undefined,
      guardrailsResult: undefined,
      ageResult: undefined,
      redactionSummary: undefined,
    });
    expect(
      mergedVerdictMetadata(
        {
          riskScore: 0.4,
          trustTier: 'silver',
          policyId: 'policy-existing',
          behavioralViolations: ['existing-rule'],
          constraints: ['existing-constraint'],
          metadata: { existing: true },
          fallbackUsed: true,
          guardrailsResult: { inputType: 'activity_input' },
          redactionSummary: 'existing',
        } as any,
        { arm: 'allow' } as WorkflowVerdict,
      ),
    ).toMatchObject({
      riskScore: 0.4,
      trustTier: 'silver',
      policyId: 'policy-existing',
      behavioralViolations: ['existing-rule'],
      constraints: ['existing-constraint'],
      metadata: { existing: true },
      fallbackUsed: true,
      guardrailsResult: { inputType: 'activity_input' },
      redactionSummary: 'existing',
    });
  });

  it('maps safe payload and raw guardrail verdict shapes', () => {
    const haltPayload = safePayload(
      { ok: false },
      { ok: false },
      verdict({ arm: 'halt', reason: '' }),
      ids,
      false,
    );
    expect(haltPayload).toMatchObject({
      status: 'halted',
      rawBlocked: true,
      session: { status: 'halted' },
    });
    expect(safePayloadToCopilotResult(verdict({ arm: 'halt' }), haltPayload)).toMatchObject({
      status: 'halted',
      verdict: 'halt',
      artifact: undefined,
    });
    expect(
      safePayload(
        { ok: true },
        { ok: true },
        verdict({ arm: 'allow', reason: '' }),
        ids,
        false,
      ),
    ).toMatchObject({
      status: 'executed',
      rawBlocked: false,
      reason: 'OpenBox allowed this CopilotKit runtime event.',
      session: { status: 'active' },
    });
    expect(
      safePayload(
        { ok: true },
        { ok: false },
        verdict({ arm: 'allow', reason: '' }),
        ids,
        true,
      ),
    ).toMatchObject({
      status: 'constrained',
      changed: true,
    });
    expect(
      safePayload(
        { ok: false },
        { ok: false },
        verdict({ arm: 'require_approval', reason: '' }),
        ids,
        false,
      ),
    ).toMatchObject({
      status: 'approval_required',
      reason: 'OpenBox requires human approval.',
    });

    const unavailable = safePayload(
      { ok: false },
      { ok: false },
      verdict({ arm: 'block', reason: 'guardrail unavailable' }),
      ids,
      false,
    );
    expect(safePayloadToCopilotResult(verdict({ arm: 'block' }), unavailable)).toMatchObject({
      status: 'error',
      verdict: 'error',
    });

    const mapped = mapGuardrailsResult({
      input_type: 'activity_output',
      redacted_input: { output: { secret: '[REDACTED]' } },
      validation_passed: false,
      reasons: [{ type: 'pii', field: 42, reason: null }],
      fieldResults: [{ field: 'a', status: 'block', reason: 'bad' }],
      results: [
        {
          results: [
            { field: 'b', status: 'transformed' },
            { field: 'c', status: 'allow' },
          ],
        },
      ],
    });
    expect(mapped).toEqual({
      inputType: 'activity_output',
      redactedInput: { output: { secret: '[REDACTED]' } },
      validationPassed: false,
      reasons: [{ type: 'pii', field: undefined, reason: '' }],
      fieldResults: [
        { field: 'a', status: 'blocked', reason: 'bad' },
        { field: 'b', status: 'redacted', reason: undefined },
        { field: 'c', status: 'allowed', reason: undefined },
      ],
    });
    expect(mapGuardrailsResult(null)).toBeUndefined();
    expect(
      mapGuardrailsResult({ fieldResults: [{ field: 'x', status: 'unknown' }] }),
    ).toMatchObject({
      inputType: 'activity_input',
      validationPassed: true,
      fieldResults: [{ field: 'x', status: 'skipped' }],
    });
    expect(normalizeArm('continue')).toBe('allow');
    expect(normalizeArm('stop')).toBe('halt');
    expect(normalizeArm('require-approval')).toBe('require_approval');
    expect(normalizeArm(0)).toBe('allow');
    expect(normalizeArm(1)).toBe('constrain');
    expect(normalizeArm(2)).toBe('require_approval');
    expect(normalizeArm(3)).toBe('block');
    expect(normalizeArm(4)).toBe('halt');
    expect(normalizeArm('ask')).toBe('block');
    expect(normalizeArm('halt')).toBe('halt');
    expect(isAllowed('allow')).toBe(true);
    expect(isAllowed('constrain')).toBe(true);
    expect(isAllowed('block')).toBe(false);
    expect(shouldStopForGate({ rawBlocked: true } as any)).toBe(true);
  });

  it('covers approval, rejection, and guardrail redaction result branches', () => {
    const approval = approvalRequiredResult(
      input,
      ids,
      verdict({
        arm: 'require_approval',
        approvalId: 'approval-1',
        governanceEventId: 'event-1',
        approvalExpiresAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(approval).toMatchObject({
      status: 'approval_required',
      verdict: 'require_approval',
      approvalId: 'approval-1',
      governanceEventId: 'event-1',
    });
    expect(rejectedResult(input, ids, verdict({ arm: 'block', reason: '' }))).toMatchObject({
      status: 'rejected',
      verdict: 'block',
      reason: 'OpenBox approval was rejected.',
    });

    const startedVerdict = verdict({
      arm: 'allow',
      guardrailsResult: {
        inputType: 'activity_input',
        redactedInput: { input: [{ args: { request: '[REDACTED]' } }] },
        validationPassed: true,
        reasons: [],
        fieldResults: [{ field: 'args.request', status: 'redacted' }],
      },
    });
    const started = applyStartedRedaction(
      {
        toolName: 'review_queue',
        description: 'Review queue',
      } as any,
      input,
      startedVerdict,
    );
    expect(started.input).toMatchObject({
      action: 'review_queue',
      request: '[REDACTED]',
    });
    expect(started.summary).toContain('args.request');
    expect(
      applyStartedRedaction(
        {
          toolName: 'review_queue',
          description: 'Review queue',
        } as any,
        input,
        verdict({ arm: 'allow' }),
      ),
    ).toEqual({ input });
    expect(
      applyStartedRedaction(
        {
          toolName: 'review_queue',
          description: 'Review queue',
        } as any,
        input,
        verdict({
          arm: 'allow',
          guardrailsResult: {
            inputType: 'activity_input',
            redactedInput: { input: ['not-object'] },
            validationPassed: true,
            reasons: [],
            fieldResults: [{ field: 'args.request', status: 'redacted' }],
          },
        }),
      ).input,
    ).toBe(input);
    expect(
      applyOpenBoxTransform(
        { request: 'secret' },
        verdict({
          arm: 'allow',
          guardrailsResult: {
            inputType: 'activity_input',
            redactedInput: { input: [{ request: '[REDACTED]' }] },
            validationPassed: true,
            reasons: [],
            fieldResults: [{ field: 'request', status: 'redacted' }],
          },
        }),
      ),
    ).toEqual({ request: '[REDACTED]' });

    const completedVerdict = verdict({
      arm: 'allow',
      guardrailsResult: {
        inputType: 'activity_output',
        redactedInput: { output: { artifact: { body: '[REDACTED]' } } },
        validationPassed: true,
        reasons: [],
        fieldResults: [{ field: 'artifact.body', status: 'transformed' as any }],
      },
    });
    const completed = applyCompletedRedaction(
      {
        toolName: 'review_queue',
        description: 'Review queue',
        isArtifactRedacted: (artifact: any) => artifact?.body === '[REDACTED]',
        markArtifactRedacted: (artifact: any) => ({
          ...artifact,
          marked: true,
        }),
      } as any,
      executedResult(input, ids, { body: 'secret' }, 'done'),
      completedVerdict,
      'Input redacted.',
    );
    expect(completed).toMatchObject({
      status: 'constrained',
      verdict: 'constrain',
      artifact: { body: '[REDACTED]', marked: true },
      redactionSummary: expect.stringContaining('Input redacted.'),
    });

    const visibleOnly = applyCompletedRedaction(
      {
        toolName: 'review_queue',
        description: 'Review queue',
        isArtifactRedacted: () => true,
      } as any,
      executedResult(input, ids, { body: 'already redacted' }, 'done'),
      verdict({ arm: 'allow' }),
    );
    expect(visibleOnly).toMatchObject({
      status: 'constrained',
      verdict: 'constrain',
    });
    expect(
      applyCompletedRedaction(
        {
          toolName: 'review_queue',
          description: 'Review queue',
          isArtifactRedacted: () => false,
        } as any,
        executedResult(input, ids, { body: 'plain' }, 'done'),
        verdict({ arm: 'allow', riskScore: 0.2, trustTier: 1 }),
      ),
    ).toMatchObject({
      status: 'executed',
      verdict: 'allow',
      riskScore: 0.2,
      trustTier: 1,
      artifact: { body: 'plain' },
    });
  });
});
