import type {
  OpenBoxChoiceOption,
  OpenBoxScenarioDefinition,
  OpenBoxUiVerdict,
} from './react-types.js';

export const governedToolNames = [
  'openbox_governed_action',
  'openbox_governed_approval_action',
  'openbox_resume_governed_action',
];

export const defaultScenarios: OpenBoxScenarioDefinition[] = [
  {
    action: 'open_operations_queue',
    title: 'Operations Queue',
    capability: 'Runtime policy, guardrails, behavior rules, audit trail',
  },
  {
    action: 'create_support_ticket',
    title: 'Operations Task',
    capability: 'Internal workflow policy',
  },
  {
    action: 'send_public_status_update',
    title: 'Public Status Update',
    capability: 'Public-content policy',
  },
  {
    action: 'export_governance_identifiers',
    title: 'Send Exception IDs',
    capability: 'Goal drift, destination policy',
  },
  {
    action: 'disable_production_payments',
    title: 'Vendor Bank Update',
    capability: 'Critical action halt',
  },
  {
    action: 'issue_large_refund',
    title: 'Service Credit Approval',
    capability: 'Human-in-the-loop approval',
  },
  {
    action: 'review_data_handoff',
    title: 'Vendor Review Handoff',
    capability: 'Data minimization, destination policy, redaction',
  },
  {
    action: 'submit_manual_request',
    title: 'Manual Escalation Draft',
    capability: 'Manual input governance',
  },
  {
    action: 'view_governance_report',
    title: 'Exception Report',
    capability: 'Guardrails + redaction',
  },
  {
    action: 'draft_policy_constrained_message',
    title: 'Customer Update Draft',
    capability: 'Final output governance, guardrails, redaction',
  },
];

export const defaultChoiceOptions: OpenBoxChoiceOption[] = [
  {
    id: 'minimal',
    title: 'Minimal Context',
    description: 'Incident summary and timing only.',
    destination: 'External review workspace',
    audience: 'External reviewer',
    fields: ['summary', 'timeline'],
    sensitivity: 'internal',
  },
  {
    id: 'growth',
    title: 'Operational Context',
    description:
      'Adds service impact and owner notes for review.',
    destination: 'External review workspace',
    audience: 'External reviewer',
    fields: [
      'summary',
      'service_tier',
      'timeline',
      'owner_note',
      'impact',
    ],
    sensitivity: 'confidential',
  },
  {
    id: 'sensitive',
    title: 'Full Internal Context',
    description:
      'Includes raw internal context that may be blocked or redacted.',
    destination: 'External review workspace',
    audience: 'External reviewer',
    fields: [
      'summary',
      'service_tier',
      'timeline',
      'owner_note',
      'source_value',
      'internal_context',
    ],
    sensitivity: 'restricted',
  },
];

export const verdictStyles: Record<
  OpenBoxUiVerdict,
  { label: string; badge: string; accent: string; dot: string }
> = {
  reviewing: {
    label: 'Reviewing',
    badge: 'obx-status--reviewing',
    accent:
      'border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--obx-accent,#3B9AF5)]/5',
    dot: 'bg-[var(--obx-accent,#3B9AF5)]',
  },
  allow: {
    label: 'Allowed',
    badge: 'obx-status--allow',
    accent: 'border-emerald-500/25 bg-emerald-500/5',
    dot: 'bg-emerald-500',
  },
  block: {
    label: 'Blocked',
    badge: 'obx-status--block',
    accent: 'border-red-500/25 bg-red-500/5',
    dot: 'bg-red-500',
  },
  rejected: {
    label: 'Rejected',
    badge: 'obx-status--rejected',
    accent: 'border-red-500/25 bg-red-500/5',
    dot: 'bg-red-500',
  },
  halt: {
    label: 'Halted',
    badge: 'obx-status--halt',
    accent: 'border-red-500/25 bg-red-500/5',
    dot: 'bg-red-500',
  },
  approval: {
    label: 'Approval Required',
    badge: 'obx-status--approval',
    accent: 'border-amber-500/25 bg-amber-500/5',
    dot: 'bg-amber-500',
  },
  constrain: {
    label: 'Redacted',
    badge: 'obx-status--constrain',
    accent: 'border-sky-500/25 bg-sky-500/5',
    dot: 'bg-amber-500',
  },
  // Infrastructure failure, NOT a governance decision: OpenBox could not be
  // reached, so the action was not executed (failed closed). This must never
  // present itself as a "Blocked" policy verdict.
  error: {
    label: 'Governance Unavailable',
    badge: 'obx-status--error',
    accent: 'border-[var(--border)] bg-[var(--secondary)]',
    dot: 'bg-[var(--muted-foreground)]',
  },
};
