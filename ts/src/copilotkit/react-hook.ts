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

// The on_interrupt event's `value` is the (JSON-stringified or parsed) payload
// the agent passed to interrupt(). The CopilotKit convention wraps it in
// `{ __copilotkit_interrupt_value__: { action, args } }`, so unwrap that
// envelope to get the `{ action, args }` we keyed the renderer on.
function interruptValue(event: unknown): Record<string, unknown> {
  let raw: unknown = asRecord(event).value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const record = asRecord(raw);
  const inner = record.__copilotkit_interrupt_value__;
  return inner ? asRecord(inner) : record;
}

export function useOpenBoxCopilotKit(
  options: UseOpenBoxCopilotKitOptions = {},
): UseOpenBoxCopilotKitResult {
  const bindings = options.bindings;
  // Deterministic governance approval is a HOST-driven pause: OpenBox Core
  // returns approval_required and the agent calls langgraph interrupt(), so the
  // card ALWAYS renders (independent of the model). It arrives as an
  // `on_interrupt` event, rendered via useInterrupt — NOT a model-emitted
  // useHumanInTheLoop tool call (which the model could skip). resolve() carries
  // the decision back as the resume value (Command.resume).
  bindings?.useInterrupt?.({
    enabled: (event) =>
      interruptValue(event).action === 'openboxApprovalReview',
    render: (props) => {
      const value = interruptValue(props.event);
      if (options.renderApprovalReview) {
        return options.renderApprovalReview({
          status: 'executing',
          respond: props.resolve,
          args: value.args,
        } as Record<string, unknown>);
      }
      return h(OpenBoxApprovalReview, {
        ...options,
        status: 'executing',
        respond: props.resolve as
          | ((response: string) => void | Promise<void>)
          | undefined,
        ...asRecord(value.args),
      });
    },
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
  bindings?.useDefaultRenderTool({ render: renderGovernedTool });

  return {
    governedToolNames,
    approvalToolName: 'openboxApprovalReview',
    interactiveToolName: 'openboxInteractiveReview',
  };
}

const h = React.createElement;
