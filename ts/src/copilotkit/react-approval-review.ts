import React, { useRef, useState } from 'react';
import { verdictStyles } from './react-defaults.js';
import { createOpenBoxApprovalClient } from './react-approval-client.js';
import { OpenBoxHeader } from './react-renderer-header.js';
import type { OpenBoxApprovalReviewProps } from './react-renderer-types.js';
import {
  buttonClass,
  rendererStyle,
  resolveTheme,
  useOpenBoxRendererStyles,
} from './react-utils.js';

export function OpenBoxApprovalReview({
  status,
  respond,
  action,
  request,
  destination,
  amountUsd,
  riskReason,
  workflowId,
  runId,
  activityId,
  approvalId,
  governanceEventId,
  expiresAt,
  approvalEndpoint = '/api/openbox/approvals/decide',
  approvalClient,
  logoSrc,
  theme,
}: OpenBoxApprovalReviewProps) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respondedRef = useRef(false);
  const isPending = status === 'inProgress';

  const decide = async (approved: boolean) => {
    if (!respond || isSubmitting || respondedRef.current) return;
    setError(null);
    setIsSubmitting(true);
    const apiDecision = approved ? 'approve' : 'reject';
    try {
      const client =
        approvalClient ??
        createOpenBoxApprovalClient({ endpoint: approvalEndpoint });
      await client.decide({
        governanceEventId,
        workflowId,
        runId,
        activityId,
        decision: apiDecision,
      });
    } catch {
      setError('Something went wrong. Try again later.');
      setIsSubmitting(false);
      return;
    }

    respondedRef.current = true;
    setDecision(approved ? 'approved' : 'rejected');
    setIsSubmitting(false);
    void respond(
      JSON.stringify({
        nextTool: 'openbox_resume_governed_action',
        mustCallOpenBoxResumeGovernedAction: true,
        approved,
        decision: apiDecision,
        reason: approved
          ? 'Approved by human reviewer and recorded in OpenBox.'
          : 'Rejected by human reviewer and recorded in OpenBox.',
        reviewedAt: new Date().toISOString(),
        workflowId,
        runId,
        activityId,
        approvalId,
        governanceEventId,
        action,
        request,
        destination,
        amountUsd,
      }),
    );
  };

  if (decision) return null;

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
          title: 'Approval Review',
          badge: 'Human Review',
          badgeClassName: verdictStyles.approval.badge,
          reason:
            riskReason ||
            'OpenBox requires approval before this action can continue.',
          busy: isPending,
        }),
      ]),
      h('div', { key: 'body', className: 'px-4 pb-4 pt-0' }, [
        h(
          'div',
          {
            key: 'request',
            className:
              'rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5',
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
              'p',
              {
                key: 'text',
                className: 'mt-1 text-sm leading-5 text-[var(--foreground)]',
              },
              request || 'Approval required',
            ),
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
            expiresAt
              ? h(
                  'div',
                  {
                    key: 'expires',
                    className: 'mt-2 text-xs text-[var(--muted-foreground)]',
                  },
                  `Expires: ${new Date(expiresAt).toLocaleString()}`,
                )
              : null,
          ],
        ),
        error
          ? h(
              'p',
              { key: 'error', className: 'mt-3 text-sm text-red-600' },
              error,
            )
          : null,
      ]),
      h(
        'div',
        {
          key: 'actions',
          className: 'flex gap-2 border-t border-[var(--border)] px-4 py-3',
        },
        [
          h(
            'button',
            {
              key: 'reject',
              type: 'button',
              className: buttonClass('secondary'),
              disabled: !respond || isSubmitting,
              onClick: () => void decide(false),
            },
            isSubmitting ? 'Submitting...' : 'Reject',
          ),
          h(
            'button',
            {
              key: 'approve',
              type: 'button',
              className: buttonClass('primary'),
              disabled: !respond || isSubmitting,
              onClick: () => void decide(true),
            },
            isSubmitting ? 'Submitting...' : 'Approve',
          ),
        ],
      ),
    ],
  );
}

const h = React.createElement;
