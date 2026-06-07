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
  const hasDecision = Boolean(toolResult.status || toolResult.verdict);
  const verdict = !hasDecision ? 'reviewing' : verdictFromResult(toolResult, scenario);
  const isReviewing = verdict === 'reviewing';
  const styles = verdictStyles[verdict];
  const request =
    textValue(toolResult.request ?? parameters?.request) || 'OpenBox governed action';
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
  const rawReason =
    toolResult.status === 'error'
      ? 'OpenBox is unavailable or returned an error. The governed action was stopped fail-closed.'
      : verdict === 'reviewing'
        ? 'OpenBox is reviewing this before the assistant acts.'
        : textValue(toolResult.reason) || scenario.reason;
  const reason =
    verdict === 'constrain' && /^OpenBox allowed this action\.?$/i.test(rawReason)
      ? 'OpenBox allowed this action after applying required transformations.'
      : rawReason;
  const riskScore =
    typeof toolResult.riskScore === 'number' && toolResult.riskScore > 0
      ? toolResult.riskScore
      : undefined;
  const trustTier = textValue(toolResult.trustTier);
  const redactionSummary = textValue(toolResult.redactionSummary);
  const timings = normalizeTimings(toolResult.timings);

  useEffect(() => {
    if (session.status !== 'halted') return;
    onSessionHalted?.(session.haltedAt);
  }, [onSessionHalted, session.haltedAt, session.status]);

  return h(
    'section',
    {
      className: `obx-governance-card obx-governance-card--${verdict}`,
      style: rendererStyle(resolvedTheme),
    },
    [
      h('div', { key: 'content', className: 'obx-governance-content' }, [
        h(
          'div',
          { key: 'head', className: 'obx-governance-header' },
          h(OpenBoxHeader, {
            key: 'header',
            logoSrc: resolvedTheme.logoSrc,
            title:
              verdict === 'error'
                ? 'Governance unavailable'
                : isReviewing
                  ? 'Governance review'
                  : 'Governance decision',
            badge: styles.label,
            badgeClassName: styles.badge,
            reason,
            busy: isReviewing,
          }),
        ),
        h('div', { key: 'body', className: 'obx-governance-body' }, [
          timings ? renderTimingSummary(timings, isReviewing) : null,
          h(
            'div',
            {
              key: 'request',
              className: 'obx-governance-section obx-governance-request',
            },
            [
              h(
                'div',
                {
                  key: 'label',
                  className: 'obx-section-label',
                },
                'Request',
              ),
              h(
                'p',
                {
                  key: 'text',
                  className: 'obx-request-text',
                },
                request,
              ),
              h(
                'div',
                {
                  key: 'scenario',
                  className: 'obx-meta-row',
                },
                [
                  h('span', { key: 'label' }, 'Workflow'),
                  h('strong', { key: 'value' }, scenario.title),
                ],
              ),
              renderRequestDetails({ amountUsd, destination, fields }),
            ],
          ),
          riskScore !== undefined || trustTier || redactionSummary
            ? h(
                'div',
                {
                  key: 'signals',
                  className: 'obx-governance-section obx-governance-signals',
                },
                [
                  renderSignalMetrics({ riskScore, trustTier }),
                  redactionSummary
                    ? h(
                        'div',
                        { key: 'redaction' },
                        renderRedactionSummary(redactionSummary, action),
                      )
                    : null,
                ],
              )
            : null,
          renderCheckedLine(scenario.capability),
        ]),
      ]),
    ],
  );
}

