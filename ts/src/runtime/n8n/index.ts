import { randomBytes } from 'node:crypto';
import type {
  GovernedPayload,
  N8nSession,
  WorkflowVerdict,
} from '../../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../../core-client/generated/govern.js';
import { EVENT } from '../../governance/events.js';
import { objectRecord as recordFrom, arrayFrom } from '../../internal/records.js';
import type { LLMTokenUsage } from '../../governance/spans.js';
import {
  buildSpan,
  stripServerComputedSemantic,
  withOpenBoxActivityMetadata,
  withSpanActivityId,
  type SpanInput,
  type SpanType,
} from '../../governance/spans.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../../governance/assistant-output.js';
import { N8N_INTEGRATION_SURFACE } from '../../governance/capability-matrix.js';
import { stampSource } from '../../approvals/source.js';

export const OPENBOX_N8N_INTEGRATION = N8N_INTEGRATION_SURFACE;

export type OpenBoxN8nIntegrationSurface = typeof OPENBOX_N8N_INTEGRATION;
export type OpenBoxN8nCredentialDescriptor = OpenBoxN8nIntegrationSurface['credentials'][number];
export type OpenBoxN8nNodeDescriptor = OpenBoxN8nIntegrationSurface['nodes'][number];
export type OpenBoxN8nWorkflowTemplateDescriptor =
  OpenBoxN8nIntegrationSurface['workflowTemplates'][number];
export type OpenBoxN8nExampleDescriptor = OpenBoxN8nIntegrationSurface['examples'][number];
export type OpenBoxN8nIntegrationDiagnosticStatus = 'pass' | 'fail';

export interface OpenBoxN8nIntegrationDiagnosticCheck {
  name: string;
  status: OpenBoxN8nIntegrationDiagnosticStatus;
  detail: string;
  remediation?: string;
}

export interface N8nUserPromptSignalOptions {
  nodeName?: string;
  sessionId?: string;
}

export interface N8nNodePreExecutePayloadInput {
  activityId?: string;
  input?: Record<string, unknown>;
  nodeName?: string;
  sessionId?: string;
  prompt?: string;
}

export interface N8nLlmCompletionPayloadInput {
  activityId?: string;
  text: string;
  input?: Record<string, unknown>;
  prompt?: string;
  model?: string;
  usage?: LLMTokenUsage;
  requestBody?: unknown;
  responseBody?: unknown;
  providerUrl?: string;
  actualProviderUrl?: string;
  provider?: string;
  nodeName?: string;
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  durationNs?: number;
  hasToolCalls?: boolean;
}

export interface N8nNodePostExecutePayloadInput {
  activityId?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  prompt?: string;
  nodeName?: string;
  sessionId?: string;
  status?: string;
  error?: unknown;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
}

export interface N8nGovernanceCheckPayloadInput {
  activityId?: string;
  spanType: SpanType;
  activityInput: SpanInput & Record<string, unknown>;
  nodeName?: string;
  sessionId?: string;
  prompt?: string;
}

type SignalCapableN8nSession = Pick<N8nSession, 'activity'>;
type NodePreExecuteCapableN8nSession = Pick<N8nSession, 'activity' | 'openActivity'>;
type NodePostExecuteCapableN8nSession = Pick<N8nSession, 'nodePostExecute'>;
type GovernanceCheckCapableN8nSession = Pick<N8nSession, 'nodePreExecute'>;

interface PendingNodeActivity {
  activityId: string;
  startTime: number;
}

function descriptorById<T extends Readonly<Record<string, unknown>>>(
  items: readonly T[],
  id: string,
): T | undefined {
  return items.find((entry) => entry.id === id);
}

export function listOpenBoxN8nCredentials(): readonly OpenBoxN8nCredentialDescriptor[] {
  return OPENBOX_N8N_INTEGRATION.credentials;
}

export function listOpenBoxN8nNodes(): readonly OpenBoxN8nNodeDescriptor[] {
  return OPENBOX_N8N_INTEGRATION.nodes;
}

export function listOpenBoxN8nWorkflowTemplates(): readonly OpenBoxN8nWorkflowTemplateDescriptor[] {
  return OPENBOX_N8N_INTEGRATION.workflowTemplates;
}

