import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXIT,
  ValidationError,
  parsePagination,
  reportAndExit,
  validateActivitiesConfig,
  validateApprovalTimeout,
  validateBehaviorStates,
  validateBehaviorTrigger,
  validateEnum,
  validateGuardrailParams,
  validateGuardrailType,
  validateIsoDate,
  validateRegoSource,
  validateStage,
  validateUuidList,
  validateVerdict,
} from '../../ts/src/validators/index.ts';

const originalExit = process.exit;

afterEach(() => {
  (process as any).exit = originalExit;
  vi.restoreAllMocks();
});

function captureExit(fn: () => never): number | undefined {
  let code: number | undefined;
  (process as any).exit = ((value?: number) => {
    code = value;
    throw new Error(`exit:${value}`);
  }) as never;
  expect(fn).toThrow(/exit:/);
  return code;
}

describe('validators branch coverage', () => {
  it('primitive validators cover valid and invalid collection/range branches', () => {
    expect(() => validateUuidList('not-list', 'ids')).toThrow(ValidationError);
    expect(() => validateUuidList(['00000000-0000-4000-8000-000000000000'], 'ids')).not.toThrow();
    expect(() => validateEnum(1, ['a', 'b'], 'kind')).toThrow(ValidationError);
    expect(validateIsoDate('2026-05-25', 'when')).toBe('2026-05-25');
    expect(() => validateIsoDate('', 'when')).toThrow(ValidationError);
    expect(parsePagination({})).toEqual({ page: 0, perPage: 10 });
    expect(parsePagination({ page: '2', limit: '50' })).toEqual({ page: 2, perPage: 50 });
  });

  it('guardrail validators cover alias, stage, ban-list, and regex branches', () => {
    expect(validateGuardrailType('pii')).toBe('1');
    expect(validateGuardrailType('NSFW_DETECTION')).toBe('2');
    expect(validateStage('0')).toBe('0');
    expect(validateStage('1')).toBe('1');
    expect(() => validateStage('both')).toThrow(ValidationError);

    expect(() => validateGuardrailParams('4', {})).toThrow(ValidationError);
    expect(() => validateGuardrailParams('4', { banned_words: ['secret'] })).not.toThrow();
    expect(() => validateGuardrailParams('4', { banned_words: ['secret', ''] })).toThrow(ValidationError);
    expect(() => validateGuardrailParams('5', {})).toThrow(ValidationError);
    expect(() => validateGuardrailParams('5', { regex: '[' })).toThrow(ValidationError);
    expect(() => validateGuardrailParams('5', { regex: '(drop|truncate)\\s+table' })).not.toThrow();
  });

  it('activity config accepts optional guardrail activity bindings', () => {
    expect(() => validateActivitiesConfig(undefined, '0')).not.toThrow();
    expect(() => validateActivitiesConfig([], '0')).not.toThrow();
    expect(() =>
      validateActivitiesConfig(
        [{ activity_type: 'PromptSubmission', fields_to_check: ['input.0.prompt'] }],
        '0',
      ),
    ).not.toThrow();
    expect(() =>
      validateActivitiesConfig(
        [{ activity_type: 'AgentResponse', fields_to_check: ['output.text'] }],
        '1',
      ),
    ).not.toThrow();
    expect(() => validateActivitiesConfig([{ fields_to_check: ['input.x'] }], '0')).not.toThrow();
    expect(() =>
      validateActivitiesConfig(
        [{ activity_type: 'PromptSubmission', fields_to_check: [] }],
        '0',
      ),
    ).not.toThrow();
    expect(() =>
      validateActivitiesConfig(
        [{ activity_type: 'PromptSubmission', fields_to_check: ['output.text'] }],
        '0',
      ),
    ).not.toThrow();
    expect(() =>
      validateActivitiesConfig(
        [{ activity_type: 'CustomActivity', fields_to_check: ['input.text'] }],
        '0',
      ),
    ).not.toThrow();
  });

  it('behavior rule validators cover string and array state parsing', () => {
    expect(validateBehaviorTrigger('http_post')).toBe('http_post');
    expect(validateBehaviorTrigger('llm_gen_ai')).toBe('llm_gen_ai');
    expect(validateBehaviorTrigger('mcp_tool_call')).toBe('mcp_tool_call');
    expect(validateBehaviorStates('http_get, http_post')).toEqual(['http_get', 'http_post']);
    expect(validateBehaviorStates(['file_read', 'file_write', 'mcp_tool_call'])).toEqual(['file_read', 'file_write', 'mcp_tool_call']);
    expect(() => validateBehaviorStates(42)).toThrow(ValidationError);
    expect(() => validateBehaviorStates('')).toThrow(ValidationError);
    expect(validateVerdict('4')).toBe(4);
    expect(() => validateVerdict('5')).toThrow(ValidationError);
    expect(() => validateApprovalTimeout(2, undefined)).toThrow(ValidationError);
    expect(() => validateApprovalTimeout(2, '0')).toThrow(ValidationError);
    expect(() => validateApprovalTimeout(2, '30')).not.toThrow();
    expect(() => validateApprovalTimeout(3, undefined)).not.toThrow();
  });

  it('rego validator covers accepted decisions, denied shapes, and package warnings', () => {
    const valid = (decision: string) => `package org.openbox_ai.test
default result := {"decision": "ALLOW", "reason": "default"}
result := {"decision": "${decision}", "reason": "x"} if { input.ok }`;
    for (const decision of ['allow', 'continue', 'block', 'stop', 'halt', 'require_approval', 'require-approval']) {
      expect(() => validateRegoSource(valid(decision))).not.toThrow();
    }
    expect(() => validateRegoSource('package x\ndeny[msg] { true }')).toThrow(ValidationError);
    expect(() => validateRegoSource(valid('DENY'))).toThrow(ValidationError);
    expect(() =>
      validateRegoSource('package custom.name\ndefault result := {"decision": "ALLOW", "reason": "ok"}'),
    ).not.toThrow();
  });

  it('reportAndExit maps validation, API detail, network, destructive, and generic errors', () => {
    expect(captureExit(() => reportAndExit(new ValidationError('x', 'bad')))).toBe(EXIT.USAGE);

    const destructive = new Error('destructive');
    destructive.name = 'DestructiveConfirmRequiredError';
    expect(captureExit(() => reportAndExit(destructive))).toBe(EXIT.USAGE);

    expect(
      captureExit(() =>
        reportAndExit({
          name: 'OpenBoxApiError',
          status: 401,
          message: 'request failed',
          body: { message: ['missing key', 'bad key'] },
        }),
      ),
    ).toBe(EXIT.AUTH);
    expect(
      captureExit(() =>
        reportAndExit({
          name: 'CoreApiError',
          status: 500,
          message: 'request failed',
          body: { data: { message: 'OPA unavailable' } },
        }),
      ),
    ).toBe(EXIT.SERVER);
    expect(captureExit(() => reportAndExit(Object.assign(new Error('no host'), { code: 'ENOTFOUND' })))).toBe(
      EXIT.NETWORK,
    );
    expect(captureExit(() => reportAndExit('plain failure'))).toBe(EXIT.GENERIC);
  });
});
