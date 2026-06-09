import React from 'react';
import {
  OpenBoxActionResult,
  OpenBoxGovernanceDecision,
} from './react-renderers.js';
import { asNode, asRecord, parseToolResult } from './react-utils.js';
import type { OpenBoxDefaultRenderOptions } from './react-types.js';

export interface OpenBoxCustomMessageRenderer {
  agentId?: string;
  render: React.ComponentType<any> | null;
}

export interface OpenBoxCustomMessageRendererOptions
  extends OpenBoxDefaultRenderOptions {
  agentId?: string;
  renderGovernanceDecision?: (props: Record<string, unknown>) => unknown;
  renderActionResult?: (props: Record<string, unknown>) => unknown;
}

export function createOpenBoxCustomMessageRenderer(
  options: OpenBoxCustomMessageRendererOptions = {},
): OpenBoxCustomMessageRenderer {
  const render = (props: Record<string, unknown>) => {
    const position = String(props.position ?? '');
    if (position !== 'after') return null;
    const message = asRecord(props.message);
    if (message.role !== 'tool') return null;

    const result = message.content;
    const toolResult = parseToolResult(result);
    if (toolResult.schemaVersion !== 'openbox.copilotkit.result.v1') {
      return null;
    }

    const renderProps = {
      name: textValue(message.name) || textValue(toolResult.action),
      status: 'complete',
      parameters: {},
      result,
    };
    const actionResult =
      asNode(options.renderActionResult?.(renderProps)) ??
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
      asNode(options.renderGovernanceDecision?.(renderProps)) ??
        h(OpenBoxGovernanceDecision, {
          ...options,
          key: 'decision',
          status: 'complete',
          parameters: {},
          result,
        }),
      actionResult,
    );
  };

  return {
    agentId: options.agentId,
    render,
  };
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const h = React.createElement;
