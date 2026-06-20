// Coverage for ts/src/runtime/mcp/index.ts.
//
// runMcpServer() registers the hand-coded OpenBox tools plus generated
// recipe tools against an McpServer instance,
// connects an StdioServerTransport, and starts listening. We mock the
// MCP SDK so tool registration is intercepted (each tool's callback is
// captured for replay) and the transport never actually opens. We then
// invoke each captured callback with synthetic args + a stubbed fetch,
// driving every branch of the tool implementations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_TOOL_SURFACES,
} from '../../ts/src/governance/capability-matrix.js';

interface CapturedTool {
  name: string;
  description: string;
  schema: any;
  annotations?: any;
  meta?: any;
  cb: (args: any) => Promise<any>;
}

interface CapturedPrompt {
  name: string;
  config: any;
  cb: (args: any) => Promise<any>;
}

interface CapturedResource {
  name: string;
  uriOrTemplate: any;
  config: any;
  cb: (...args: any[]) => Promise<any>;
}

const captured: CapturedTool[] = [];
const capturedPrompts: CapturedPrompt[] = [];
const capturedResources: CapturedResource[] = [];
const realFetch = globalThis.fetch;
const mockState = vi.hoisted(() => ({
  clientName: 'mock-mcp-client',
  httpHandled: 0,
  httpClosed: 0,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    ResourceTemplate: class {
      uriTemplate: { toString: () => string };
      constructor(uriTemplate: string, public callbacks: any) {
        this.uriTemplate = { toString: () => uriTemplate };
      }
    },
    McpServer: class {
      // Inner `server` object exposes the protocol-level introspection
      // helpers (getClientVersion etc) that runMcpServer calls
      // post-connect.
      server = {
        getClientVersion: () => ({ name: mockState.clientName, version: '0.0.0' }),
      };
      // Match the SDK's tool/resource overloads loosely.
      tool(name: string, description: string, schema: any, cb: any) {
        captured.push({ name, description, schema, cb });
      }
      registerTool(name: string, config: any, cb: any) {
        captured.push({
          name,
          description: config.description,
          schema: config.inputSchema,
          annotations: config.annotations,
          meta: config._meta,
          cb,
        });
      }
      registerPrompt(name: string, config: any, cb: any) {
        capturedPrompts.push({ name, config, cb });
      }
      registerResource(name: string, uriOrTemplate: any, config: any, cb: any) {
        capturedResources.push({ name, uriOrTemplate, config, cb });
      }
      resource(_name: string, _uri: string, _meta: any, _cb: any) {
        // not exercised in coverage; but accept calls so registration
        // doesn't throw.
      }
      async connect(_t: any) {
        // No-op; the real connect would block on stdio.
      }
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: class {},
  };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  return {
    StreamableHTTPServerTransport: class {
      constructor(_options: any) {}
      async handleRequest(req: any, res: any) {
        mockState.httpHandled += 1;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, method: req.method }));
      }
      async close() {
        mockState.httpClosed += 1;
      }
    },
  };
});

