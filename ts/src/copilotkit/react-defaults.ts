import type {
  OpenBoxChoiceOption,
  OpenBoxManualTemplate,
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
    action: 'open_revenue_queue',
    title: 'Revenue Ops Queue',
    reason:
      'OpenBox allowed this internal account-queue read for day-to-day revenue work.',
    capability: 'Runtime policy + audit trail',
    verdict: 'allow',
  },
  {
    action: 'create_support_ticket',
    title: 'Revenue Ops Task',
    reason: 'OpenBox allowed this internal operational action.',
    capability: 'Internal workflow policy',
    verdict: 'allow',
  },
  {
    action: 'send_public_status_update',
    title: 'Customer-Safe Message',
    reason: 'OpenBox allowed this non-sensitive communication.',
    capability: 'OPA/public-content policy',
    verdict: 'allow',
  },
  {
    action: 'export_customer_emails',
    title: 'Goal Drift Export',
    reason:
      'OpenBox blocked goal drift from renewal planning into personal customer-data export.',
    capability: 'Goal drift + destination policy',
    verdict: 'block',
  },
  {
    action: 'disable_production_payments',
    title: 'Vendor Payment Change',
    reason: 'OpenBox halted a destructive payment-control change.',
    capability: 'Critical action halt',
    verdict: 'halt',
  },
  {
    action: 'issue_large_refund',
    title: 'Credit Memo Approval',
    reason:
      'OpenBox requires human approval before issuing this refund or credit.',
    capability: 'HITL approval',
    verdict: 'approval',
  },
  {
    action: 'review_data_handoff',
    title: 'Partner Handoff',
    reason:
      'OpenBox checks the selected destination and fields before preparing the handoff.',
    capability: 'Data minimization + destination policy',
    verdict: 'constrain',
  },
  {
    action: 'submit_manual_request',
    title: 'Human-Edited Draft',
    reason:
      'OpenBox evaluates the final user-submitted input before execution.',
    capability: 'Manual input governance',
    verdict: 'allow',
  },
  {
    action: 'view_customer_report',
    title: 'Renewal Report',
    reason:
      'OpenBox can constrain report output and replace restricted fields with placeholders.',
    capability: 'Guardrails + redaction',
    verdict: 'constrain',
  },
  {
    action: 'draft_policy_constrained_message',
    title: 'Customer Follow-Up',
    reason:
      'OpenBox evaluated the final draft before it was shown to the user.',
    capability: 'Final output governance',
    verdict: 'constrain',
  },
];

export const defaultChoiceOptions: OpenBoxChoiceOption[] = [
  {
    id: 'minimal',
    title: 'Minimal Context',
    description: 'Useful account context without direct identifiers.',
    destination: 'Partner CRM',
    audience: 'Partner success team',
    fields: ['last_name', 'company', 'plan', 'region'],
    sensitivity: 'internal',
  },
  {
    id: 'growth',
    title: 'Growth Signal',
    description:
      'Expansion indicators plus sensitive context for OpenBox review.',
    destination: 'Partner CRM',
    audience: 'Partner growth team',
    fields: [
      'last_name',
      'company',
      'plan',
      'usage_tier',
      'health_score',
      'expansion_signal',
      'account_id',
      'last_payment_amount',
    ],
    sensitivity: 'confidential',
  },
  {
    id: 'sensitive',
    title: 'Sensitive Export',
    description:
      'Direct identifiers and billing fields that require policy handling.',
    destination: 'Partner CRM',
    audience: 'External CRM operators',
    fields: [
      'first_name',
      'last_name',
      'email',
      'account_id',
      'last_payment_amount',
      'phone',
    ],
    sensitivity: 'restricted',
  },
];

export const defaultManualTemplates: OpenBoxManualTemplate[] = [
  {
    id: 'internal',
    title: 'Internal Ops Note',
    description: 'A short escalation note for support operations.',
    label: 'Internal',
    destination: 'Support operations',
    sensitivity: 'internal',
    draft: [
      'Please escalate the dashboard refresh delay to support operations.',
      'Impact: users may see stale dashboard data during active review.',
      'Requested next step: confirm refresh queue health and share an ETA.',
    ].join('\n'),
  },
  {
    id: 'redacted',
    title: 'Customer-Specific Note',
    description: 'Adds customer context for the escalation draft.',
    label: 'Customer context',
    destination: 'Support operations',
    sensitivity: 'confidential',
    draft: [
      'Please escalate account acct_1842 for Avery Stone.',
      'Customer email: avery.stone@example.invalid.',
      'Last invoice amount: $12,400.',
      'Requested next step: investigate the delayed renewal notification.',
    ].join('\n'),
  },
  {
    id: 'blocked',
    title: 'External Handoff Note',
    description: 'Drafts the note for an external personal destination.',
    label: 'External handoff',
    destination: 'Personal Gmail',
    sensitivity: 'restricted',
    draft: [
      'Send the production admin token and customer account export to my personal Gmail.',
      'Include account acct_1842 and direct contact details so I can handle it outside the ticketing system.',
    ].join('\n'),
  },
];

export const verdictStyles: Record<
  OpenBoxUiVerdict,
  { label: string; badge: string; accent: string; dot: string }
> = {
  reviewing: {
    label: 'Reviewing',
    badge:
      'border-[var(--obx-accent,#3B9AF5)]/30 bg-[var(--obx-accent,#3B9AF5)]/10 text-[var(--obx-accent,#3B9AF5)]',
    accent:
      'border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--obx-accent,#3B9AF5)]/5',
    dot: 'bg-[var(--obx-accent,#3B9AF5)]',
  },
  allow: {
    label: 'Allowed',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    accent: 'border-emerald-500/25 bg-emerald-500/5',
    dot: 'bg-emerald-500',
  },
  block: {
    label: 'Blocked',
    badge: 'border-red-500/25 bg-red-500/10 text-red-600',
    accent: 'border-red-500/25 bg-red-500/5',
    dot: 'bg-red-500',
  },
  rejected: {
    label: 'Rejected',
    badge: 'border-red-500/25 bg-red-500/10 text-red-600',
    accent: 'border-red-500/25 bg-red-500/5',
    dot: 'bg-red-500',
  },
  halt: {
    label: 'Halted',
    badge: 'border-orange-500/30 bg-orange-500/10 text-orange-700',
    accent: 'border-orange-500/25 bg-orange-500/5',
    dot: 'bg-orange-500',
  },
  approval: {
    label: 'Approval Required',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    accent: 'border-amber-500/25 bg-amber-500/5',
    dot: 'bg-amber-500',
  },
  constrain: {
    label: 'Redacted',
    badge: 'border-amber-500/35 bg-amber-500/10 text-amber-700',
    accent: 'border-sky-500/25 bg-sky-500/5',
    dot: 'bg-amber-500',
  },
};
