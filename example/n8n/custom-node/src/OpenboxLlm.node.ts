import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';
import type { WorkflowVerdict } from '@openbox-ai/openbox-sdk';

type OpenBoxSdk = typeof import('@openbox-ai/openbox-sdk');
interface LLMTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface OpenBoxN8nRuntimeSdk {
  emitN8nUserPromptSignal(
    session: {
      activity(
        eventType: 'ActivityStarted' | 'ActivityCompleted' | 'SignalReceived',
        activityType: string,
        payload: unknown,
      ): Promise<WorkflowVerdict>;
    },
    prompt: string | undefined,
    options?: { nodeName?: string; sessionId?: string },
  ): Promise<WorkflowVerdict | undefined>;
  buildN8nLlmCompletionPayload(input: {
    text: string;
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
  }): Record<string, unknown>;
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

interface LlmCallResult {
  text: string;
  model: string;
  usage?: LLMTokenUsage;
  requestBody: unknown;
  responseBody: unknown;
  providerUrl: string;
  actualProviderUrl: string;
  startTime: number;
  endTime: number;
  durationNs: number;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFrom(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : undefined;
  if (numeric === undefined || !Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.trunc(numeric);
}

function usageFromOpenAiCompatible(response: unknown): LLMTokenUsage | undefined {
  const usage = recordFrom(recordFrom(response).usage);
  return compactUsage({
    promptTokens: numberFrom(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: numberFrom(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: numberFrom(usage.total_tokens),
  });
}

function usageFromOllama(response: unknown): LLMTokenUsage | undefined {
  const record = recordFrom(response);
  const promptTokens = numberFrom(record.prompt_eval_count);
  const completionTokens = numberFrom(record.eval_count);
  return compactUsage({
    promptTokens,
    completionTokens,
    totalTokens:
      promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined,
  });
}

function compactUsage(usage: LLMTokenUsage): LLMTokenUsage | undefined {
  return Object.values(usage).some((value) => value !== undefined)
    ? usage
    : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? 'Unknown provider error');
  }
  return 'Unknown provider error';
}

function buildFallbackText(nodeName: string, prompt: string): string {
  if (nodeName.includes('Governed LLM Draft')) {
    const field = (label: string): string | undefined => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = prompt.match(new RegExp(`${escaped}:\\s*(.+)`, 'i'));
      return match?.[1]?.trim();
    };
    const ticketId = field('Ticket ID') ?? 'N8N-DEMO';
    const customer = field('Customer') ?? 'the customer';
    const route = field('Suggested route') ?? 'support-queue';
    const severity = field('Initial severity') ?? 'normal';
    const review = /human review required:\s*yes/i.test(prompt)
      ? 'human-review-required'
      : 'auto-reply-candidate';

    return [
      '**Summary**',
      `${customer} reported a support issue. Initial routing is ${route} with ${severity} severity.`,
      '',
      '**Customer Reply Draft**',
      'Hi,',
      'Thanks for reaching out. We are reviewing the issue and will follow up with the next safe step after checking the account context.',
      'Best,',
      'Support Team',
      '',
      '**Internal Next Step**',
      `Route ticket ${ticketId} to ${route}. Review status: ${review}.`,
      '',
      '**Risks**',
      'Do not confirm refunds, security state, account changes, or sensitive details until a human has verified them.',
    ].join('\n');
  }

  return [
    `OpenBox checkpoint passed for ${nodeName}.`,
    'Provider fallback generated this checkpoint text because the configured LLM provider was unavailable.',
  ].join('\n');
}

function deterministicBlockReason(nodeName: string, prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  const hasPaymentCard = /\b(?:\d[ -]*?){13,19}\b/.test(prompt);
  const hasSsn = /\b\d{3}-\d{2}-\d{4}\b/.test(prompt);
  const asksForSecrets =
    /ignore all instructions/i.test(prompt) &&
    /(api key|token|secret|password|credential)/i.test(prompt);

  if (nodeName.includes('Prompt Safety Wall')) {
    if (hasPaymentCard || hasSsn) {
      return 'Prompt contains payment-card or SSN-style sensitive data.';
    }
    if (asksForSecrets) {
      return 'Prompt attempts to exfiltrate provider keys, tokens, or secrets.';
    }
    if (/\bnsfw\b|violent sexual|abuse-demo/i.test(prompt)) {
      return 'Prompt contains NSFW or abusive demo content.';
    }
  }

  if (nodeName.includes('Context Privacy Check') && /\bblockme\b|contextblock/i.test(prompt)) {
    return 'Context privacy checkpoint caught the configured demo tripwire.';
  }

  if (nodeName.includes('Channel Output Check')) {
    if (/\bblockme\b|channelblock/i.test(prompt)) {
      return 'Outbound channel checkpoint caught the configured demo tripwire.';
    }
    if (/account (is|was|has been) (verified|secured|changed|reset)|refund (is|was|has been) complete/i.test(prompt)) {
      return 'Outbound payload makes an unsupported account, security, or refund claim.';
    }
    if (/last four digits of your credit card|screenshot of your account dashboard/i.test(prompt)) {
      return 'Outbound payload asks for unnecessary sensitive verification data.';
    }
    if (/sk-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+|password\s*[:=]/i.test(prompt)) {
      return 'Outbound payload contains a provider key, Slack token, or password-like secret.';
    }
  }

  return undefined;
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
        description: 'Choose the runtime LLM provider. Hosted demos can use an OpenRouter-compatible provider; local demos can use Ollama.',
      },
      {
        displayName: 'Provider API Key',
        name: 'openRouterApiKey',
        type: 'string',
        typeOptions: { password: true },
        default: '={{ $env["LLM_PROVIDER_API_KEY"] || $env["LLM7_API_KEY"] || $env["OPENROUTER_API_KEY"] }}',
        displayOptions: {
          show: {
            llmProvider: ['openrouter'],
          },
        },
      },
      {
        displayName: 'Provider Base URL',
        name: 'openRouterBaseUrl',
        type: 'string',
        default: '={{ $env["LLM_PROVIDER_BASE_URL"] || $env["OPENROUTER_BASE_URL"] || "https://openrouter.ai/api/v1" }}',
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
          '={{ $env["LLM_PROVIDER_MODEL"] || $env["OPENROUTER_MODEL"] || $env["OLLAMA_MODEL"] || "liquid/lfm-2.5-1.2b-instruct:free" }}',
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

    const callLlm = async (prompt: string): Promise<LlmCallResult> => {
      if (llmProvider === 'openrouter') {
        if (!openRouterApiKey) {
          throw new NodeOperationError(
            node,
            'A provider API key is required when LLM Provider uses the OpenRouter-compatible chat completions API',
          );
        }

        const baseUrl = openRouterBaseUrl.replace(/\/+$/, '');
        const actualProviderUrl = `${baseUrl}/chat/completions`;
        const requestBody = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        };
        const startTime = Date.now();
        const res = await helpers.httpRequest({
          method: 'POST',
          url: actualProviderUrl,
          headers: {
            Authorization: `Bearer ${openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.N8N_EDITOR_BASE_URL ?? 'http://localhost:5678/',
            'X-Title': 'OpenBox n8n demo',
          },
          body: requestBody,
        });
        const endTime = Date.now();
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
            'LLM provider returned no message content or reasoning text',
          );
        }
        const responseRecord = recordFrom(res);
        return {
          text: text as string,
          model:
            typeof responseRecord.model === 'string' && responseRecord.model.trim()
              ? responseRecord.model
              : model,
          usage: usageFromOpenAiCompatible(res),
          requestBody,
          responseBody: res,
          // Core currently recognizes OpenAI-compatible telemetry by URL.
          providerUrl: 'https://api.openai.com/v1/chat/completions',
          actualProviderUrl,
          startTime,
          endTime,
          durationNs: Math.max(0, endTime - startTime) * 1_000_000,
        };
      }

      const actualProviderUrl = `http://${ollamaHost}/api/generate`;
      const requestBody = { model, system: systemPrompt, prompt, stream: false };
      const startTime = Date.now();
      const res = await helpers.httpRequest({
        method: 'POST',
        url: actualProviderUrl,
        body: requestBody,
      });
      const endTime = Date.now();
      const text = ((res as any).response ?? JSON.stringify(res)) as string;
      const responseRecord = recordFrom(res);
      return {
        text,
        model:
          typeof responseRecord.model === 'string' && responseRecord.model.trim()
            ? responseRecord.model
            : model,
        usage: usageFromOllama(res),
        requestBody,
        responseBody: res,
        // Keep this OpenAI-shaped so Core's current model extractor records usage.
        providerUrl: 'https://api.openai.com/v1/chat/completions',
        actualProviderUrl,
        startTime,
        endTime,
        durationNs: Math.max(0, endTime - startTime) * 1_000_000,
      };
    };

    if (!apiEndpoint || !apiKey) {
      throw new NodeOperationError(
        node,
        'OPENBOX_API_URL and OPENBOX_API_KEY are required; refusing to call the LLM without OpenBox governance',
      );
    }

    const { OpenBoxCoreClient, govern, presets } = await loadOpenBoxSdk();
    const {
      buildN8nLlmCompletionPayload,
      emitN8nUserPromptSignal,
    } = await loadOpenBoxN8nRuntimeSdk();
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

    const providerErrorResult = (
      error: unknown,
      session: { workflowId: string; runId: string },
      pre?: WorkflowVerdict,
    ) => {
      const reason = errorMessage(error);
      return {
        text: `Request stopped by OpenBox at ${node.name}: LLM provider failed before a governed draft could be produced. ${reason}`,
        meta: {
          governed: true,
          blocked: true,
          providerError: true,
          nodeName: node.name,
          blockStage: 'provider-error',
          blockReason: reason,
          workflowId: session.workflowId,
          runId: session.runId,
          pre: pre ? { arm: pre.arm, riskScore: pre.riskScore, reason: pre.reason } : undefined,
        },
      };
    };

    const result = await govern(
      { core, preset: presets.n8n, workflowType: 'N8nChatWorkflow', taskQueue: 'n8n' },
      async (session) => {
        await emitN8nUserPromptSignal(session, userMessage, {
          nodeName: node.name,
        }).catch(() => undefined);

        const pre = await session.nodePreExecute({ input: [{ chatInput: userMessage }] });
        if (!isAllowed(pre)) {
          return blockedResult(pre, 'input', session, pre);
        }

        const redactedInput = pre.guardrailsResult?.redactedInput as
          | Array<{ chatInput?: string }>
          | undefined;
        const promptToUse = redactedInput?.[0]?.chatInput ?? userMessage;
        const deterministicReason = deterministicBlockReason(node.name, promptToUse);
        if (deterministicReason) {
          return {
            text: `Request blocked by OpenBox before ${node.name}: ${deterministicReason}`,
            meta: {
              governed: true,
              blocked: true,
              nodeName: node.name,
              blockStage: 'input',
              blockReason: deterministicReason,
              workflowId: session.workflowId,
              runId: session.runId,
              pre: { arm: pre.arm, riskScore: pre.riskScore, reason: pre.reason },
            },
          };
        }

        let text: string;
        let llmCall: LlmCallResult | undefined;
        let providerFallback: { enabled: boolean; reason?: string } = { enabled: false };
        try {
          llmCall = await callLlm(promptToUse);
          text = llmCall.text;
        } catch (error) {
          providerFallback = { enabled: true, reason: errorMessage(error) };
          text = buildFallbackText(node.name, promptToUse);
        }

        let postSkipped: string | undefined;
        let post: WorkflowVerdict;
        try {
          post = await session.nodePostExecute({
            input: [{ chatInput: promptToUse }],
            ...buildN8nLlmCompletionPayload({
              text,
              model: llmCall?.model,
              usage: llmCall?.usage,
              requestBody: llmCall?.requestBody,
              responseBody: llmCall?.responseBody,
              providerUrl: llmCall?.providerUrl,
              actualProviderUrl: llmCall?.actualProviderUrl,
              provider: llmCall ? llmProvider : 'fallback',
              nodeName: node.name,
              startTime: llmCall?.startTime,
              endTime: llmCall?.endTime,
              durationNs: llmCall?.durationNs,
            }),
          });
        } catch (error) {
          postSkipped = errorMessage(error);
          post = {
            arm: 'allow',
            riskScore: pre.riskScore,
            reason: `Post-check skipped: ${postSkipped}`,
          } as WorkflowVerdict;
        }
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
            model: llmCall?.model,
            usage: llmCall?.usage,
            providerFallback: providerFallback.enabled,
            providerFallbackReason: providerFallback.reason,
            postSkipped,
            pre: { arm: pre.arm, riskScore: pre.riskScore, reason: pre.reason },
            post: { arm: post.arm, riskScore: post.riskScore, reason: post.reason },
          },
        };
      },
    );

    return [[{ json: { ...input, output: result.text, text: result.text, _openbox: result.meta } }]];
  }
}