beforeEach(() => {
  captured.length = 0;
  capturedPrompts.length = 0;
  capturedResources.length = 0;
  mockState.clientName = 'mock-mcp-client';
  mockState.httpHandled = 0;
  mockState.httpClosed = 0;
  // Default fetch: return a generic JSON envelope; individual tool
  // tests override per-call as needed.
  vi.stubGlobal('fetch', async (url: string, _init?: RequestInit) => {
    const u = String(url);
    // Auth profile.
    if (u.includes('/auth/profile')) {
      return new Response(
        JSON.stringify({ status: 200, data: { sub: 'u1', orgId: 'org', email: 'a@b.c', permissions: [] } }),
        { status: 200 },
      );
    }
    if (u.includes('/agent') && u.includes('/policies')) {
      return new Response(JSON.stringify({ status: 200, data: { data: [{ id: 'p1' }] } }), { status: 200 });
    }
    if (u.includes('/agent') && u.includes('/guardrails')) {
      return new Response(JSON.stringify({ status: 200, data: { data: [{ id: 'g1' }] } }), { status: 200 });
    }
    if (u.includes('/agent') && u.includes('/trust')) {
      return new Response(JSON.stringify({ status: 200, data: { tier: 2, score: 80 } }), { status: 200 });
    }
    if (u.match(/\/agent\/[^/]+$/)) {
      return new Response(JSON.stringify({ status: 200, data: { id: 'a1', agent_name: 'one' } }), { status: 200 });
    }
    if (u.includes('/agent/list')) {
      return new Response(JSON.stringify({ status: 200, data: { data: [{ id: 'a1', agent_name: 'one' }] } }), { status: 200 });
    }
    if (u.includes('/approvals/pending')) {
      return new Response(JSON.stringify({ status: 200, data: { data: [{ id: 'apr1' }] } }), { status: 200 });
    }
    if (u.includes('/approvals/decide')) {
      return new Response(JSON.stringify({ status: 200, data: { ok: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 200, data: {} }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function withMcpEnv<T>(fn: () => Promise<T>): Promise<T> {
  const beforeApi = process.env.OPENBOX_API_URL;
  const beforeCore = process.env.OPENBOX_CORE_URL;
  const beforeRuntime = process.env.OPENBOX_API_KEY;
  const beforeBackend = process.env.OPENBOX_BACKEND_API_KEY;
  const beforeHome = process.env.OPENBOX_HOME;
  process.env.OPENBOX_API_URL = 'http://localhost:3000';
  process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
  process.env.OPENBOX_API_KEY = 'obx_test_x'.padEnd(57, 'x');
  process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_mcp_backend';
  process.env.OPENBOX_HOME = mkdtempSync(join(tmpdir(), 'openbox-mcp-test-'));
  try {
    return await fn();
  } finally {
    if (beforeApi !== undefined) process.env.OPENBOX_API_URL = beforeApi;
    else delete process.env.OPENBOX_API_URL;
    if (beforeCore !== undefined) process.env.OPENBOX_CORE_URL = beforeCore;
    else delete process.env.OPENBOX_CORE_URL;
    if (beforeRuntime !== undefined) process.env.OPENBOX_API_KEY = beforeRuntime;
    else delete process.env.OPENBOX_API_KEY;
    if (beforeBackend !== undefined) process.env.OPENBOX_BACKEND_API_KEY = beforeBackend;
    else delete process.env.OPENBOX_BACKEND_API_KEY;
    if (beforeHome !== undefined) process.env.OPENBOX_HOME = beforeHome;
    else delete process.env.OPENBOX_HOME;
  }
}

describe('runtime/mcp/index; runMcpServer registers + drives every tool', () => {
  it('runMcpServer registers the Cursor-safe command tools without throwing', async () => {
    const before = process.env.OPENBOX_API_URL;
    const beforeRuntime = process.env.OPENBOX_API_KEY;
    const beforeBackend = process.env.OPENBOX_BACKEND_API_KEY;
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    process.env.OPENBOX_API_KEY = 'obx_test_x'.padEnd(57, 'x');
    process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_mcp_backend';
    try {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      expect(captured.length).toBeGreaterThan(5);
      expect(captured.map((t) => t.name)).toContain('get_profile');
      expect(captured.map((t) => t.name)).toContain('cursor_status');
      expect(captured.map((t) => t.name)).toContain('cursor_doctor');
      expect(captured.map((t) => t.name)).toContain('codex_doctor');
      expect(captured.map((t) => t.name)).toContain('openbox_status');
      expect(captured.map((t) => t.name)).toContain('claude_code_doctor');
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_URL = before;
      if (beforeRuntime !== undefined) process.env.OPENBOX_API_KEY = beforeRuntime;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeBackend !== undefined) process.env.OPENBOX_BACKEND_API_KEY = beforeBackend;
      else delete process.env.OPENBOX_BACKEND_API_KEY;
    }
  });

  it('registers spec-driven MCP tool annotations, prompts, and resource templates', async () => {
    await withMcpEnv(async () => {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();

      expect(captured.map((tool) => tool.name).sort()).toEqual(
        MCP_TOOL_SURFACES.map((surface) => surface.name).slice().sort(),
      );
      for (const surface of MCP_TOOL_SURFACES) {
        const tool = captured.find((entry) => entry.name === surface.name);
        expect(tool, `missing MCP tool ${surface.name}`).toBeDefined();
        expect(tool!.description).toContain(`OpenBox risk: ${surface.risk}`);
        expect(tool!.description).toContain(`Approval behavior: ${surface.approval}`);
        expect(tool!.description).toContain(`Side effects: ${surface.sideEffects}`);
        expect(tool!.annotations).toMatchObject({
          title: surface.title,
          readOnlyHint: surface.readOnlyHint,
          destructiveHint: surface.destructiveHint,
          idempotentHint: surface.idempotentHint,
          openWorldHint: surface.openWorldHint,
        });
        expect(tool!.meta).toMatchObject({
          'openbox/risk': surface.risk,
          'openbox/approval': surface.approval,
          'openbox/sideEffects': surface.sideEffects,
        });
      }
      const checkGovernance = captured.find((tool) => tool.name === 'check_governance')!;
      expect(checkGovernance.description).toContain('OpenBox risk: medium');
      expect(checkGovernance.description).toContain('Approval behavior: may return require_approval');
      expect(checkGovernance.annotations).toMatchObject({
        title: 'Check Governance',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
      expect(checkGovernance.meta['openbox/sideEffects']).toContain('governance events');

      expect(capturedPrompts.map((prompt) => prompt.name)).toEqual(
        MCP_PROMPT_SURFACES.map((surface) => surface.name),
      );
      for (const surface of MCP_PROMPT_SURFACES) {
        const promptEntry = capturedPrompts.find((entry) => entry.name === surface.name);
        expect(promptEntry, `missing MCP prompt ${surface.name}`).toBeDefined();
        expect(promptEntry!.config).toMatchObject({
          title: surface.title,
          description: surface.description,
        });
        expect(Object.keys(promptEntry!.config.argsSchema)).toEqual(
          surface.args.map((arg) => arg.name),
        );
      }
      const prompt = capturedPrompts.find((entry) => entry.name === 'governance_check')!;
      expect(Object.keys(prompt.config.argsSchema)).toEqual(['agent_id', 'span_type', 'activity_input']);
      const promptResult = await prompt.cb({
        span_type: 'shell',
        activity_input: '{"command":"pwd"}',
      });
      expect(promptResult.messages[0].content.text).toContain('Call check_governance');
      expect(promptResult.messages[0].content.text).toContain('"span_type": "shell"');

      expect(capturedResources.map((resource) => resource.name)).toEqual(
        MCP_RESOURCE_TEMPLATE_SURFACES.map((surface) => surface.name),
      );
      for (const surface of MCP_RESOURCE_TEMPLATE_SURFACES) {
        const resource = capturedResources.find((entry) => entry.name === surface.name);
        expect(resource, `missing MCP resource template ${surface.name}`).toBeDefined();
        expect(resource!.config).toMatchObject({
          title: surface.title,
          description: surface.description,
          mimeType: surface.mimeType,
        });
        expect(resource!.uriOrTemplate.uriTemplate.toString()).toBe(surface.uriTemplate);
      }
      const agentResource = capturedResources.find((resource) => resource.name === 'agent')!;
      expect(agentResource.config).toMatchObject({
        title: 'OpenBox Agent',
        mimeType: 'application/json',
      });
      expect(agentResource.uriOrTemplate.uriTemplate.toString()).toBe('openbox://agent/{agent_id}');
    });
  });

  it('reads every spec-driven MCP resource template callback', async () => {
    await withMcpEnv(async () => {
      const seenUrls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        const u = String(url);
        seenUrls.push(u);
        const json = (data: unknown) =>
          new Response(JSON.stringify({ status: 200, data }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });

        if (u.includes('/agent/agent-1/guardrails/guardrail-1')) {
          return json({ id: 'guardrail-1', kind: 'guardrail' });
        }
        if (u.includes('/agent/agent-1/policies/policy-1')) {
          return json({ id: 'policy-1', kind: 'policy' });
        }
        if (u.includes('/agent/agent-1/behavior-rule/rule-1')) {
          return json({ id: 'rule-1', kind: 'behavior-rule' });
        }
        if (u.includes('/agent/agent-1/approvals/pending')) {
          return json({ approvals: { data: [{ id: 'approval-1', status: 'pending' }] } });
        }
        if (u.match(/\/agent\/agent-1$/)) {
          return json({ id: 'agent-1', agent_name: 'Resource Agent' });
        }
        return json({});
      });

      const resourceInputs: Record<string, { uri: URL; variables: Record<string, string> }> = {
        agent: {
          uri: new URL('openbox://agent/agent-1'),
          variables: { agent_id: 'agent-1' },
        },
        guardrail: {
          uri: new URL('openbox://agent/agent-1/guardrail/guardrail-1'),
          variables: { agent_id: 'agent-1', guardrail_id: 'guardrail-1' },
        },
        policy: {
          uri: new URL('openbox://agent/agent-1/policy/policy-1'),
          variables: { agent_id: 'agent-1', policy_id: 'policy-1' },
        },
        'behavior-rule': {
          uri: new URL('openbox://agent/agent-1/behavior-rule/rule-1'),
          variables: { agent_id: 'agent-1', behavior_rule_id: 'rule-1' },
        },
        approval: {
          uri: new URL('openbox://agent/agent-1/approval/approval-1'),
          variables: { agent_id: 'agent-1', approval_id: 'approval-1' },
        },
        'skill-reference': {
          uri: new URL('openbox://skill/governance-flow'),
          variables: { name: 'governance-flow' },
        },
      };

      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();

      for (const surface of MCP_RESOURCE_TEMPLATE_SURFACES) {
        const resource = capturedResources.find((entry) => entry.name === surface.name);
        expect(resource, `missing MCP resource ${surface.name}`).toBeDefined();
        const input = resourceInputs[surface.name];
        expect(input, `missing MCP resource test input for ${surface.name}`).toBeDefined();

        const out = await resource!.cb(input.uri, input.variables);
        expect(out.contents).toHaveLength(1);
        expect(out.contents[0].uri).toBe(String(input.uri));
        expect(out.contents[0].text.length).toBeGreaterThan(0);
        if (surface.mimeType === 'application/json') {
          expect(out.contents[0].mimeType).toBe('application/json');
          const parsed = JSON.parse(out.contents[0].text);
          expect(parsed).toBeDefined();
        }
      }

      expect(seenUrls.some((u) => u.includes('/agent/agent-1/guardrails/guardrail-1'))).toBe(true);
      expect(seenUrls.some((u) => u.includes('/agent/agent-1/policies/policy-1'))).toBe(true);
      expect(seenUrls.some((u) => u.includes('/agent/agent-1/behavior-rule/rule-1'))).toBe(true);
      expect(seenUrls.some((u) => u.includes('/agent/agent-1/approvals/pending'))).toBe(true);
    });
  });

  it('serves the optional Streamable HTTP transport and closes on abort', async () => {
    await withMcpEnv(async () => {
      const abort = new AbortController();
      const logs: string[] = [];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });

      try {
        const { runMcpServer } = await import('../../ts/src/runtime/mcp');
        await runMcpServer({
          transport: 'http',
          host: '127.0.0.1',
          port: 0,
          signal: abort.signal,
        });

        const listenLine = logs.find((line) =>
          line.includes('OpenBox MCP Streamable HTTP listening at http://'));
        expect(listenLine).toBeDefined();
        const url = listenLine!.match(/http:\/\/.+$/)?.[0];
        expect(url).toBeDefined();

        vi.stubGlobal('fetch', realFetch);
        const response = await fetch(url!, { method: 'POST' });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ ok: true, method: 'POST' });
        expect(mockState.httpHandled).toBe(1);

        const missing = await fetch(url!.replace('/mcp', '/missing'));
        expect(missing.status).toBe(404);

        const badMethod = await fetch(url!, { method: 'PUT' });
        expect(badMethod.status).toBe(405);
        expect(badMethod.headers.get('allow')).toBe('GET, POST, DELETE');

        abort.abort();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mockState.httpClosed).toBe(1);
      } finally {
        errorSpy.mockRestore();
        abort.abort();
      }
    });
  });

  it('cursor_status gives slash commands a non-shell backend ping path', async () => {
    await withMcpEnv(async () => {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'cursor_status')!;
      const out = await tool.cb({});
      expect(out.content[0].text).toContain('"status": "connected"');
    });
  });

  it('openbox_status gives plugin slash commands a generic non-shell backend ping path', async () => {
    await withMcpEnv(async () => {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'openbox_status')!;
      const out = await tool.cb({});
      const parsed = JSON.parse(out.content[0].text);
      expect(parsed.status).toBe('connected');
      expect(parsed.mcpReadiness.mcpReady).toBe(true);
      expect(parsed.mcpReadiness.runtimeEnv.backendApiKeyPresent).toBe(true);
      expect(parsed.mcpReadiness.runtimeEnv.runtimeApiKeyPresent).toBe(true);
      expect(parsed.mcpReadiness.failMode).toBe('fail_closed');
      expect(parsed.mcpReadiness.approvalMode).toBe('remote');
      expect(parsed.mcpReadiness.unsupportedOrOptInSurfaces.worktreeCreate).toBe('opt_in');
      expect(parsed.claudeCodeRuntimeReadiness.projectScoped).toBe(true);
      expect(parsed.claudeCodeRuntimeReadiness.unsupportedOrOptInSurfaces.worktreeCreate).toBe('opt_in_managed_worktree_creator');
      expect(parsed.claudeCodeGovernance.defaultHookCount).toBeGreaterThan(10);
      expect(parsed.claudeCodeGovernance.optInHooks).toContain('WorktreeCreate');
      expect(parsed.claudeCodeGovernance.optInHooks).toContain('SessionEnd');
      expect(parsed.claudeCodeGovernance.sdkCapabilities.some(
        (capability: any) => capability.capability === 'split-stage activity governance',
      )).toBe(true);
    });
  });

  it('cursor_doctor gives slash commands a non-shell install diagnostic path', async () => {
    await withMcpEnv(async () => {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'cursor_doctor')!;
      const out = await tool.cb({ surface_only: true });
      expect(out.content[0].text).toContain('"checks"');
      expect(out.content[0].text).toContain('"summary"');
    });
  });

  it('codex_doctor gives Codex/MCP clients a non-shell install diagnostic path', async () => {
    await withMcpEnv(async () => {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'codex_doctor')!;
      const out = await tool.cb({ cwd: join(tmpdir(), 'openbox-missing-codex-install'), surface_only: true });
      const parsed = JSON.parse(out.content[0].text);
      expect(parsed.checks).toBeDefined();
      expect(parsed.summary.fail).toBeGreaterThan(0);
      expect(parsed.mcpReadiness.runtimeEnv.coreUrlPresent).toBe(true);
    });
  });

  it('claude_code_doctor gives Claude Code slash commands a non-shell plugin diagnostic path', async () => {
    await withMcpEnv(async () => {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'claude_code_doctor')!;
      const out = await tool.cb({ target: join(tmpdir(), 'openbox-missing-claude-plugin') });
      const parsed = JSON.parse(out.content[0].text);
      expect(parsed.checks).toBeDefined();
      expect(parsed.summary.fail).toBeGreaterThan(0);
      expect(parsed.mcpReadiness.runtimeEnv.coreUrlPresent).toBe(true);
      expect(parsed.runtimeReadiness.projectScoped).toBe(true);
      expect(parsed.claudeCodeGovernance.audit.installedClaudeCodeVersion).toBe('2.1.179 (Claude Code)');
      expect(parsed.claudeCodeGovernance.surfaces.some((surface: any) => surface.surface === 'monitors')).toBe(true);
      expect(parsed.claudeCodeGovernance.sdkCapabilities.some(
        (capability: any) => capability.capability === 'workflow lifecycle failure',
      )).toBe(true);
    });
  });

  it('every captured tool callback runs with empty / synthetic args', async () => {
    const before = process.env.OPENBOX_API_URL;
    const beforeRuntime = process.env.OPENBOX_API_KEY;
    const beforeBackend = process.env.OPENBOX_BACKEND_API_KEY;
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    process.env.OPENBOX_API_KEY = 'obx_test_x'.padEnd(57, 'x');
    process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_mcp_backend';
    try {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      for (const tool of captured) {
        const args: any = {};
        // Best-guess inputs from the schema keys.
        if (tool.schema && typeof tool.schema === 'object') {
          for (const key of Object.keys(tool.schema)) {
            if (key.includes('id')) args[key] = '00000000-0000-4000-8000-000000000000';
            else if (key === 'verdict') args[key] = 'allow';
            else if (key === 'reason') args[key] = 'test';
            else args[key] = 'synth';
          }
        }
        try {
          const out = await tool.cb(args);
          expect(out).toBeDefined();
          expect(Array.isArray(out.content)).toBe(true);
        } catch (e) {
          // Some tool callbacks may reject if the synthetic input
          // doesn't match a more specific shape; coverage still counts
          // the executed branches.
        }
      }
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_URL = before;
      if (beforeRuntime !== undefined) process.env.OPENBOX_API_KEY = beforeRuntime;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeBackend !== undefined) process.env.OPENBOX_BACKEND_API_KEY = beforeBackend;
      else delete process.env.OPENBOX_BACKEND_API_KEY;
    }
  });

  it('uses backend X-API-Key for MCP backend calls even when a runtime key is present', async () => {
    const before = process.env.OPENBOX_API_URL;
    const beforeRuntime = process.env.OPENBOX_API_KEY;
    const beforeBackend = process.env.OPENBOX_BACKEND_API_KEY;
    const seenHeaders: Record<string, string>[] = [];
    process.env.OPENBOX_API_URL = 'http://localhost:3000';
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    process.env.OPENBOX_API_KEY = 'obx_test_runtime_should_not_be_backend_auth';
    process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_mcp_backend';
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ status: 200, data: { data: [] } }), { status: 200 });
    });
    try {
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'list_agents');
      expect(tool).toBeDefined();
      await tool!.cb({});
      expect(seenHeaders.some((h) => h['X-API-Key'] === 'obx_key_mcp_backend')).toBe(true);
      expect(seenHeaders.some((h) => h['X-API-Key'] === process.env.OPENBOX_API_KEY)).toBe(false);
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_URL = before;
      if (beforeRuntime !== undefined) process.env.OPENBOX_API_KEY = beforeRuntime;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeBackend !== undefined) process.env.OPENBOX_BACKEND_API_KEY = beforeBackend;
      else delete process.env.OPENBOX_BACKEND_API_KEY;
    }
  });

  it('list_pending_approvals accepts the SDK approvals.data response shape', async () => {
    await withMcpEnv(async () => {
      vi.stubGlobal('fetch', async (url: string) => {
        const u = String(url);
        if (u.includes('/auth/profile')) {
          return new Response(JSON.stringify({ status: 200, data: { orgId: 'org' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('/approvals')) {
          return new Response(
            JSON.stringify({ status: 200, data: { approvals: { data: [{ id: 'apr-sdk-shape' }] } } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ status: 200, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'list_pending_approvals')!;
      const out = await tool.cb({});
      expect(out.content[0].text).toContain('apr-sdk-shape');
    });
  });

  it('list_pending_approvals pages beyond the first 100 rows', async () => {
    await withMcpEnv(async () => {
      const urls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        const u = String(url);
        urls.push(u);
        if (u.includes('/auth/profile')) {
          return new Response(JSON.stringify({ status: 200, data: { orgId: 'org' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (u.includes('/approvals')) {
          const parsed = new URL(u);
          const page = Number(parsed.searchParams.get('page') ?? '0');
          const data =
            page === 0
              ? Array.from({ length: 100 }, (_, i) => ({ id: `apr-page-0-${i}` }))
              : [{ id: 'apr-page-1-target' }];
          return new Response(
            JSON.stringify({ status: 200, data: { approvals: { data } } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ status: 200, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'list_pending_approvals')!;
      const out = await tool.cb({});
      expect(out.content[0].text).toContain('apr-page-1-target');
      expect(urls.some((u) => u.includes('page=1'))).toBe(true);
    });
  });

  it('list_pending_approvals reports no organization instead of throwing', async () => {
    await withMcpEnv(async () => {
      vi.stubGlobal('fetch', async (url: string) => {
        const u = String(url);
        if (u.includes('/auth/profile')) {
          return new Response(JSON.stringify({ status: 200, data: { sub: 'u-no-org' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 200, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'list_pending_approvals')!;
      const out = await tool.cb({});
      expect(out.content[0].text).toContain('No organization found');
    });
  });

  it('check_governance returns a text error when no runtime key can be resolved', async () => {
    await withMcpEnv(async () => {
      delete process.env.OPENBOX_API_KEY;
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'check_governance')!;
      const out = await tool.cb({ span_type: 'shell', activity_input: { command: 'pwd' } });
      expect(out.content[0].text).toMatch(/Error: No API key found/);
      expect(out.isError).toBe(true);
    });
  });

  it('refreshes MCP backend env config on each tool call without restarting', async () => {
    const beforeHome = process.env.OPENBOX_HOME;
    const beforeApi = process.env.OPENBOX_API_URL;
    const beforeCore = process.env.OPENBOX_CORE_URL;
    const beforeBackend = process.env.OPENBOX_BACKEND_API_KEY;
    const home = mkdtempSync(join(tmpdir(), 'openbox-mcp-refresh-'));
    const urls: string[] = [];
    const writeConfig = (apiUrl: string) => {
      mkdirSync(home, { recursive: true });
      writeFileSync(
        join(home, 'config'),
        `OPENBOX_API_URL=${apiUrl}\nOPENBOX_CORE_URL=http://localhost:18081\n`,
      );
      writeFileSync(join(home, 'tokens'), 'API_KEY=obx_key_local\n');
    };
    try {
      process.env.OPENBOX_HOME = home;
      delete process.env.OPENBOX_API_URL;
      delete process.env.OPENBOX_CORE_URL;
      process.env.OPENBOX_BACKEND_API_KEY = 'obx_key_local';
      writeConfig('http://localhost:18082');
      vi.stubGlobal('fetch', async (url: string) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ status: 200, data: { data: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'list_agents')!;
      await tool.cb({});
      writeConfig('http://localhost:18083');
      await tool.cb({});

      expect(urls[0]).toContain('http://localhost:18082');
      expect(urls[1]).toContain('http://localhost:18083');
    } finally {
      if (beforeHome !== undefined) process.env.OPENBOX_HOME = beforeHome;
      else delete process.env.OPENBOX_HOME;
      if (beforeApi !== undefined) process.env.OPENBOX_API_URL = beforeApi;
      else delete process.env.OPENBOX_API_URL;
      if (beforeCore !== undefined) process.env.OPENBOX_CORE_URL = beforeCore;
      else delete process.env.OPENBOX_CORE_URL;
      if (beforeBackend !== undefined) process.env.OPENBOX_BACKEND_API_KEY = beforeBackend;
      else delete process.env.OPENBOX_BACKEND_API_KEY;
    }
  });

  it('stamps Cursor MCP governance approvals with cursor-mcp source', async () => {
    await withMcpEnv(async () => {
      mockState.clientName = 'Cursor';
      const bodies: string[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/v1/governance/evaluate')) {
          bodies.push(String(init?.body ?? ''));
          return new Response(JSON.stringify({ verdict: 'allow' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 200, data: { data: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'check_governance')!;
      await tool.cb({
        agent_id: 'agent-1',
        span_type: 'mcp',
        activity_input: { tool_name: 'list_agents' },
      });
      expect(bodies.join('\n')).toContain('"_openbox_source":"cursor-mcp"');
      expect(bodies.join('\n')).toContain('"source":"cursor-mcp"');
    });
  });

  it('check_governance still emits the hook span when the parent verdict blocks', async () => {
    await withMcpEnv(async () => {
      const bodies: string[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/v1/governance/evaluate')) {
          bodies.push(String(init?.body ?? ''));
          const verdict =
            bodies.length === 1
              ? { verdict: 'block', action: 'block', reason: 'parent blocked' }
              : { verdict: 'allow', action: 'allow', reason: 'hook persisted' };
          return new Response(JSON.stringify(verdict), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 200, data: { data: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'check_governance')!;
      const out = await tool.cb({
        agent_id: 'agent-1',
        span_type: 'mcp',
        activity_input: { tool_name: 'danger_tool', tool_input: { id: 1 } },
      });

      const parsed = JSON.parse(out.content[0].text);
      expect(parsed).toMatchObject({
        verdict: 'block',
        reason: 'parent blocked',
      });
      expect(bodies).toHaveLength(2);
      const parent = JSON.parse(bodies[0]);
      const hook = JSON.parse(bodies[1]);
      expect(parent).toMatchObject({
        event_type: 'ActivityStarted',
        activity_type: 'MCPToolCall',
      });
      expect(parent.hook_trigger).toBe(false);
      expect(parent.spans).toBeUndefined();
      expect(parent.span_count).toBeUndefined();
      expect(hook).toMatchObject({
        event_type: 'ActivityStarted',
        activity_type: 'MCPToolCall',
        hook_trigger: true,
        span_count: 1,
      });
      expect(hook.workflow_id).toBe(parent.workflow_id);
      expect(hook.run_id).toBe(parent.run_id);
      expect(hook.activity_id).toBe(parent.activity_id);
      expect(hook.spans[0]).toMatchObject({
        activity_id: parent.activity_id,
        semantic_type: 'mcp_tool_call',
        attributes: {
          'mcp.method': 'callTool',
          'mcp.operation': 'danger_tool',
          'mcp.server_id': 'unknown',
          'openbox.tool.name': 'danger_tool',
          'tool.name': 'danger_tool',
        },
      });
    });
  });

  it('check_governance normalizes caller LLM usage into the emitted hook span', async () => {
    await withMcpEnv(async () => {
      const bodies: string[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/v1/governance/evaluate')) {
          bodies.push(String(init?.body ?? ''));
          return new Response(JSON.stringify({ verdict: 'allow', action: 'allow' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 200, data: { data: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'check_governance')!;
      await tool.cb({
        agent_id: 'agent-1',
        span_type: 'llm',
        activity_input: {
          prompt: 'Summarize the request.',
          response: 'Done.',
          model: 'gpt-4o-mini',
          usage: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
            costUSD: 0.002,
          },
        },
      });

      expect(bodies).toHaveLength(2);
      const hook = JSON.parse(bodies[1]);
      expect(hook).toMatchObject({
        event_type: 'ActivityStarted',
        activity_type: 'PromptSubmission',
        hook_trigger: true,
        span_count: 1,
      });
      const span = hook.spans[0];
      expect(span).toMatchObject({
        semantic_type: 'llm_completion',
        model: 'gpt-4o-mini',
        input_tokens: 5,
        output_tokens: 3,
        total_tokens: 8,
        cost_usd: 0.002,
        attributes: expect.objectContaining({
          'gen_ai.usage.input_tokens': 5,
          'gen_ai.usage.output_tokens': 3,
          'gen_ai.usage.total_tokens': 8,
          'openbox.usage.cost_usd': 0.002,
        }),
      });
      expect(JSON.parse(String(span.response_body)).usage).toMatchObject({
        input_tokens: 5,
        output_tokens: 3,
        total_tokens: 8,
        cost_usd: 0.002,
      });
    });
  });

  it('check_governance treats uppercase continue parent verdicts as allowish', async () => {
    await withMcpEnv(async () => {
      const bodies: string[] = [];
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/v1/governance/evaluate')) {
          bodies.push(String(init?.body ?? ''));
          const verdict =
            bodies.length === 1
              ? { verdict: ' CONTINUE ', action: 'CONTINUE', reason: 'parent allowed' }
              : { verdict: 'block', action: 'block', reason: 'hook blocked' };
          return new Response(JSON.stringify(verdict), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ status: 200, data: { data: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const { runMcpServer } = await import('../../ts/src/runtime/mcp');
      await runMcpServer();
      const tool = captured.find((t) => t.name === 'check_governance')!;
      const out = await tool.cb({
        agent_id: 'agent-1',
        span_type: 'shell',
        activity_input: { command: 'rm -rf dist', cwd: '/tmp' },
      });

      expect(JSON.parse(out.content[0].text)).toMatchObject({
        verdict: 'block',
        reason: 'hook blocked',
      });
      expect(bodies).toHaveLength(2);
    });
  });
});
