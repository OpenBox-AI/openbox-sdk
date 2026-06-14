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
    reason: 'OpenBox allowed this governed operations queue review.',
    capability: 'Runtime policy, guardrails, behavior rules, audit trail',
    verdict: 'allow',
  },
  {
    action: 'create_support_ticket',
    title: 'Operations Task',
    reason: 'OpenBox allowed this internal operational action.',
    capability: 'Internal workflow policy',
    verdict: 'allow',
  },
  {
    action: 'send_public_status_update',
    title: 'Public Status Update',
    reason: 'OpenBox allowed this low-sensitivity communication.',
    capability: 'Public-content policy',
    verdict: 'allow',
  },
  {
    action: 'export_governance_identifiers',
    title: 'Send Exception IDs',
    reason:
      'OpenBox blocked drift from governed work into a personal internal-identifier export.',
    capability: 'Goal drift, destination policy',
    verdict: 'block',
  },
  {
    action: 'disable_production_payments',
    title: 'Vendor Bank Update',
    reason: 'OpenBox halted a critical production payment-control change.',
    capability: 'Critical action halt',
    verdict: 'halt',
  },
  {
    action: 'issue_large_refund',
    title: 'Service Credit Approval',
    reason: 'OpenBox requires human approval before issuing this credit memo.',
    capability: 'Human-in-the-loop approval',
    verdict: 'approval',
  },
  {
    action: 'review_data_handoff',
    title: 'Vendor Review Handoff',
    reason:
      'OpenBox checks the selected destination and fields before preparing the handoff.',
    capability: 'Data minimization, destination policy, redaction',
    verdict: 'constrain',
  },
  {
    action: 'submit_manual_request',
    title: 'Manual Escalation Draft',
    reason:
      'OpenBox evaluates the final user-submitted input before execution.',
    capability: 'Manual input governance',
    verdict: 'allow',
  },
  {
    action: 'view_governance_report',
    title: 'Exception Report',
    reason:
      'OpenBox can constrain governed output and replace restricted fields with safe references.',
    capability: 'Guardrails + redaction',
    verdict: 'constrain',
  },
  {
    action: 'draft_policy_constrained_message',
    title: 'Customer Update Draft',
    reason:
      'OpenBox checks the generated draft before it is released to a customer channel.',
    capability: 'Final output governance, guardrails, redaction',
    verdict: 'constrain',
  },
];

export const defaultChoiceOptions: OpenBoxChoiceOption[] = [
  {
    id: 'minimal',
    title: 'Minimal Context',
    description: 'Incident summary and timing only.',
    destination: 'External review workspace',
    audience: 'External reviewer',
    fields: ['summary', 'service_tier', 'timeline', 'owner_note'],
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
    accent: 'border-orange-500/25 bg-orange-500/5',
    dot: 'bg-orange-500',
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
