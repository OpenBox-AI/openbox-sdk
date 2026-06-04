import { describe, expect, it } from 'vitest';
import {
  buildOperationUrl,
  parseJsonOption,
  renderOperationPath,
  resolveOperation,
} from '../../ts/src/cli/commands/api.js';

describe('api command helpers', () => {
  it('resolves generated backend and core operations by operationId', () => {
    expect(resolveOperation('backend', 'AgentController_getAgent')).toMatchObject({
      verb: 'get',
      path: '/agent/{agentId}',
    });
    expect(resolveOperation('core', 'evaluateGovernance')).toMatchObject({
      verb: 'post',
      path: '/api/v1/governance/evaluate',
    });
    expect(() => resolveOperation('backend', 'nope')).toThrow(/unknown backend operationId/);
  });

  it('renders path params and rejects missing values', () => {
    expect(renderOperationPath('/agent/{agentId}/logs/{logId}', {
      agentId: 'agent one',
      logId: 'log/2',
    })).toBe('/agent/agent%20one/logs/log%2F2');
    expect(() => renderOperationPath('/agent/{agentId}', {})).toThrow(/missing path param/);
  });

  it('builds URLs with path params and repeated array query values', () => {
    const operation = resolveOperation('backend', 'AgentController_getAgent');
    const url = buildOperationUrl('https://api.example/ob', operation, {
      agentId: 'agent-1',
    }, {
      include: ['rules', 'policies'],
      limit: 2,
    });
    expect(url).toBe('https://api.example/ob/agent/agent-1?include=rules&include=policies&limit=2');
  });

  it('parses JSON options and reports invalid JSON clearly', () => {
    expect(parseJsonOption('{"ok":true}', '--body')).toEqual({ ok: true });
    expect(parseJsonOption(undefined, '--body')).toBeUndefined();
    expect(() => parseJsonOption('{', '--body')).toThrow(/--body must be valid JSON/);
  });
});