export function listOpenBoxN8nExamples(): readonly OpenBoxN8nExampleDescriptor[] {
  return OPENBOX_N8N_INTEGRATION.examples;
}

export function getOpenBoxN8nCredential(
  id = 'openboxCredentials',
): OpenBoxN8nCredentialDescriptor | undefined {
  return descriptorById(OPENBOX_N8N_INTEGRATION.credentials, id);
}

export function getOpenBoxN8nNode(id: string): OpenBoxN8nNodeDescriptor | undefined {
  return descriptorById(OPENBOX_N8N_INTEGRATION.nodes, id);
}

export function getOpenBoxN8nWorkflowTemplate(
  id: string,
): OpenBoxN8nWorkflowTemplateDescriptor | undefined {
  return descriptorById(OPENBOX_N8N_INTEGRATION.workflowTemplates, id);
}

export function getOpenBoxN8nExample(id: string): OpenBoxN8nExampleDescriptor | undefined {
  return descriptorById(OPENBOX_N8N_INTEGRATION.examples, id);
}

export function verifyOpenBoxN8nIntegrationSurface(
  surface: OpenBoxN8nIntegrationSurface = OPENBOX_N8N_INTEGRATION,
): OpenBoxN8nIntegrationDiagnosticCheck[] {
  const nodeIds = new Set(surface.nodes.map((node) => String(node.id)));
  const packageNodeIds = arrayOfStrings(
    recordFrom(surface.packageManifest).openboxSpecNodeIds,
  );
  return [
    descriptorListCheck('credentials', surface.credentials, 'OpenBox credential descriptor'),
    descriptorListCheck('nodes', surface.nodes, 'OpenBox n8n node descriptor'),
    descriptorListCheck('workflow-templates', surface.workflowTemplates, 'OpenBox workflow template'),
    descriptorListCheck('examples', surface.examples, 'OpenBox example workflow'),
    {
      name: 'package-node-ids',
      status:
        packageNodeIds.length > 0 &&
        packageNodeIds.every((nodeId) => nodeIds.has(nodeId))
          ? 'pass'
          : 'fail',
      detail: `package manifest references ${packageNodeIds.length} OpenBox node ids.`,
      remediation: 'Regenerate the n8n package manifest from the TypeSpec integration surface.',
    },
    {
      name: 'workflow-template-content',
      status: surface.workflowTemplates.every((template) =>
        arrayFrom(recordFrom(template.workflow).nodes).length > 0)
        ? 'pass'
        : 'fail',
      detail: 'Workflow templates include executable n8n nodes.',
      remediation: 'Regenerate workflow templates so each template carries at least one node.',
    },
    {
      name: 'showcase-workflows',
      status: surface.showcaseWorkflows.length > 0 &&
        surface.showcaseWorkflows.every((workflow) =>
          workflow.requiredOpenBoxNodeTypes.length > 0 &&
          workflow.requiredCheckpoints.length > 0)
        ? 'pass'
        : 'fail',
      detail: `Found ${surface.showcaseWorkflows.length} showcase workflow specifications.`,
      remediation: 'Regenerate showcase workflow specifications from TypeSpec.',
    },
  ];
}

const N8N_NODE_TOOL_TYPE = 'n8n_node';
const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const n8nActivity = PRESET_ACTIVITY_TYPES.n8n;
const pendingNodeActivities = new WeakMap<object, Map<string, PendingNodeActivity>>();

function cleanRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next || undefined;
}

function nodeToolTelemetry(nodeName: string | undefined): Pick<GovernedPayload, 'toolName' | 'toolType'> {
  return {
    toolName: trimmed(nodeName),
    toolType: N8N_NODE_TOOL_TYPE,
  };
}

function nodeActivityInput(record: Record<string, unknown>): unknown[] {
  return withOpenBoxActivityMetadata(
    [stampSource(cleanRecord(record), 'n8n')],
    { toolType: N8N_NODE_TOOL_TYPE },
  ) as unknown[];
}

