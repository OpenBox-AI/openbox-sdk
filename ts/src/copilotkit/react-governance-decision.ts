import React, { useEffect } from 'react';
import { defaultScenarios, verdictStyles } from './react-defaults.js';
import { OpenBoxHeader } from './react-renderer-header.js';
import type { OpenBoxGovernanceDecisionProps } from './react-renderer-types.js';
import {
  parseToolResult,
  rendererStyle,
  resolveTheme,
  textValue,
  useOpenBoxRendererStyles,
} from './react-utils.js';
import type {
  OpenBoxScenarioDefinition,
  OpenBoxToolStatus,
  OpenBoxUiVerdict,
} from './react-types.js';

export function OpenBoxGovernanceDecision({
  status,
  parameters,
  result,
  logoSrc,
  theme,
  onSessionHalted,
  scenarios,
}: OpenBoxGovernanceDecisionProps) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const toolResult = parseToolResult(result);
  if (toolResult.status === 'approval_required') return null;
  const action = String(toolResult.action ?? parameters?.action ?? 'unknown');
  const scenario = scenarioFor(action, scenarios);
  const isRunning = status === 'inProgress' || status === 'executing';
  const hasDecision = Boolean(toolResult.status || toolResult.verdict);
  const verdict =
    isRunning && !hasDecision
      ? 'reviewing'
      : verdictFromResult(toolResult, scenario);
  const styles = verdictStyles[verdict];
  const request =
    textValue(toolResult.request ?? parameters?.request) ||
    'OpenBox governed action';
  const destination = textValue(
    toolResult.destination ?? parameters?.destination,
  );
  const amountUsd =
    typeof toolResult.amountUsd === 'number'
      ? toolResult.amountUsd
      : parameters?.amountUsd;
  const fields = Array.isArray(toolResult.fields)
    ? toolResult.fields
    : Array.isArray(parameters?.fields)
      ? parameters.fields
      : undefined;
  const session = parseToolResult(toolResult.session);
  const reason =
    toolResult.status === 'error'
      ? 'OpenBox is unavailable or returned an error. The governed action was stopped fail-closed.'
      : verdict === 'reviewing'
        ? 'OpenBox is evaluating this request before anything executes.'
        : textValue(toolResult.reason) || scenario.reason;
  const riskScore =
    typeof toolResult.riskScore === 'number' && toolResult.riskScore > 0
      ? toolResult.riskScore
      : undefined;
  const trustTier = textValue(toolResult.trustTier);
  const redactionSummary = textValue(toolResult.redactionSummary);

  useEffect(() => {
    if (session.status !== 'halted') return;
    onSessionHalted?.(session.haltedAt);
  }, [onSessionHalted, session.haltedAt, session.status]);

  return h(
    'section',
    {
      className:
        'my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm',
      style: rendererStyle(resolvedTheme),
    },
    [
      h('div', { key: 'head', className: 'p-4 pb-3' }, [
        h(OpenBoxHeader, {
          key: 'header',
          logoSrc: resolvedTheme.logoSrc,
          title: 'Governance Decision',
          badge: styles.label,
          badgeClassName: styles.badge,
          reason,
          busy: isRunning,
        }),
      ]),
      h('div', { key: 'body', className: 'px-4 pb-4 pt-0' }, [
        h(
          'div',
          {
            key: 'request',
            className: `rounded-md border px-3 py-2.5 ${styles.accent}`,
          },
          [
            h(
              'div',
              {
                key: 'meta',
                className: 'flex items-center justify-between gap-2',
              },
              [
                h(
                  'div',
                  {
                    key: 'label',
                    className:
                      'text-[11px] font-semibold uppercase text-[var(--muted-foreground)]',
                  },
                  'Governed Request',
                ),
                h(
                  'div',
                  {
                    key: 'scenario',
                    className:
                      'flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]',
                  },
                  [
                    h('span', {
                      key: 'dot',
                      className: `h-1.5 w-1.5 rounded-full ${styles.dot}`,
                    }),
                    scenario.title,
                  ],
                ),
              ],
            ),
            h(
              'p',
              {
                key: 'text',
                className: 'mt-1 text-sm leading-5 text-[var(--foreground)]',
              },
              request,
            ),
            destination
              ? h(
                  'div',
                  {
                    key: 'destination',
                    className: 'mt-2 text-xs text-[var(--muted-foreground)]',
                  },
                  `Destination: ${destination}`,
                )
              : null,
            typeof amountUsd === 'number' && amountUsd > 0
              ? h(
                  'div',
                  {
                    key: 'amount',
                    className: 'mt-2 text-xs text-[var(--muted-foreground)]',
                  },
                  `Amount: $${amountUsd.toLocaleString()}`,
                )
              : null,
            fields?.length
              ? h(
                  'div',
                  {
                    key: 'fields',
                    className: 'mt-2 text-xs text-[var(--muted-foreground)]',
                  },
                  `Fields: ${fields.join(', ')}`,
                )
              : null,
          ],
        ),
        riskScore !== undefined || trustTier || redactionSummary
          ? h(
              'div',
              {
                key: 'signals',
                className:
                  'mt-3 grid gap-2 rounded-md border border-[var(--obx-accent,#3B9AF5)]/15 bg-[var(--obx-accent,#3B9AF5)]/5 px-3 py-2 text-xs text-[var(--muted-foreground)] sm:grid-cols-2',
              },
              [
                riskScore !== undefined
                  ? h('div', { key: 'risk' }, [
                      h(
                        'span',
                        {
                          key: 'label',
                          className: 'font-medium text-[var(--foreground)]',
                        },
                        'Risk',
                      ),
                      ` ${Math.round(riskScore * 100) / 100}`,
                    ])
                  : null,
                trustTier
                  ? h('div', { key: 'trust' }, [
                      h(
                        'span',
                        {
                          key: 'label',
                          className: 'font-medium text-[var(--foreground)]',
                        },
                        'Trust',
                      ),
                      ` ${trustTier}`,
                    ])
                  : null,
                redactionSummary
                  ? h(
                      'div',
                      { key: 'redaction', className: 'sm:col-span-2' },
                      humanReadableRedactionSummary(redactionSummary, action),
                    )
                  : null,
              ],
            )
          : null,
        h(
          'div',
          {
            key: 'capability',
            className:
              'mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]',
          },
          [
            'Capability: ',
            h(
              'span',
              {
                key: 'value',
                className: 'font-medium text-[var(--foreground)]',
              },
              scenario.capability,
            ),
          ],
        ),
      ]),
      h(
        'div',
        {
          key: 'footer',
          className:
            'flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5',
        },
        [
          h(
            'div',
            {
              key: 'runtime',
              className: 'text-xs text-[var(--muted-foreground)]',
            },
            'OpenBox runtime governance',
          ),
          h(
            'span',
            {
              key: 'status',
              className: 'text-xs text-[var(--muted-foreground)]',
            },
            statusLabel(status, verdict, toolResult),
          ),
        ],
      ),
    ],
  );
}

