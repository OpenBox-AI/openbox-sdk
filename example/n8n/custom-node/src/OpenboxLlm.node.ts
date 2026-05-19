import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import type { WorkflowVerdict } from 'openbox-sdk';

type OpenBoxSdk = typeof import('openbox-sdk');

const importModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<OpenBoxSdk>;

let openboxSdkPromise: Promise<OpenBoxSdk> | undefined;

function loadOpenBoxSdk(): Promise<OpenBoxSdk> {
  openboxSdkPromise ??= importModule('openbox-sdk');
  return openboxSdkPromise;
}

export class OpenboxLlm implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'OpenBox: LLM',
    name: 'openboxLlm',
    icon: 'file:OB_logomark.png',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["model"]}}',
    description: 'Govern an LLM call through OpenBox',
    defaults: { name: 'OpenBox: LLM' },
    inputs: ['main'] as any,
    outputs: ['main'] as any,
    properties: [
      {
        displayName: 'LLM Provider',
        name: 'llmProvider',
        type: 'options',
        options: [
          { name: 'OpenRouter', value: 'openrouter' },
          { name: 'Ollama', value: 'ollama' },
        ],
        default: '={{ $env["OPENROUTER_API_KEY"] ? "openrouter" : "ollama" }}',
        description: 'OpenRouter is recommended for hosted demos; Ollama remains available for local-only demos',
      },
      {
        displayName: 'OpenRouter API Key',
        name: 'openRouterApiKey',
        type: 'string',
        typeOptions: { password: true },
        default: '={{ $env["OPENROUTER_API_KEY"] }}',
        displayOptions: {
          show: {
            llmProvider: ['openrouter'],
          },
        },
      },
      {
        displayName: 'OpenRouter Base URL',
        name: 'openRouterBaseUrl',
        type: 'string',
        default: '={{ $env["OPENROUTER_BASE_URL"] || "https://openrouter.ai/api/v1" }}',
        displayOptions: {
          show: {
            llmProvider: ['openrouter'],
          },
        },
      },
      {
        displayName: 'Ollama Host',
        name: 'ollamaHost',
        type: 'string',
        default: '={{ $env["OLLAMA_HOST"] || "ollama:11434" }}',
        description: 'Ollama server host:port',
        displayOptions: {
          show: {
            llmProvider: ['ollama'],
          },
        },
      },
      {
        displayName: 'Model',
        name: 'model',
        type: 'string',
        default:
          '={{ $env["OPENROUTER_MODEL"] || $env["OLLAMA_MODEL"] || "liquid/lfm-2.5-1.2b-instruct:free" }}',
      },
      {
        displayName: 'System Prompt',
        name: 'systemPrompt',
        type: 'string',
        typeOptions: { rows: 4 },
        default: 'You are a helpful assistant.',
      },
      {
        displayName: 'OpenBox API Endpoint',
        name: 'apiEndpoint',
        type: 'string',
        default: '={{ $env["OPENBOX_API_URL"] || "http://host.docker.internal:8086" }}',
      },
      {
        displayName: 'OpenBox API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        default: '={{ $env["OPENBOX_API_KEY"] }}',
        description: 'obx_live_* or obx_test_*',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const llmProvider = this.getNodeParameter('llmProvider', 0) as string;
    const openRouterApiKey =
      llmProvider === 'openrouter'
        ? (this.getNodeParameter('openRouterApiKey', 0, '') as string)
        : '';
    const openRouterBaseUrl =
      llmProvider === 'openrouter'
        ? (this.getNodeParameter('openRouterBaseUrl', 0, 'https://openrouter.ai/api/v1') as string)
        : 'https://openrouter.ai/api/v1';
    const ollamaHost =
      llmProvider === 'ollama'
        ? (this.getNodeParameter('ollamaHost', 0, 'ollama:11434') as string)
        : 'ollama:11434';
    const model = this.getNodeParameter('model', 0) as string;
    const systemPrompt = this.getNodeParameter('systemPrompt', 0) as string;
    const apiEndpoint = this.getNodeParameter('apiEndpoint', 0) as string;
    const apiKey = this.getNodeParameter('apiKey', 0) as string;

    const input = (items[0]?.json ?? {}) as Record<string, unknown>;
    const userMessage = (input.chatInput ?? '') as string;

    if (!userMessage) {
      throw new NodeOperationError(this.getNode(), 'No chat input found');
    }

    const helpers = this.helpers;
    const node = this.getNode();

    const callLlm = async (prompt: string): Promise<string> => {
      if (llmProvider === 'openrouter') {
        if (!openRouterApiKey) {
          throw new NodeOperationError(
            node,
            'OPENROUTER_API_KEY is required when LLM Provider is OpenRouter',
          );
        }

        const baseUrl = openRouterBaseUrl.replace(/\/+$/, '');
        const res = await helpers.httpRequest({
          method: 'POST',
          url: `${baseUrl}/chat/completions`,
          headers: {
            Authorization: `Bearer ${openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.N8N_EDITOR_BASE_URL ?? 'https://app.ipsum.lat/ob/n8n/',
            'X-Title': 'OpenBox n8n demo',
          },
          body: {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt },
            ],
          },
        });
        const choice = (res as any).choices?.[0];
        const message = choice?.message ?? {};
        const text =
          message.content ??
          message.reasoning ??
          choice?.text ??
          (Array.isArray(message.reasoning_details)
            ? message.reasoning_details
                .map((detail: Record<string, unknown>) => detail.text ?? detail.content ?? '')
                .filter(Boolean)
                .join('\n')
            : undefined);
        if (!text) {
          throw new NodeOperationError(
            node,
            'OpenRouter returned no message content or reasoning text',
          );
        }
        return text as string;
      }

      const res = await helpers.httpRequest({
        method: 'POST',
        url: `http://${ollamaHost}/api/generate`,
        body: { model, system: systemPrompt, prompt, stream: false },
      });
      return ((res as any).response ?? JSON.stringify(res)) as string;
    };

    if (!apiKey) {
      const text = await callLlm(userMessage);
      return [[{ json: { ...input, output: text, text, _openbox: { governed: false } } }]];
    }

    const { OpenBoxCoreClient, govern, presets } = await loadOpenBoxSdk();
    const core = new OpenBoxCoreClient({ apiUrl: apiEndpoint, apiKey });

    const isAllowed = (verdict: WorkflowVerdict): boolean =>
      verdict.arm === 'allow' || verdict.arm === 'constrain';

    const blockedResult = (
      verdict: WorkflowVerdict,
      stage: 'input' | 'output',
      session: { workflowId: string; runId: string },
      pre?: WorkflowVerdict,
      post?: WorkflowVerdict,
    ) => {
      const fallback =
        stage === 'input'
          ? 'Request blocked by governance'
          : 'Response blocked by governance';
      const reason = verdict.reason ?? fallback;
      const text =
        stage === 'input'
          ? `Request blocked by OpenBox before ${node.name}: ${reason}`
          : `Response blocked by OpenBox after ${node.name}: ${reason}`;

      return {
        text,
        meta: {
          governed: true,
          blocked: true,
          nodeName: node.name,
          blockStage: stage,
          blockReason: reason,
          workflowId: session.workflowId,
          runId: session.runId,
          pre: pre ? { arm: pre.arm, riskScore: pre.riskScore, reason: pre.reason } : undefined,
          post: post ? { arm: post.arm, riskScore: post.riskScore, reason: post.reason } : undefined,
        },
      };
    };

    const result = await govern(
      { core, preset: presets.n8n, workflowType: 'N8nChatWorkflow', taskQueue: 'n8n' },
      async (session) => {
        const pre = await session.nodePreExecute({ input: [{ chatInput: userMessage }] });
        if (!isAllowed(pre)) {
          return blockedResult(pre, 'input', session, pre);
        }

        const redactedInput = pre.guardrailsResult?.redactedInput as
          | Array<{ chatInput?: string }>
          | undefined;
        const promptToUse = redactedInput?.[0]?.chatInput ?? userMessage;

        const text = await callLlm(promptToUse);

        const post = await session.nodePostExecute({
          input: [{ chatInput: promptToUse }],
          output: { text },
        });
        if (!isAllowed(post)) {
          return blockedResult(post, 'output', session, pre, post);
        }

        const redactedOutput = post.guardrailsResult?.redactedInput as
          | { text?: string }
          | undefined;
        const finalText = redactedOutput?.text ?? text;

        return {
          text: finalText,
          meta: {
            governed: true,
            workflowId: session.workflowId,
            runId: session.runId,
            nodeName: node.name,
            pre: { arm: pre.arm, riskScore: pre.riskScore, reason: pre.reason },
            post: { arm: post.arm, riskScore: post.riskScore, reason: post.reason },
          },
        };
      },
    );

    return [[{ json: { ...input, output: result.text, text: result.text, _openbox: result.meta } }]];
  }
}