function renderSignalMetrics({
  riskScore,
  trustTier,
}: {
  riskScore?: number;
  trustTier?: string;
}): React.ReactNode {
  const metrics = [
    riskScore !== undefined
      ? {
          key: 'risk',
          label: 'Risk score',
          value: `${Math.round(riskScore * 100) / 100}`,
        }
      : undefined,
    trustTier ? { key: 'trust', label: 'Trust tier', value: trustTier } : undefined,
  ].filter(
    (item): item is { key: string; label: string; value: string } =>
      Boolean(item),
  );

  if (!metrics.length) return null;
  return h(
    'div',
    { key: 'metrics', className: 'obx-metrics' },
    metrics.map((metric) =>
      h(
        'div',
        {
          key: metric.key,
          className: 'obx-metric',
        },
        [
          h(
            'div',
            {
              key: 'label',
              className: 'obx-metric-label',
            },
            metric.label,
          ),
          h(
            'div',
            {
              key: 'value',
              className: 'obx-metric-value',
            },
            metric.value,
          ),
        ],
      ),
    ),
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

export function verdictFromResult(
  result: Record<string, unknown>,
  scenario: OpenBoxScenarioDefinition,
): OpenBoxUiVerdict {
  if (result.status === 'approval_required') return 'approval';
  if (result.status === 'rejected') return 'rejected';
  // Fail-closed infrastructure errors are not governance decisions; never
  // present them as a policy "Blocked" verdict.
  if (result.status === 'error' || result.verdict === 'error') return 'error';
  if (
    result.status === 'halted' ||
    result.verdict === 'halt'
  )
    return 'halt';
  if (result.status === 'constrained' || result.verdict === 'constrain')
    return 'constrain';
  // An allow verdict whose payload was still transformed by a guardrail is
  // "allowed with redaction"; the card must say Redacted, not plain Allowed.
  if (
    typeof result.redactionSummary === 'string' &&
    result.redactionSummary.length > 0 &&
    (result.status === 'executed' || result.verdict === 'allow')
  ) {
    return 'constrain';
  }
  if (result.status === 'executed' || result.verdict === 'allow')
    return 'allow';
  if (
    result.status === 'blocked' ||
    result.status === 'approval_pending' ||
    result.verdict === 'block'
  ) {
    return 'block';
  }
  if (result.verdict === 'require_approval') return 'approval';
  return 'reviewing';
}

function renderRedactionSummary(
  summary: string,
  action: string,
): React.ReactNode {
  if (
    action === 'draft_policy_constrained_message' &&
    summary.includes('output.artifact.sourceContext')
  ) {
    return 'OpenBox redacted the sensitive source context used to draft this output.';
  }

  const fields = redactedFieldLabels(summary);
  if (fields.length === 0) return summary;
  return h('div', { className: 'obx-redaction' }, [
    h(
      'div',
      { key: 'title', className: 'obx-redaction-title' },
      'Sensitive data adjusted',
    ),
    h(
      'div',
      { key: 'body', className: 'obx-redaction-body' },
      'OpenBox removed or transformed sensitive details before this result was shown.',
    ),
    h(
      'div',
      { key: 'fields', className: 'obx-pill-row' },
      fields.map((field) =>
        h(
          'div',
          {
            key: field,
            className: 'obx-redaction-field',
          },
          [
            h('span', { key: 'label' }, 'Field'),
            h('strong', { key: 'value' }, field),
          ],
        ),
      ),
    ),
  ]);
}

function redactedFieldLabels(summary: string): string[] {
  const matches = Array.from(summary.matchAll(/redacted\s+([A-Za-z0-9_.*[\]-]+(?:\.[A-Za-z0-9_.*[\]-]+)*)/gi));
  const paths = matches.map((match) => match[1]).filter(Boolean);
  const labels = paths.map(redactedFieldLabel);
  return Array.from(new Set(labels));
}

function redactedFieldLabel(path: string): string {
  if (/input\.(?:\d+|\*)\.args\.request|input\.args\.request/.test(path)) {
    return 'Request text';
  }
  if (/input\.(?:\d+|\*)\.args\.manualInput|input\.args\.manualInput/.test(path)) {
    return 'Edited note';
  }
  if (path.includes('output.artifact.sourceContext')) return 'Source context';
  if (path.includes('output.artifact.body')) return 'Draft body';
  if (path.includes('output.artifact.records')) return 'Report rows';
  if (path.includes('output.artifact.summary')) return 'Summary';
  if (path.includes('output.artifact')) return 'Result artifact';
  return path
    .replace(/^input\.(?:\d+|\*)\.args\./, '')
    .replace(/^input\.args\./, '')
    .replace(/^output\.artifact\./, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderRequestDetails({
  amountUsd,
  destination,
  fields,
}: {
  amountUsd?: unknown;
  destination?: string;
  fields?: unknown[];
}): React.ReactNode {
  const details = [
    destination ? { label: 'Destination', value: destination } : undefined,
    typeof amountUsd === 'number' && amountUsd > 0
      ? { label: 'Amount', value: `$${amountUsd.toLocaleString()}` }
      : undefined,
    fields?.length ? { label: 'Fields', value: fields.join(', ') } : undefined,
  ].filter(
    (detail): detail is { label: string; value: string } => Boolean(detail),
  );

  if (!details.length) return null;
  return h(
    'div',
    {
      key: 'details',
      className: 'obx-detail-list',
    },
    details.map((detail) =>
      h(
        'div',
        {
          key: detail.label,
          className: 'obx-detail-row',
        },
        [
          h('span', { key: 'label' }, detail.label),
          h('strong', { key: 'value' }, detail.value),
        ],
      ),
    ),
  );
}

function renderCheckedLine(capability: string): React.ReactNode {
  const items = capability
    .split(/\s*(?:\+|,)\s+/)
    .map((item) => capabilityLabel(item.trim()))
    .filter(Boolean);
  if (!items.length) return null;

  return h(
    'div',
    {
      key: 'checks',
      className: 'obx-governance-section obx-checks',
    },
    [
      h(
        'div',
                {
                  key: 'label',
                  className: 'obx-section-label',
                },
        'Controls',
      ),
      h(
        'div',
        { key: 'items', className: 'obx-check-list' },
        items.map((item) =>
          h(
            'div',
            {
              key: item,
              className: 'obx-check-item',
            },
            item,
          ),
        ),
      ),
    ],
  );
}

function renderTimingSummary(
  timings: NormalizedTimings,
  isReviewing: boolean,
): React.ReactNode {
  return h(
    'div',
    {
      key: 'timings',
      className: 'obx-governance-section obx-timing',
    },
    [
      h(
        'div',
        {
          key: 'total',
          className: 'obx-timing-total',
        },
        [
          h(
            'span',
            { key: 'label' },
            isReviewing ? 'Reviewing' : 'Completed',
          ),
          h(
            'span',
            { key: 'value' },
            `${formatMs(timings.totalMs)} total`,
          ),
        ],
      ),
      ...timings.steps.map((step) =>
        h(
          'p',
          {
            key: step.key,
            className: 'obx-timing-row',
          },
          [
            h('span', { key: 'label' }, humanTimingLabel(step)),
            h(
              'span',
              {
                key: 'value',
              },
              formatMs(step.ms),
            ),
          ],
        ),
      ),
    ],
  );
}

type NormalizedTimingStep = {
  key: string;
  label: string;
  kind: string;
  ms: number;
};

type NormalizedTimings = {
  totalMs: number;
  openBoxMs: number;
  workMs: number;
  steps: NormalizedTimingStep[];
};

function normalizeTimings(value: unknown): NormalizedTimings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const steps = Array.isArray(raw.steps)
    ? raw.steps
        .map(normalizeTimingStep)
        .filter((step): step is NormalizedTimingStep => Boolean(step))
    : [];
  const totalFromValue =
    typeof raw.totalMs === 'number' && Number.isFinite(raw.totalMs)
      ? raw.totalMs
      : undefined;
  const totalMs =
    totalFromValue ?? steps.reduce((sum, step) => sum + step.ms, 0);
  if (!Number.isFinite(totalMs) || (totalMs <= 0 && steps.length === 0)) {
    return undefined;
  }
  const openBoxMs = steps
    .filter((step) => step.kind === 'openbox')
    .reduce((sum, step) => sum + step.ms, 0);
  const workMs = steps
    .filter((step) => step.kind !== 'openbox' && step.kind !== 'workflow')
    .reduce((sum, step) => sum + step.ms, 0);
  return {
    totalMs: Math.max(0, totalMs),
    openBoxMs: Math.max(0, openBoxMs),
    workMs: Math.max(0, workMs),
    steps,
  };
}

function normalizeTimingStep(value: unknown): NormalizedTimingStep | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const ms = typeof raw.ms === 'number' ? raw.ms : Number(raw.ms);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const label = textValue(raw.label) || textValue(raw.key);
  if (!label) return undefined;
  return {
    key: textValue(raw.key) || label,
    label,
    kind: textValue(raw.kind) || 'tool',
    ms,
  };
}

function humanTimingLabel(step: NormalizedTimingStep): string {
  const label = step.label.trim();
  if (/^input policy check$/i.test(label)) return 'OpenBox input check';
  if (/^output policy check$/i.test(label)) return 'OpenBox output check';
  if (/^business action$/i.test(label)) return 'Assistant action';
  if (/^generate result ui$/i.test(label)) return 'Generate result UI';
  if (step.kind === 'openbox' && !/^OpenBox\b/.test(label)) {
    return `OpenBox ${lowercaseFirst(label)}`;
  }
  return label;
}

function capabilityLabel(value: string): string {
  if (!value) return value;
  return value.replace(/\S+/g, (word) => {
    if (/^[A-Z0-9-]+$/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
}

function lowercaseFirst(value: string): string {
  if (!value) return value;
  return value[0].toLowerCase() + value.slice(1);
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}

const h = React.createElement;
