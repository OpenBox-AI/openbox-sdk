import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { WorkflowVerdict } from '@openbox-ai/openbox-sdk';
import {
  getOpenBoxN8nNodeSpec,
  getOpenBoxN8nWorkflowTemplateSpec,
  type OpenBoxN8nNodeSpec,
  type OpenBoxN8nWorkflowTemplateSpec,
} from './generated/openbox-n8n-spec';

type OpenBoxSdk = typeof import('@openbox-ai/openbox-sdk');

interface OpenBoxN8nRuntimeSdk {
  emitN8nNodePreExecute(
    session: unknown,
    input: {
      input?: Record<string, unknown>;
      nodeName?: string;
      sessionId?: string;
      prompt?: string;
    },
  ): Promise<WorkflowVerdict>;
  emitN8nLlmCompletion(
    session: unknown,
    input: {
      text: string;
      input?: Record<string, unknown>;
      prompt?: string;
      model?: string;
      provider?: string;
      nodeName?: string;
      sessionId?: string;
      hasToolCalls?: boolean;
    },
  ): Promise<WorkflowVerdict>;
}

const importModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<OpenBoxSdk | OpenBoxN8nRuntimeSdk>;

let openboxSdkPromise: Promise<OpenBoxSdk> | undefined;
let openboxN8nRuntimePromise: Promise<OpenBoxN8nRuntimeSdk> | undefined;

function loadOpenBoxSdk(): Promise<OpenBoxSdk> {
  openboxSdkPromise ??= importModule('@openbox-ai/openbox-sdk') as Promise<OpenBoxSdk>;
  return openboxSdkPromise;
}

function loadOpenBoxN8nRuntimeSdk(): Promise<OpenBoxN8nRuntimeSdk> {
  openboxN8nRuntimePromise ??= importModule('@openbox-ai/openbox-sdk/runtime/n8n') as Promise<OpenBoxN8nRuntimeSdk>;
  return openboxN8nRuntimePromise;
}

function stringFrom(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
  return text || undefined;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function requiredNodeSpec(id: string): OpenBoxN8nNodeSpec {
  const spec = getOpenBoxN8nNodeSpec(id);
  if (!spec) throw new Error(`Missing generated OpenBox n8n node spec: ${id}`);
  return spec;
}

export function requiredWorkflowTemplateSpec(id: string): OpenBoxN8nWorkflowTemplateSpec {
  const spec = getOpenBoxN8nWorkflowTemplateSpec(id);
  if (!spec) throw new Error(`Missing generated OpenBox n8n workflow template spec: ${id}`);
  return spec;
}

export function specNodeDescription(
  spec: OpenBoxN8nNodeSpec,
  description: Omit<INodeTypeDescription, 'displayName' | 'name' | 'description'>,
): INodeTypeDescription {
  return {
    ...description,
    displayName: spec.name,
    name: spec.id,
    description: spec.description,
  };
}

export const openBoxCredentials = [
  {
    name: 'openboxCredentials',
    required: true,
  },
];

export const commonGovernanceProperties = [
  {
    displayName: 'Prompt',
    name: 'prompt',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '={{ $json.chatInput || $json.prompt || $json.text || "" }}',
    description: 'Prompt or instruction text to send to OpenBox governance.',
  },
  {
    displayName: 'Session ID',
    name: 'sessionId',
    type: 'string',
    default: '={{ $execution.id || $workflow.id }}',
    description: 'Stable OpenBox session identifier for this workflow run.',
  },
  {
    displayName: 'Node Name',
    name: 'nodeName',
    type: 'string',
    default: '',
    description: 'Optional node name override used in OpenBox spans.',
  },
] as const;

export const commonTextProperties = [
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    typeOptions: { rows: 6 },
    default: '={{ $json.text || $json.output || $json.chatInput || "" }}',
    description: 'Text output to review with OpenBox guardrails.',
  },
  {
    displayName: 'Prompt',
    name: 'prompt',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '={{ $json.prompt || $json.chatInput || "" }}',
    description: 'Original prompt associated with the output.',
  },
  {
    displayName: 'Model',
    name: 'model',
    type: 'string',
    default: '={{ $json.model || "" }}',
    description: 'Optional model name for usage and trace metadata.',
  },
  {
    displayName: 'Session ID',
    name: 'sessionId',
    type: 'string',
    default: '={{ $execution.id || $workflow.id }}',
    description: 'Stable OpenBox session identifier for this workflow run.',
  },
] as const;

function parameterString(
  ctx: IExecuteFunctions,
  name: string,
  itemIndex: number,
  fallback?: unknown,
): string | undefined {
  return stringFrom(ctx.getNodeParameter(name, itemIndex, fallback as never));
}

