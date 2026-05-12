// Unit test for the rules-projection logic. We mock the SDK's
// `createApi` factory at import-time so the projection runs without
// any real backend.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the api spy across tests so each can install its own
// per-endpoint stub.
const apiCalls: string[] = [];
const apiResponses = new Map<RegExp, unknown>();

vi.mock('../../ts/src/runtime/mcp/config.js', () => ({
  createApi: () => async (urlPath: string) => {
    apiCalls.push(urlPath);
    for (const [re, resp] of apiResponses) {
      if (re.test(urlPath)) return resp;
    }
    throw new Error(`Unmocked endpoint: ${urlPath}`);
  },
}));

beforeEach(() => {
  apiCalls.length = 0;
  apiResponses.clear();
});

describe('fetchRulesProjection', () => {
  async function loadModule() {
    return await import('../../ts/src/governance/rules-projection.js');
  }

  it('skips inactive guardrails and inactive policies', async () => {
    apiResponses.set(/\/guardrails/, [
      { id: 'g1', name: 'on', guardrail_type: 'pii', processing_stage: 'input', is_active: true },
      { id: 'g2', name: 'off', guardrail_type: 'pii', processing_stage: 'input', is_active: false },
    ]);
    apiResponses.set(/\/policies/, [
      { id: 'p1', name: 'on', rego_code: '', is_active: true },
      { id: 'p2', name: 'off', rego_code: '', is_active: false },
    ]);
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    expect(projection.rules.map((r) => r.id)).toEqual(['guardrail/g1', 'policy/p1']);
  });

  it('maps trust_impact onto severity', async () => {
    apiResponses.set(/\/guardrails/, [
      { id: 'crit', name: 'c', guardrail_type: 'pii', processing_stage: 'input', is_active: true, trust_impact: 'critical' },
      { id: 'med', name: 'm', guardrail_type: 'pii', processing_stage: 'input', is_active: true, trust_impact: 'medium' },
      { id: 'low', name: 'l', guardrail_type: 'pii', processing_stage: 'input', is_active: true, trust_impact: 'low' },
    ]);
    apiResponses.set(/\/policies/, []);
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    const sevById = Object.fromEntries(projection.rules.map((r) => [r.id, r.severity]));
    expect(sevById['guardrail/crit']).toBe('block');
    expect(sevById['guardrail/med']).toBe('warn');
    expect(sevById['guardrail/low']).toBe('info');
  });

  it('extracts globs from params.path_globs and switches trigger to globMatch', async () => {
    apiResponses.set(/\/guardrails/, [
      {
        id: 'g',
        name: 'glob',
        guardrail_type: 'pii',
        processing_stage: 'input',
        is_active: true,
        params: { path_globs: ['src/**/*.ts'] },
      },
    ]);
    apiResponses.set(/\/policies/, []);
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    expect(projection.rules[0].trigger).toBe('globMatch');
    expect(projection.rules[0].globs).toEqual(['src/**/*.ts']);
  });

  it('falls back to always trigger when no globs', async () => {
    apiResponses.set(/\/guardrails/, [
      { id: 'g', name: 'no-glob', guardrail_type: 'pii', processing_stage: 'input', is_active: true },
    ]);
    apiResponses.set(/\/policies/, []);
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    expect(projection.rules[0].trigger).toBe('always');
    expect(projection.rules[0].globs).toBeUndefined();
  });

  it('policies project as agentRequested by default', async () => {
    apiResponses.set(/\/guardrails/, []);
    apiResponses.set(/\/policies/, [
      { id: 'p1', name: 'P1', rego_code: 'package x', is_active: true },
    ]);
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    expect(projection.rules[0].trigger).toBe('agentRequested');
  });

  it('sorts rules by id for deterministic output', async () => {
    apiResponses.set(/\/guardrails/, [
      { id: 'zzz', name: 'z', guardrail_type: 'pii', processing_stage: 'input', is_active: true },
      { id: 'aaa', name: 'a', guardrail_type: 'pii', processing_stage: 'input', is_active: true },
    ]);
    apiResponses.set(/\/policies/, [
      { id: 'mmm', name: 'm', rego_code: '', is_active: true },
    ]);
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    expect(projection.rules.map((r) => r.id)).toEqual([
      'guardrail/aaa',
      'guardrail/zzz',
      'policy/mmm',
    ]);
  });

  it('handles paginated { data: [...] } envelope shape', async () => {
    apiResponses.set(/\/guardrails/, {
      data: [{ id: 'g', name: 'g', guardrail_type: 'pii', processing_stage: 'input', is_active: true }],
    });
    apiResponses.set(/\/policies/, { data: [] });
    const { fetchRulesProjection } = await loadModule();
    const projection = await fetchRulesProjection({ agentId: 'agt' });
    expect(projection.rules.length).toBe(1);
  });
});
