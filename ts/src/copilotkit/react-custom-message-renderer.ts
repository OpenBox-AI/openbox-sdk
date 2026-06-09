import React from 'react';
import { governedToolNames } from './react-defaults.js';
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
    if (position !== 'before' && position !== 'after') return null;
    const message = asRecord(props.message);
    const result = findOpenBoxResult(message, props.stateSnapshot);
    if (!result) return null;
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

function findOpenBoxResult(
  message: Record<string, any>,
  stateSnapshot: unknown,
): unknown {
  if (message.role === 'tool') return message.content;
  if (message.role !== 'assistant') return null;

  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  const openBoxToolCallIds = new Set(
    toolCalls
      .filter((toolCall) => governedToolNames.includes(toolCallName(toolCall)))
      .map((toolCall) => textValue(asRecord(toolCall).id))
      .filter(Boolean),
  );
  if (openBoxToolCallIds.size === 0) return null;

  const snapshot = asRecord(stateSnapshot);
  const snapshotMessages = Array.isArray(snapshot.messages)
    ? snapshot.messages.map(asRecord)
    : [];
  const toolMessage = snapshotMessages.find((item) => {
    if (item.type !== 'tool' && item.role !== 'tool') return false;
    const toolCallId = textValue(item.tool_call_id ?? item.toolCallId);
    return toolCallId && openBoxToolCallIds.has(toolCallId);
  });
  return toolMessage?.content ?? null;
}

function toolCallName(toolCall: unknown): string {
  const record = asRecord(toolCall);
  const fn = asRecord(record.function);
  return textValue(record.name ?? fn.name);
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const h = React.createElement;