async function createCore(ctx: IExecuteFunctions): Promise<{
  core: unknown;
  govern: OpenBoxSdk['govern'];
  preset: unknown;
}> {
  const credentials = recordFrom(await ctx.getCredentials('openboxCredentials'));
  const apiUrl =
    stringFrom(credentials.coreUrl) ??
    stringFrom(credentials.apiUrl) ??
    stringFrom(process.env.OPENBOX_CORE_URL) ??
    stringFrom(process.env.OPENBOX_API_URL);
  const apiKey =
    stringFrom(credentials.apiKey) ??
    stringFrom(process.env.OPENBOX_API_KEY);

  if (!apiUrl || !apiKey) {
    throw new NodeOperationError(
      ctx.getNode(),
      'OpenBox Credentials require a Core URL and API key.',
    );
  }

  const { OpenBoxCoreClient, govern, presets } = await loadOpenBoxSdk();
  return {
    core: new OpenBoxCoreClient({ apiUrl, apiKey }),
    govern,
    preset: presets.n8n,
  };
}

function verdictMetadata(verdict: WorkflowVerdict): Record<string, unknown> {
  return {
    arm: verdict.arm,
    riskScore: verdict.riskScore,
    reason: verdict.reason,
    activityId: verdict.activityId,
    governanceEventId: verdict.governanceEventId,
    approvalId: verdict.approvalId,
    approvalExpiresAt: verdict.approvalExpiresAt,
    guardrailsResult: verdict.guardrailsResult,
  };
}

function itemJson(item: INodeExecutionData): Record<string, unknown> {
  return recordFrom(item.json);
}

async function runWithOpenBox(
  ctx: IExecuteFunctions,
  callback: (session: unknown, runtime: OpenBoxN8nRuntimeSdk) => Promise<WorkflowVerdict>,
): Promise<WorkflowVerdict> {
  const [{ core, govern, preset }, runtime] = await Promise.all([
    createCore(ctx),
    loadOpenBoxN8nRuntimeSdk(),
  ]);
  return govern(
    {
      core: core as never,
      preset: preset as never,
      workflowType: 'N8nPackagedIntegration',
      taskQueue: 'n8n',
    } as never,
    (session: unknown) => callback(session, runtime),
  ) as Promise<WorkflowVerdict>;
}

function metadata(
  spec: OpenBoxN8nNodeSpec,
  stage: string,
  verdict: WorkflowVerdict,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    governed: true,
    source: 'n8n',
    spec: {
      id: spec.id,
      name: spec.name,
      tier: spec.tier,
    },
    stage,
    verdict: verdictMetadata(verdict),
    blocked: !['allow', 'constrain'].includes(verdict.arm),
    ...extra,
  };
}

export async function executePreExecuteNode(
  ctx: IExecuteFunctions,
  spec: OpenBoxN8nNodeSpec,
  stage: string,
  extraInput: (item: INodeExecutionData, itemIndex: number) => Record<string, unknown> = () => ({}),
): Promise<INodeExecutionData[][]> {
  const items = ctx.getInputData();
  const output: INodeExecutionData[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const json = itemJson(item);
    const prompt = parameterString(ctx, 'prompt', index, json.chatInput ?? json.prompt ?? json.text);
    const sessionId = parameterString(ctx, 'sessionId', index, json.sessionId);
    const nodeName = parameterString(ctx, 'nodeName', index, spec.name) ?? spec.name;
    const verdict = await runWithOpenBox(ctx, (session, runtime) =>
      runtime.emitN8nNodePreExecute(session, {
        input: {
          ...json,
          ...extraInput(item, index),
          openbox_spec_node_id: spec.id,
          openbox_stage: stage,
        },
        nodeName,
        prompt,
        sessionId,
      }));

    output.push({
      json: {
        ...json,
        _openbox: metadata(spec, stage, verdict),
      },
      pairedItem: item.pairedItem,
    });
  }

  return [output];
}

export async function executeLlmCompletionNode(
  ctx: IExecuteFunctions,
  spec: OpenBoxN8nNodeSpec,
  stage: string,
): Promise<INodeExecutionData[][]> {
  const items = ctx.getInputData();
  const output: INodeExecutionData[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const json = itemJson(item);
    const text = parameterString(ctx, 'text', index, json.text ?? json.output ?? json.chatInput);
    if (!text) {
      throw new NodeOperationError(ctx.getNode(), `${spec.name} requires text to review.`);
    }
    const prompt = parameterString(ctx, 'prompt', index, json.prompt ?? json.chatInput);
    const model = parameterString(ctx, 'model', index, json.model);
    const sessionId = parameterString(ctx, 'sessionId', index, json.sessionId);
    const verdict = await runWithOpenBox(ctx, (session, runtime) =>
      runtime.emitN8nLlmCompletion(session, {
        text,
        input: {
          ...json,
          openbox_spec_node_id: spec.id,
          openbox_stage: stage,
        },
        prompt,
        model,
        provider: 'n8n',
        nodeName: spec.name,
        sessionId,
        hasToolCalls: Boolean(json.hasToolCalls),
      }));

    output.push({
      json: {
        ...json,
        _openbox: metadata(spec, stage, verdict),
      },
      pairedItem: item.pairedItem,
    });
  }

  return [output];
}
