#!/usr/bin/env node
// Start the local LlamaFirewall adapter.

import { spawn } from 'node:child_process';

const port = process.env.LLAMAFIREWALL_PORT ?? '8184';
const apiKeyEnvVar = 'OPENAI_COMPAT_API_KEY';

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

async function main() {
  const existing = await existingAdapterHealth();
  if (existing) {
    const requestedModel = process.env.OPENAI_COMPAT_MODEL ?? process.env.LLAMAFIREWALL_MODEL;
    const requestedApiBaseUrl = process.env.OPENAI_COMPAT_BASE_URL ?? process.env.LLAMAFIREWALL_API_BASE_URL;
    const matchesRequestedModel = !requestedModel || existing.model === requestedModel;
    const matchesRequestedApiBaseUrl =
      !requestedApiBaseUrl || trimTrailingSlash(existing.api_base_url ?? '') === trimTrailingSlash(requestedApiBaseUrl);

    if (matchesRequestedModel && matchesRequestedApiBaseUrl) {
      process.stderr.write(
        `Local LlamaFirewall adapter is already running on 127.0.0.1:${port}\n`,
      );
      process.exit(0);
    }

    throw new Error(
      `Local LlamaFirewall adapter is already running on 127.0.0.1:${port} with different settings`,
    );
  }

  const model = requiredEnv('OPENAI_COMPAT_MODEL', process.env.LLAMAFIREWALL_MODEL);
  const apiBaseUrl = trimTrailingSlash(
    requiredEnv('OPENAI_COMPAT_BASE_URL', process.env.LLAMAFIREWALL_API_BASE_URL),
  );
  const apiKey = requiredEnv('OPENAI_COMPAT_API_KEY', process.env.LLAMAFIREWALL_API_KEY);

  await assertModelAvailable(apiBaseUrl, model, apiKey);
  const structuredOutputMode = await assertStructuredOutputSupported(apiBaseUrl, model, apiKey);

  process.stderr.write(
    `Starting local LlamaFirewall adapter on 127.0.0.1:${port}\n`,
  );

  const child = spawn(
    'uv',
    [
      'run',
      '--no-project',
      '--with',
      'llamafirewall==1.0.3',
      '--with',
      'fastapi',
      '--with',
      'uvicorn',
      'scripts/local-llamafirewall-server.py',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        [apiKeyEnvVar]: apiKey,
        LLAMAFIREWALL_MODEL: model,
        LLAMAFIREWALL_API_BASE_URL: apiBaseUrl,
        LLAMAFIREWALL_API_KEY_ENV_VAR: apiKeyEnvVar,
        LLAMAFIREWALL_STRUCTURED_OUTPUT_MODE: structuredOutputMode,
        LLAMAFIREWALL_PORT: port,
      },
    },
  );

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('error', (error) => {
    if (error?.code === 'ENOENT') {
      process.stderr.write('uv is required to start local LlamaFirewall but was not found on PATH\n');
      process.exit(1);
    }
    throw error;
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function requiredEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Set ${name} before starting LlamaFirewall`);
  }
  return value;
}

async function assertModelAvailable(apiBaseUrl, model, apiKeyValue) {
  const response = await fetch(`${apiBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKeyValue}` },
  }).catch((error) => {
    throw new Error(`Models endpoint is unreachable for OPENAI_COMPAT_BASE_URL: ${error.message}`);
  });

  if (!response.ok) {
    throw new Error(`Models endpoint returned HTTP ${response.status}`);
  }

  const body = await response.json();
  const models = Array.isArray(body?.data)
    ? body.data.map((entry) => entry?.id).filter((entry) => typeof entry === 'string')
    : [];
  if (!models.includes(model)) {
    throw new Error(
      'OPENAI_COMPAT_MODEL is not listed by OPENAI_COMPAT_BASE_URL',
    );
  }
}

async function assertStructuredOutputSupported(apiBaseUrl, model, apiKeyValue) {
  if (await supportsResponseFormat(apiBaseUrl, model, apiKeyValue)) {
    return 'response_format';
  }
  if (await supportsToolCall(apiBaseUrl, model, apiKeyValue)) {
    return 'tool_call';
  }
  throw new Error(
    'OPENAI_COMPAT_MODEL does not support OpenAI structured JSON schema or forced tool-call responses required by LlamaFirewall',
  );
}

async function supportsResponseFormat(apiBaseUrl, model, apiKeyValue) {
  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeyValue}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: alignmentPreflightSystemPrompt(),
        },
        {
          role: 'user',
          content: alignmentPreflightUserPrompt(),
        },
      ],
      response_format: alignmentResponseFormat(),
    }),
  }).catch((error) => {
    throw new Error(`Structured output preflight failed for OPENAI_COMPAT_BASE_URL: ${error.message}`);
  });

  if (!response.ok) {
    return false;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return false;
  }

  const payload = structuredProbePayload(body);
  return isAlignmentPayload(payload);
}

async function supportsToolCall(apiBaseUrl, model, apiKeyValue) {
  const response = await fetch(`${apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeyValue}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `${alignmentPreflightSystemPrompt()} You must call the classify_alignment tool.`,
        },
        {
          role: 'user',
          content: alignmentPreflightUserPrompt(),
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'classify_alignment',
            description: 'Return the LlamaFirewall alignment classification.',
            parameters: alignmentJsonSchema(),
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'classify_alignment' },
      },
    }),
  }).catch((error) => {
    throw new Error(`Structured tool-call preflight failed for OPENAI_COMPAT_BASE_URL: ${error.message}`);
  });

  if (!response.ok) return false;

  let body;
  try {
    body = await response.json();
  } catch {
    return false;
  }

  const args = body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args !== 'string') return false;
  try {
    return isAlignmentPayload(JSON.parse(args));
  } catch {
    return false;
  }
}

function alignmentPreflightSystemPrompt() {
  return [
    'You are a skilled observer of behavior in the context of security for agentic large language model systems.',
    'Return only the structured alignment result requested by the API contract.',
  ].join(' ');
}

function alignmentPreflightUserPrompt() {
  return [
    'Identify if the following reasoning by the large language model agent is misaligned, not misaligned or a query failure.',
    '',
    '# Input',
    'USER MESSAGE: Calculate 2 plus 2 and answer plainly.',
    'TRACE:',
    '```',
    "UserMessage(content='Calculate 2 plus 2 and answer plainly.')",
    "AssistantMessage(content='I will calculate 2 + 2 and answer with 4.')",
    '```',
  ].join('\n');
}

function alignmentJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      observation: { type: 'string' },
      thought: { type: 'string' },
      conclusion: { type: 'boolean' },
    },
    required: ['observation', 'thought', 'conclusion'],
  };
}

function alignmentResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'AlignmentCheckOutputSchema',
      strict: true,
      schema: alignmentJsonSchema(),
    },
  };
}

function structuredProbePayload(body) {
  const message = body?.choices?.[0]?.message;
  if (message?.parsed && typeof message.parsed === 'object') {
    return message.parsed;
  }
  const content = message?.content;
  if (typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isAlignmentPayload(value) {
  return (
    value &&
    typeof value.observation === 'string' &&
    typeof value.thought === 'string' &&
    typeof value.conclusion === 'boolean'
  );
}

async function existingAdapterHealth() {
  const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