function nodeToolAttributes(nodeName: string | undefined): Record<string, unknown> {
  const toolName = trimmed(nodeName);
  return cleanRecord({
    'openbox.tool.name': toolName,
    'tool.name': toolName,
    tool_name: toolName,
    'openbox.tool.type': N8N_NODE_TOOL_TYPE,
  });
}

function nowUnixNano(): number {
  return Date.now() * 1_000_000;
}

function timeToUnixNano(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const timestamp = Math.trunc(value);
  return timestamp > 0 && timestamp < 100_000_000_000_000
    ? timestamp * 1_000_000
    : timestamp;
}

function arrayOfStrings(value: unknown): string[] {
  return arrayFrom(value).filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
}

function descriptorListCheck(
  name: string,
  items: readonly Record<string, unknown>[],
  label: string,
): OpenBoxN8nIntegrationDiagnosticCheck {
  const missingIds = items.filter((item) => typeof item.id !== 'string' || item.id.trim() === '');
  return {
    name,
    status: items.length > 0 && missingIds.length === 0 ? 'pass' : 'fail',
    detail: `${items.length} ${label}${items.length === 1 ? '' : 's'} declared.`,
    remediation:
      items.length > 0 && missingIds.length === 0
        ? undefined
        : `Regenerate ${label} entries from the TypeSpec n8n integration surface.`,
  };
}

function errorDescription(value: unknown): string | undefined {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value === undefined || value === null) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function nodePostExecuteOutput(input: N8nNodePostExecutePayloadInput): Record<string, unknown> {
  const output = recordFrom(input.output);
  return stampSource(cleanRecord({
    ...(Object.keys(output).length > 0 ? output : { result: input.output }),
    event_category: 'node_post_execute',
    node_name: input.nodeName,
    status: input.status,
    error: input.error,
  }), 'n8n');
}

