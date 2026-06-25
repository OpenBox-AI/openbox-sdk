import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockElement = {
  type: unknown;
  props: Record<string, any>;
};

vi.mock('react', () => {
  const Fragment = Symbol.for('react.fragment');
  let stateIndex = 0;
  let stateValues: unknown[] = [];
  let queuedStateValues: unknown[] = [];

  const createElement = (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => ({
    type,
    props: {
      ...(props ?? {}),
      ...(children.length > 0
        ? { children: children.length === 1 ? children[0] : children }
        : {}),
    },
  });
  const useState = (initial: unknown) => {
    const index = stateIndex++;
    if (!(index in stateValues)) {
      stateValues[index] =
        queuedStateValues.length > 0
          ? queuedStateValues.shift()
          : typeof initial === 'function'
            ? (initial as () => unknown)()
            : initial;
    }
    return [
      stateValues[index],
      (next: unknown) => {
        stateValues[index] =
          typeof next === 'function'
            ? (next as (value: unknown) => unknown)(stateValues[index])
            : next;
      },
    ];
  };
  const useRef = (initial: unknown) => ({ current: initial });
  const useEffect = (fn: () => void | (() => void)) => {
    fn();
  };
  const isValidElement = (value: unknown) =>
    Boolean(value && typeof value === 'object' && 'type' in value);
  const reset = () => {
    stateIndex = 0;
    stateValues = [];
    queuedStateValues = [];
  };
  const primeStates = (values: unknown[]) => {
    stateIndex = 0;
    stateValues = [];
    queuedStateValues = [...values];
  };
  const React = {
    Fragment,
    createElement,
    isValidElement,
  };
  return {
    default: React,
    Fragment,
    createElement,
    useState,
    useRef,
    useEffect,
    isValidElement,
    __resetOpenBoxReactMock: reset,
    __primeOpenBoxReactStates: primeStates,
  };
});

function childList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function childrenOf(node: unknown): unknown[] {
  return childList((node as MockElement | undefined)?.props?.children);
}

function walk(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [node];
  const element = node as MockElement;
  const rendered =
    typeof element.type === 'function'
      ? (element.type as (props: Record<string, any>) => unknown)(element.props)
      : undefined;
  return [
    node,
    ...(rendered === undefined ? [] : walk(rendered)),
    ...childrenOf(node).flatMap(walk),
  ];
}

function hasText(node: unknown, text: string): boolean {
  return walk(node).some((item) => typeof item === 'string' && item.includes(text));
}

function findElement(
  node: unknown,
  predicate: (element: MockElement) => boolean,
): MockElement | undefined {
  return walk(node).find(
    (item): item is MockElement =>
      Boolean(item && typeof item === 'object' && predicate(item as MockElement)),
  );
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CopilotKit React renderer coverage', () => {
  beforeEach(async () => {
    const react = await import('react');
    (react as any).__resetOpenBoxReactMock();
  });

  it('renders action result branches with and without custom artifact renderers', async () => {
    const { OpenBoxActionResult } = await import(
      '../../ts/src/copilotkit/react-action-result.ts'
    );

    expect(OpenBoxActionResult({ result: { status: 'blocked' } })).toBeNull();
    expect(
      OpenBoxActionResult({
        result: { status: 'executed', artifact: { ok: true } },
      }),
    ).toBeNull();

    const rendered = OpenBoxActionResult({
      result: {
        status: 'constrained',
        artifact: { type: 'demo', value: 42 },
      },
      artifactRenderers: {
        demo: ({ artifact }) => ({
          type: 'artifact',
          props: { value: artifact.value },
        }) as any,
      },
    }) as MockElement;

    expect(rendered).toBeTruthy();
    expect(walk(rendered).some((item: any) => item?.type === 'artifact')).toBe(true);
  });

  it('renders header logo, text mark, and busy branches', async () => {
    const { OpenBoxHeader } = await import(
      '../../ts/src/copilotkit/react-renderer-header.ts'
    );

    const busy = OpenBoxHeader({
      title: 'Governance review',
      badge: 'Reviewing',
      badgeClassName: 'badge',
      reason: 'Checking.',
      busy: true,
    });
    expect(hasText(busy, '...')).toBe(true);

    const withLogo = OpenBoxHeader({
      title: 'Governance decision',
      badge: 'Allowed',
      badgeClassName: 'badge',
      reason: 'Allowed.',
      logoSrc: '/logo.svg',
    });
    const img = findElement(withLogo, (element) => element.type === 'img');
    expect(img?.props.src).toBe('/logo.svg');
    expect(() => img?.props.onError()).not.toThrow();
  });

  it('submits choice, manual, and already-submitted interactive reviews', async () => {
    const react = await import('react');
    const { OpenBoxInteractiveReview } = await import(
      '../../ts/src/copilotkit/react-interactive-review.ts'
    );

    const respondChoice = vi.fn();
    const choice = OpenBoxInteractiveReview({
      status: 'inProgress',
      respond: respondChoice,
      mode: 'choice',
      fields: ['summary', 'service_tier'],
      choiceOptions: [
        {
          id: 'safe',
          title: 'Safe',
          description: 'Safe package',
          destination: 'Review workspace',
          audience: 'Reviewer',
          fields: ['summary', 'service_tier'],
          sensitivity: 'internal',
        },
      ],
    });
    expect(hasText(choice, 'Choices')).toBe(true);
    findElement(
      choice,
      (element) => element.type === 'button' && hasText(element, 'Submit for Review'),
    )?.props.onClick();
    expect(JSON.parse(respondChoice.mock.calls[0][0])).toMatchObject({
      choiceId: 'safe',
      destination: 'Review workspace',
      mustCallOpenBoxGovernedAction: true,
    });

    const respondManual = vi.fn();
    const manual = OpenBoxInteractiveReview({
      status: 'complete',
      respond: respondManual,
      mode: 'manual',
      manualInput: '  final note  ',
      destination: 'Ops',
      sensitivity: 'low',
    });
    expect(hasText(manual, 'Manual Input')).toBe(true);
    findElement(
      manual,
      (element) => element.type === 'button' && hasText(element, 'Submit for Review'),
    )?.props.onClick();
    expect(JSON.parse(respondManual.mock.calls[0][0])).toMatchObject({
      manualInput: 'final note',
      destination: 'Ops',
      sensitivity: 'low',
    });

    (react as any).__primeOpenBoxReactStates(['minimal', '', true]);
    const submitted = OpenBoxInteractiveReview({
      status: 'complete',
      respond: vi.fn(),
    });
    expect(hasText(submitted, 'Input Sent For Governance')).toBe(true);
  });

  it('submits approval decisions and covers pending, decided, and error branches', async () => {
    const react = await import('react');
    const { OpenBoxApprovalReview } = await import(
      '../../ts/src/copilotkit/react-approval-review.ts'
    );

    const approvalClient = { decide: vi.fn(async () => ({ ok: true })) };
    const respond = vi.fn();
    const review = OpenBoxApprovalReview({
      status: 'inProgress',
      respond,
      approvalClient,
      action: 'issue_large_refund',
      request: 'Refund customer.',
      destination: 'Customer account',
      amountUsd: 2500,
      workflowId: 'workflow-1',
      runId: 'run-1',
      activityId: 'activity-1',
      approvalId: 'approval-1',
      governanceEventId: 'event-1',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    expect(hasText(review, 'Amount: $2,500')).toBe(true);
    findElement(
      review,
      (element) => element.type === 'button' && hasText(element, 'Approve'),
    )?.props.onClick();
    await flushPromises();
    expect(approvalClient.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'approve', governanceEventId: 'event-1' }),
    );
    expect(JSON.parse(respond.mock.calls[0][0])).toMatchObject({
      approved: true,
      decision: 'approve',
      nextTool: 'openbox_resume_governed_action',
    });

    (react as any).__primeOpenBoxReactStates(['approved', false, null]);
    expect(OpenBoxApprovalReview({ status: 'complete', respond: vi.fn() })).toBeNull();

    const failingClient = {
      decide: vi.fn(async () => {
        throw new Error('nope');
      }),
    };
    const failing = OpenBoxApprovalReview({
      status: 'complete',
      respond: vi.fn(),
      approvalClient: failingClient,
      request: '',
      governanceEventId: 'event-fail',
    });
    findElement(
      failing,
      (element) => element.type === 'button' && hasText(element, 'Reject'),
    )?.props.onClick();
    await flushPromises();
    expect(failingClient.decide).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'reject' }),
    );
  });

  it('renders governance decisions across reviewing, error, halted, and redaction branches', async () => {
    const { OpenBoxGovernanceDecision } = await import(
      '../../ts/src/copilotkit/react-governance-decision.ts'
    );

    expect(
      OpenBoxGovernanceDecision({
        status: 'complete',
        result: { status: 'approval_required' },
      }),
    ).toBeNull();

    const halted = vi.fn();
    const decided = OpenBoxGovernanceDecision({
      status: 'complete',
      onSessionHalted: halted,
      scenarios: [
        {
          action: 'custom_action',
          title: 'Custom Action',
          reason: 'Custom scenario reason.',
          capability: 'Runtime policy + HTTP, MCP',
          verdict: 'allow',
        },
      ],
      result: {
        status: 'constrained',
        verdict: 'allow',
        action: 'custom_action',
        request: 'Draft a message.',
        destination: 'Customer',
        amountUsd: 10,
        fields: ['body', 'source_context'],
        riskScore: 0.42,
        trustTier: 2,
        redactionSummary:
          'OpenBox redacted input.0.args.request. OpenBox redacted output.artifact.body.',
        session: {
          status: 'halted',
          haltedAt: '2026-01-01T00:00:00.000Z',
        },
        timings: {
          steps: [
            { key: 'input', label: 'Input policy check', kind: 'openbox', ms: 12 },
            { key: 'work', label: 'Business action', kind: 'tool', ms: 1200 },
            { key: 'ui', label: 'Generate result UI', kind: 'ui', ms: 15 },
          ],
        },
      },
    });
    expect(hasText(decided, 'Governance decision')).toBe(true);
    expect(hasText(decided, 'OpenBox input check')).toBe(true);
    expect(hasText(decided, 'Draft body')).toBe(true);
    expect(halted).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z');

    const reviewing = OpenBoxGovernanceDecision({
      status: 'inProgress',
      parameters: {
        action: 'unknown_action',
        request: 'Review me.',
        destination: 'Ops',
        amountUsd: 5,
        fields: ['id'],
        timings: { totalMs: 1000 },
      },
      result: {},
    });
    expect(hasText(reviewing, 'Governance review')).toBe(true);
    expect(hasText(reviewing, '1.0s elapsed')).toBe(true);

    const error = OpenBoxGovernanceDecision({
      status: 'complete',
      result: { status: 'error', action: '', request: '', riskScore: 0 },
    });
    expect(hasText(error, 'Governance unavailable')).toBe(true);
  });

  it('renders governance redaction labels, timing defaults, and default scenarios', async () => {
    const { OpenBoxGovernanceDecision } = await import(
      '../../ts/src/copilotkit/react-governance-decision.ts'
    );

    const specialRedaction = OpenBoxGovernanceDecision({
      status: 'complete',
      result: {
        status: 'constrained',
        verdict: 'constrain',
        action: 'draft_policy_constrained_message',
        redactionSummary: 'OpenBox redacted output.artifact.sourceContext.',
      },
    });
    expect(
      hasText(
        specialRedaction,
        'OpenBox redacted the sensitive source context used to draft this output.',
      ),
    ).toBe(true);

    const redactionLabels = OpenBoxGovernanceDecision({
      status: 'complete',
      result: {
        status: 'executed',
        verdict: 'allow',
        action: 'unknown_deep_action',
        reason: 'OpenBox allowed this action.',
        redactionSummary:
          'OpenBox redacted input.args.manualInput. OpenBox redacted output.artifact.sourceContext. OpenBox redacted output.artifact.records. OpenBox redacted output.artifact.summary. OpenBox redacted output.artifact.other. OpenBox redacted custom_field.',
      },
    });
    expect(hasText(redactionLabels, 'Edited note')).toBe(true);
    expect(hasText(redactionLabels, 'Source context')).toBe(true);
    expect(hasText(redactionLabels, 'Report rows')).toBe(true);
    expect(hasText(redactionLabels, 'Summary')).toBe(true);
    expect(hasText(redactionLabels, 'Result artifact')).toBe(true);
    expect(hasText(redactionLabels, 'Custom Field')).toBe(true);
    expect(hasText(redactionLabels, 'unknown deep action')).toBe(true);
    expect(
      hasText(
        redactionLabels,
        'OpenBox allowed this action after applying required transformations.',
      ),
    ).toBe(true);

    const noFieldSummary = OpenBoxGovernanceDecision({
      status: 'complete',
      result: {
        status: 'constrained',
        action: '',
        request: '',
        redactionSummary: 'Sensitive data adjusted.',
      },
    });
    expect(hasText(noFieldSummary, 'Sensitive data adjusted.')).toBe(true);
    expect(hasText(noFieldSummary, 'OpenBox governed action')).toBe(true);

    const timed = OpenBoxGovernanceDecision({
      status: 'complete',
      result: {
        status: 'executed',
        action: 'open_operations_queue',
        timings: {
          steps: [
            { key: 'output', label: 'Output policy check', kind: 'openbox', ms: '25' },
            { key: 'openbox', label: 'Already OpenBox labeled', kind: 'openbox', ms: 12000 },
            { key: 'default-key', kind: 'workflow', ms: 5 },
            { key: 'bad-negative', label: 'Bad', kind: 'tool', ms: -1 },
            { key: 'bad-ms', label: 'Bad', kind: 'tool', ms: 'NaN' },
            null,
          ],
        },
      },
    });
    expect(hasText(timed, '12s total')).toBe(true);
    expect(hasText(timed, 'OpenBox output check')).toBe(true);
    expect(hasText(timed, 'OpenBox already OpenBox labeled')).toBe(true);
    expect(hasText(timed, 'default-key')).toBe(true);
  });
});
