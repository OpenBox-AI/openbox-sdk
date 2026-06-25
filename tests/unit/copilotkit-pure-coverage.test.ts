import React from 'react';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createCoreClientResolver,
  getAgentIdentity,
  getApprovalBackendApiKey,
  getRuntimeApiKey,
} from '../../ts/src/copilotkit/config-utils.ts';
import {
  asNode,
  asRecord,
  buttonClass,
  parseToolResult,
  rendererStyle,
  resolveTheme,
  textValue,
} from '../../ts/src/copilotkit/react-utils.ts';
import { verdictFromResult } from '../../ts/src/copilotkit/react-governance-decision.ts';
import { createOpenBoxCustomMessageRenderer } from '../../ts/src/copilotkit/react-custom-message-renderer.ts';

const FAKE_AGENT_PRIVATE_KEY = Buffer.alloc(32, 1).toString('base64');

function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('CopilotKit pure utility coverage', () => {
  it('resolves runtime, backend, and signed-agent config branches', () => {
    withEnv(
      {
        OPENBOX_API_KEY: 'obx_test_from_env',
        OPENBOX_BACKEND_API_KEY: 'obx_key_from_env',
        OPENBOX_AGENT_DID: 'did:aip:550e8400-e29b-41d4-a716-446655440001',
        OPENBOX_AGENT_PRIVATE_KEY: FAKE_AGENT_PRIVATE_KEY,
      },
      () => {
        expect(getRuntimeApiKey({})).toBe('obx_test_from_env');
        expect(getRuntimeApiKey({ apiKey: 'obx_live_explicit' })).toBe(
          'obx_live_explicit',
        );
        expect(getApprovalBackendApiKey({})).toBe('obx_key_from_env');
        expect(getApprovalBackendApiKey({ backendApiKey: 'obx_key_explicit' })).toBe(
          'obx_key_explicit',
        );
        expect(getAgentIdentity({})).toEqual({
          did: 'did:aip:550e8400-e29b-41d4-a716-446655440001',
          privateKey: FAKE_AGENT_PRIVATE_KEY,
        });
        expect(
          getAgentIdentity({
            agentIdentity: {
              did: 'did:aip:550e8400-e29b-41d4-a716-446655440002',
              privateKey: FAKE_AGENT_PRIVATE_KEY,
            },
          }),
        ).toEqual({
          did: 'did:aip:550e8400-e29b-41d4-a716-446655440002',
          privateKey: FAKE_AGENT_PRIVATE_KEY,
        });
      },
    );

    withEnv(
      {
        OPENBOX_API_KEY: undefined,
        OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
      },
      () => {
        expect(() => createCoreClientResolver({})()).toThrow(
          'runtime API key is not configured',
        );
      },
    );
    withEnv(
      {
        OPENBOX_API_KEY: 'plain-key',
        OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
      },
      () => {
        expect(() => createCoreClientResolver({})()).toThrow(
          'must be an obx_live_* or obx_test_* key',
        );
      },
    );
    withEnv(
      {
        OPENBOX_API_KEY: 'obx_test_runtime',
        OPENBOX_CORE_URL: undefined,
      },
      () => {
        expect(() => createCoreClientResolver({})()).toThrow(
          'Core URL is not configured',
        );
      },
    );
  });

  it('reads optional project-local CopilotKit runtime config without mutation', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openbox-copilotkit-config-'));
    const configDir = join(cwd, '.openbox', 'copilotkit');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, '.env'),
      [
        'OPENBOX_API_KEY="obx_test_project"',
        'OPENBOX_CORE_URL="http://127.0.0.1:8086"',
        'OPENBOX_BACKEND_API_KEY="obx_key_project"',
        'OPENBOX_AGENT_DID="did:aip:550e8400-e29b-41d4-a716-446655440000"',
        `OPENBOX_AGENT_PRIVATE_KEY="${FAKE_AGENT_PRIVATE_KEY}"`,
      ].join('\n') + '\n',
    );

    withEnv(
      {
        OPENBOX_API_KEY: undefined,
        OPENBOX_CORE_URL: undefined,
        OPENBOX_BACKEND_API_KEY: undefined,
        OPENBOX_AGENT_DID: undefined,
        OPENBOX_AGENT_PRIVATE_KEY: undefined,
      },
      () => {
        expect(getRuntimeApiKey({ cwd })).toBe('obx_test_project');
        expect(getApprovalBackendApiKey({ cwd })).toBe('obx_key_project');
        expect(getAgentIdentity({ cwd })).toEqual({
          did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
          privateKey: FAKE_AGENT_PRIVATE_KEY,
        });
        expect(() => createCoreClientResolver({ cwd })()).not.toThrow();
      },
    );
  });

  it('caches Core clients until the runtime cache key changes', () => {
    withEnv(
      {
        OPENBOX_API_KEY: 'obx_test_runtime',
        OPENBOX_CORE_URL: 'http://127.0.0.1:8086',
        OPENBOX_AGENT_DID: undefined,
        OPENBOX_AGENT_PRIVATE_KEY: undefined,
      },
      () => {
        const resolver = createCoreClientResolver({});
        const first = resolver();
        const second = resolver();
        expect(second).toBe(first);

        process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440003';
        process.env.OPENBOX_AGENT_PRIVATE_KEY = FAKE_AGENT_PRIVATE_KEY;
        const third = resolver();
        expect(third).not.toBe(first);
      },
    );
  });

  it('covers React renderer utility branches without rendering components', () => {
    expect(buttonClass('primary')).toContain('text-white');
    expect(buttonClass('secondary')).toContain('border');
    expect(parseToolResult('{"ok":true}')).toEqual({ ok: true });
    expect(parseToolResult('"plain"')).toEqual({});
    expect(parseToolResult('bad json')).toEqual({});
    expect(parseToolResult(null)).toEqual({});
    expect(parseToolResult({ ok: true })).toEqual({ ok: true });
    expect(asRecord(false)).toEqual({});
    expect(asRecord({ ok: true })).toEqual({ ok: true });
    expect(textValue(null)).toBe('');
    expect(textValue('text')).toBe('text');
    expect(textValue(42)).toBe('42');
    expect(textValue(true)).toBe('true');
    expect(textValue({})).toBe('');

    expect(resolveTheme(undefined, '/logo.svg')).toMatchObject({
      mode: 'auto',
      density: 'comfortable',
      logoSrc: '/logo.svg',
    });
    expect(resolveTheme({ logoSrc: '/custom.svg', density: 'compact' })).toMatchObject({
      logoSrc: '/custom.svg',
      density: 'compact',
    });
    expect(rendererStyle({ accentColor: '#111', radius: 4, density: 'compact' })).toMatchObject({
      '--obx-accent': '#111',
      '--obx-radius': '4px',
      '--obx-density-scale': '0.82',
    });
    expect(rendererStyle({ radius: '12px' })).toMatchObject({
      '--obx-radius': '12px',
      '--obx-density-scale': '1',
    });

    const node = React.createElement('span', null, 'ok');
    expect(asNode(node)).toBe(node);
    expect(asNode('ok')).toBe('ok');
    expect(asNode(1)).toBe(1);
    expect(asNode(null)).toBeUndefined();
    expect(asNode({})).toBeUndefined();
  });

  it('maps governance result verdicts for every UI branch', () => {
    const scenario = {
      action: 'demo_action',
      title: 'Demo',
      reason: 'Evaluate the action.',
      capability: 'Runtime governance',
      verdict: 'allow' as const,
    };

    expect(verdictFromResult({ status: 'approval_required' }, scenario)).toBe(
      'approval',
    );
    expect(verdictFromResult({ status: 'rejected' }, scenario)).toBe('rejected');
    expect(verdictFromResult({ status: 'error' }, scenario)).toBe('error');
    expect(verdictFromResult({ verdict: 'error' }, scenario)).toBe('error');
    expect(verdictFromResult({ status: 'halted' }, scenario)).toBe('halt');
    expect(verdictFromResult({ verdict: 'halt' }, scenario)).toBe('halt');
    expect(verdictFromResult({ status: 'constrained' }, scenario)).toBe(
      'constrain',
    );
    expect(verdictFromResult({ verdict: 'constrain' }, scenario)).toBe(
      'constrain',
    );
    expect(
      verdictFromResult(
        { status: 'executed', redactionSummary: 'OpenBox redacted field.' },
        scenario,
      ),
    ).toBe('constrain');
    expect(verdictFromResult({ status: 'executed' }, scenario)).toBe('allow');
    expect(verdictFromResult({ verdict: 'allow' }, scenario)).toBe('allow');
    expect(verdictFromResult({ status: 'blocked' }, scenario)).toBe('block');
    expect(verdictFromResult({ status: 'approval_pending' }, scenario)).toBe(
      'block',
    );
    expect(verdictFromResult({ verdict: 'block' }, scenario)).toBe('block');
    expect(verdictFromResult({ verdict: 'require_approval' }, scenario)).toBe(
      'approval',
    );
    expect(verdictFromResult({}, scenario)).toBe('reviewing');
  });

  it('finds OpenBox custom message results across renderer edge shapes', () => {
    const result = JSON.stringify({
      schemaVersion: 'openbox.copilotkit.result.v1',
      status: 'executed',
      verdict: 'allow',
      action: 'demo_action',
      artifact: { type: 'demo' },
    });
    const customDecision = React.createElement('div', { id: 'decision' });
    const customResult = React.createElement('div', { id: 'result' });
    const renderer = createOpenBoxCustomMessageRenderer({
      agentId: 'agent-1',
      renderGovernanceDecision: () => customDecision,
      renderActionResult: () => customResult,
    });
    const render = renderer.render as (props: Record<string, unknown>) => unknown;

    expect(renderer.agentId).toBe('agent-1');
    expect(render({ position: 'middle', message: {} })).toBeNull();
    expect(
      render({
        position: 'after',
        message: { role: 'tool', content: '{"schemaVersion":"other"}' },
      }),
    ).toBeNull();
    const direct = render({
      position: 'after',
      message: { role: 'tool', name: 'tool-name', content: result },
    }) as React.ReactElement;
    expect(direct.type).toBe(React.Fragment);
    expect((direct.props as any).children).toEqual([customDecision, customResult]);

    const defaultRenderer = createOpenBoxCustomMessageRenderer({
      artifactRenderers: {
        demo: () => React.createElement('span', null, 'artifact'),
      },
    });
    const defaultRender = defaultRenderer.render as (
      props: Record<string, unknown>,
    ) => unknown;
    const fromAdditionalKwargs = defaultRender({
      position: 'before',
      message: {
        type: 'ai',
        additional_kwargs: {
          tool_calls: [
            {
              id: 'call-1',
              function: { name: 'openbox_governed_action' },
            },
          ],
        },
      },
      stateSnapshot: {
        messages: [
          {
            role: 'tool',
            tool_call_id: 'call-1',
            content: result,
          },
        ],
      },
    }) as React.ReactElement;
    expect(fromAdditionalKwargs.type).toBe(React.Fragment);

    expect(
      defaultRender({
        position: 'after',
        message: {
          role: 'assistant',
          toolCalls: [{ id: 'call-2', name: 'not_openbox' }],
        },
        stateSnapshot: { messages: [] },
      }),
    ).toBeNull();
    expect(
      defaultRender({
        position: 'after',
        message: {
          role: 'assistant',
          tool_calls: [{ id: 'call-3', name: 'openbox_governed_action' }],
        },
        stateSnapshot: {
          messages: [{ role: 'tool', toolCallId: 'other', content: result }],
        },
      }),
    ).toBeNull();
  });
});
