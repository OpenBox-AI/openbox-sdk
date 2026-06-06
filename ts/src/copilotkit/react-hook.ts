import React from 'react';
import { governedToolNames } from './react-defaults.js';
import {
  OpenBoxActionResult,
  OpenBoxApprovalReview,
  OpenBoxGovernanceDecision,
  OpenBoxInteractiveReview,
} from './react-renderers.js';
import { asNode, asRecord, parseToolResult } from './react-utils.js';
import type {
  UseOpenBoxCopilotKitOptions,
  UseOpenBoxCopilotKitResult,
} from './react-types.js';

export function useOpenBoxCopilotKit(
  options: UseOpenBoxCopilotKitOptions = {},
): UseOpenBoxCopilotKitResult {
  const bindings = options.bindings;
  bindings?.useHumanInTheLoop({
    name: 'openboxApprovalReview',
    description:
      'Show an OpenBox approval UI. After it returns, the assistant must call openbox_resume_governed_action with the returned payload.',
    parameters: options.approvalParameters,
    render:
      options.renderApprovalReview ??
      ((props: Record<string, unknown>) =>
        h(OpenBoxApprovalReview, {
          ...options,
          status: String(props.status ?? ''),
          respond: props.respond as
            | ((response: string) => void | Promise<void>)
            | undefined,
          ...asRecord(props.args),
        })),
  });
  bindings?.useHumanInTheLoop({
    name: 'openboxInteractiveReview',
    description:
      'Collect OpenBox-branded user choices or manual input. After it returns, the assistant must call openbox_governed_action with the returned payload.',
    parameters: options.interactiveParameters,
    render:
      options.renderInteractiveReview ??
      ((props: Record<string, unknown>) =>
        h(OpenBoxInteractiveReview, {
          ...options,
          status: String(props.status ?? ''),
          respond: props.respond as
            | ((response: string) => void | Promise<void>)
            | undefined,
          ...asRecord(props.args),
        })),
  });
  const renderGovernedTool = (props: Record<string, unknown>) => {
    const name = String(props.name ?? '');
    if (!governedToolNames.includes(name)) return undefined;
    if (options.renderGovernedTool) return options.renderGovernedTool(props);
    const status = String(props.status ?? '');
    const result = props.result;
    const parameters = asRecord(props.parameters);
    const toolResult = parseToolResult(result);
    if (
      name === 'openbox_governed_approval_action' &&
      toolResult.status === 'approval_required'
    ) {
      return null;
    }
    const actionResult =
      asNode(options.renderActionResult?.(props)) ??
      (options.artifactRenderers
        ? h(OpenBoxActionResult, {
            ...options,
            key: 'result',
            result,
          })
        : null);
    return h(
      React.Fragment,
      null,
      asNode(options.renderGovernanceDecision?.(props)) ??
        h(OpenBoxGovernanceDecision, {
          ...options,
          key: 'decision',
          status,
          parameters,
          result,
        }),
      actionResult,
    );
  };
  if (bindings?.useRenderTool) {
    for (const name of governedToolNames) {
      bindings.useRenderTool({ name, render: renderGovernedTool });
    }
  } else {
    bindings?.useDefaultRenderTool({ render: renderGovernedTool });
  }

  return {
    governedToolNames,
    approvalToolName: 'openboxApprovalReview',
    interactiveToolName: 'openboxInteractiveReview',
  };
}

const h = React.createElement;