function scenarioFor(
  action: string,
  scenarios?: OpenBoxScenarioDefinition[],
): OpenBoxScenarioDefinition {
  return (
    scenarios?.find((item) => item.action === action) ??
    defaultScenarios.find((item) => item.action === action) ?? {
      action,
      title: action ? action.replace(/_/g, ' ') : 'Governed Action',
      reason: 'OpenBox evaluated this CopilotKit action.',
      capability: 'Runtime governance',
      verdict: 'allow',
    }
  );
}

function verdictFromResult(
  result: Record<string, unknown>,
  scenario: OpenBoxScenarioDefinition,
): OpenBoxUiVerdict {
  if (result.status === 'approval_required') return 'approval';
  if (result.status === 'rejected') return 'rejected';
  if (
    result.status === 'halted' ||
    result.status === 'session_halted' ||
    result.verdict === 'halt'
  )
    return 'halt';
  if (result.status === 'constrained' || result.verdict === 'constrain')
    return 'constrain';
  if (result.status === 'executed' || result.verdict === 'allow')
    return 'allow';
  if (
    result.status === 'blocked' ||
    result.status === 'approval_pending' ||
    result.status === 'error' ||
    result.verdict === 'block'
  ) {
    return 'block';
  }
  if (result.verdict === 'require_approval') return 'approval';
  return scenario.verdict ?? 'allow';
}

function statusLabel(
  status: OpenBoxToolStatus,
  verdict: OpenBoxUiVerdict,
  result: Record<string, unknown>,
): string {
  if (status === 'inProgress' || status === 'executing') return 'Evaluating';
  if (result.status === 'executed') return 'Complete';
  if (verdict === 'block') return 'Stopped';
  if (verdict === 'rejected') return 'Rejected';
  if (verdict === 'halt') return 'Halted';
  if (verdict === 'approval') return 'Review required';
  if (verdict === 'constrain') return 'Constrained';
  return 'Complete';
}

function humanReadableRedactionSummary(
  summary: string,
  action: string,
): string {
  if (
    action === 'draft_policy_constrained_message' &&
    summary.includes('output.artifact.sourceContext')
  ) {
    return 'OpenBox redacted the sensitive source context used to draft this output.';
  }
  return summary;
}

const h = React.createElement;