function nodeExecutionSpan(input: N8nNodePostExecutePayloadInput) {
  const toolName = trimmed(input.nodeName) ?? 'n8n_node';
  const startTime = timeToUnixNano(input.startTime) ?? nowUnixNano();
  const endTime = timeToUnixNano(input.endTime) ?? nowUnixNano();
  const error = errorDescription(input.error);
  return stripServerComputedSemantic({
    span_id: randomBytes(8).toString('hex'),
    trace_id: randomBytes(16).toString('hex'),
    name: `n8n.${toolName}`,
    // Canonical function_call spans are INTERNAL (tracing.py); 'tool' is not a
    // valid OTel SpanKind. Also carry the canonical function/module/args that
    // this hand-built node span was missing.
    kind: 'INTERNAL',
    span_type: 'function',
    hook_type: 'function_call',
    function: toolName,
    module: 'n8n',
    args: input.input,
    start_time: startTime,
    end_time: endTime,
    duration_ns: input.durationMs !== undefined
      ? Math.max(0, Math.trunc(input.durationMs * 1_000_000))
      : Math.max(0, endTime - startTime),
    status: { code: error ? 'ERROR' : 'UNSET', description: error ?? null },
    events: [],
    error: error ?? null,
    stage: 'completed',
    attributes: cleanRecord({
      'gen_ai.system': 'n8n',
      'openbox.n8n.node_name': input.nodeName,
      'openbox.span_type': 'function',
      ...nodeToolAttributes(toolName),
    }),
    data: cleanRecord({
      source: 'n8n',
      node_name: input.nodeName,
      status: input.status,
      error: input.error,
      input: input.input,
      output: input.output,
    }),
    result: input.output,
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

function nodeActivityKey(input: {
  activityId?: string;
  sessionId?: string;
  nodeName?: string;
  prompt?: string;
  input?: Record<string, unknown>;
}): string {
  if (input.activityId?.trim()) return `activity:${input.activityId.trim()}`;
  return [
    input.sessionId?.trim() || 'no-session',
    input.nodeName?.trim() || 'no-node',
    input.prompt?.trim() || 'no-prompt',
    stableStringify(input.input ?? null),
  ].join(':');
}

function rememberNodeActivity(
  session: object,
  input: N8nNodePreExecutePayloadInput,
  activity: PendingNodeActivity,
): void {
  let store = pendingNodeActivities.get(session);
  if (!store) {
    store = new Map();
    pendingNodeActivities.set(session, store);
  }
  store.set(nodeActivityKey(input), activity);
}

function takeNodeActivity(
  session: object,
  input: Pick<N8nNodePreExecutePayloadInput, 'activityId' | 'sessionId' | 'nodeName' | 'prompt' | 'input'>,
): PendingNodeActivity | null {
  const store = pendingNodeActivities.get(session);
  if (!store) return null;
  const key = nodeActivityKey(input);
  const activity = store.get(key) ?? null;
  store.delete(key);
  return activity;
}

export async function emitN8nUserPromptSignal(
  session: SignalCapableN8nSession,
  prompt: string | undefined,
  options: N8nUserPromptSignalOptions = {},
): Promise<WorkflowVerdict | undefined> {
  const signalArgs = prompt?.trim();
  if (!signalArgs) return undefined;
  return session.activity(EVENT.SIGNAL, defaultActivity.goalSignal, {
    input: [
      stampSource(
        cleanRecord({
          prompt: signalArgs,
          event_category: 'agent_goal',
          node_name: options.nodeName,
        }),
        'n8n',
      ),
    ],
    signalName: defaultActivity.goalSignal,
    signalArgs,
    sessionId: options.sessionId,
    prompt: signalArgs,
  });
}

export function buildN8nNodePreExecutePayload(
  input: N8nNodePreExecutePayloadInput,
): GovernedPayload {
  const prompt = input.prompt?.trim();
  return {
    input: nodeActivityInput({
      ...(input.input ?? {}),
      event_category: 'node_pre_execute',
      node_name: input.nodeName,
      prompt,
    }),
    sessionId: input.sessionId,
    prompt,
    ...nodeToolTelemetry(input.nodeName),
  };
}

export function buildN8nGovernanceCheckPayload(
  input: N8nGovernanceCheckPayloadInput,
): GovernedPayload {
  const prompt = input.prompt?.trim() ??
    (typeof input.activityInput.prompt === 'string'
      ? input.activityInput.prompt.trim()
      : undefined);
  const nodeName = trimmed(input.nodeName) ?? 'OpenBox Governance';
  return {
    activityId: input.activityId,
    input: nodeActivityInput({
      ...input.activityInput,
      event_category: 'governance_check',
      node_name: nodeName,
      span_type: input.spanType,
      prompt,
    }),
    sessionId: input.sessionId,
    prompt,
    ...nodeToolTelemetry(nodeName),
    spans: [
      buildSpan('n8n', input.spanType, input.activityInput),
    ],
  };
}

export async function emitN8nNodePreExecute(
  session: NodePreExecuteCapableN8nSession,
  input: N8nNodePreExecutePayloadInput,
): Promise<WorkflowVerdict> {
  await emitN8nUserPromptSignal(session, input.prompt, {
    nodeName: input.nodeName,
    sessionId: input.sessionId,
  });
  const startTime = Date.now();
  const opened = await session.openActivity(n8nActivity.nodePreExecute, {
    ...buildN8nNodePreExecutePayload(input),
    activityId: input.activityId,
    startTime,
  });
  if (
    opened.verdict.arm === 'allow' ||
    opened.verdict.arm === 'constrain' ||
    opened.verdict.arm === 'require_approval'
  ) {
    rememberNodeActivity(session, input, {
      activityId: opened.activityId,
      startTime,
    });
  }
  return opened.verdict;
}

export async function emitN8nGovernanceCheck(
  session: GovernanceCheckCapableN8nSession,
  input: N8nGovernanceCheckPayloadInput,
): Promise<WorkflowVerdict> {
  return session.nodePreExecute(buildN8nGovernanceCheckPayload(input));
}

export function buildN8nLlmCompletionPayload(
  input: N8nLlmCompletionPayloadInput,
): GovernedPayload {
  const content = input.text.trim();
  const prompt = input.prompt?.trim();
  const hasActivityInput =
    input.input !== undefined ||
    prompt !== undefined ||
    input.nodeName !== undefined;
  const activityInput = hasActivityInput
    ? cleanRecord({
        ...(input.input ?? {}),
        event_category: 'node_post_execute',
        node_name: input.nodeName,
        prompt,
      })
    : undefined;
  const telemetry = assistantOutputTelemetryFields({
    source: 'n8n',
    sessionId: input.sessionId,
    content,
    model: input.model,
    usage: input.usage,
    hasToolCalls: input.hasToolCalls ?? false,
  });
  return {
    ...(activityInput && Object.keys(activityInput).length > 0
      ? { input: nodeActivityInput(activityInput) }
      : {}),
    output: { text: input.text },
    prompt,
    ...telemetry,
    ...nodeToolTelemetry(input.nodeName),
    spans: buildAssistantOutputSpan({
      source: 'n8n',
      content,
      name: 'openbox.n8n.assistant_output',
      model: input.model,
      provider: input.provider,
      usage: input.usage,
      hasToolCalls: input.hasToolCalls ?? false,
      requestBody: input.requestBody,
      responseBody: input.responseBody,
      providerUrl: input.providerUrl,
      startTime: input.startTime,
      endTime: input.endTime,
      durationNs: input.durationNs,
      attributes: cleanRecord({
        ...nodeToolAttributes(input.nodeName),
        'openbox.n8n.node_name': input.nodeName,
        'openbox.provider': input.provider,
        'openbox.provider.url': input.actualProviderUrl,
      }),
      data: cleanRecord({
        source: 'n8n',
        node_name: input.nodeName,
        provider: input.provider,
        provider_url: input.actualProviderUrl,
      }),
    }),
  };
}

export function buildN8nNodePostExecutePayload(
  input: N8nNodePostExecutePayloadInput,
): GovernedPayload {
  const prompt = input.prompt?.trim();
  const hasActivityInput =
    input.input !== undefined ||
    prompt !== undefined ||
    input.nodeName !== undefined;
  const activityInput = hasActivityInput
    ? cleanRecord({
        ...(input.input ?? {}),
        event_category: 'node_post_execute',
        node_name: input.nodeName,
        prompt,
      })
    : undefined;
  return {
    ...(activityInput && Object.keys(activityInput).length > 0
      ? { input: nodeActivityInput(activityInput) }
      : {}),
    output: nodePostExecuteOutput(input),
    prompt,
    sessionId: input.sessionId,
    ...nodeToolTelemetry(input.nodeName),
    spans: [nodeExecutionSpan(input)],
    startTime: input.startTime,
    endTime: input.endTime,
    durationMs: input.durationMs,
  };
}

export async function emitN8nNodePostExecute(
  session: NodePostExecuteCapableN8nSession,
  input: N8nNodePostExecutePayloadInput,
): Promise<WorkflowVerdict> {
  const pending = takeNodeActivity(session, input);
  const activityId = pending?.activityId ?? input.activityId;
  const payload = buildN8nNodePostExecutePayload(input);
  return session.nodePostExecute({
    ...payload,
    activityId,
    spans: payload.spans?.map((span) => withSpanActivityId(span, activityId)),
    startTime: pending?.startTime ?? input.startTime,
    hookSpanParentEventType: payload.spans?.length ? EVENT.START : undefined,
    ensureHookSpanParent: !pending,
  });
}

export async function emitN8nLlmCompletion(
  session: NodePostExecuteCapableN8nSession,
  input: N8nLlmCompletionPayloadInput,
): Promise<WorkflowVerdict> {
  const pending = takeNodeActivity(session, input);
  const activityId = pending?.activityId ?? input.activityId;
  const payload = buildN8nLlmCompletionPayload(input);
  return session.nodePostExecute({
    ...payload,
    activityId,
    spans: payload.spans?.map((span) => withSpanActivityId(span, activityId)),
    // Fall back to the caller-supplied startTime when there's no pending activity
    // (matches emitN8nNodePostExecute; previously dropped input.startTime).
    startTime: pending?.startTime ?? input.startTime,
    hookSpanParentEventType: payload.spans?.length ? EVENT.START : undefined,
    ensureHookSpanParent: !pending,
  });
}
