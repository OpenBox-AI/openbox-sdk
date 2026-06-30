import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXIT,
  ValidationError,
  block,
  parsePagination,
  reportAndExit,
  validateActivitiesConfig,
  validateApprovalTimeout,
  validateBehaviorStates,
  validateBehaviorTrigger,
  validateEnum,
  validateGuardrailParams,
  validateGuardrailType,
  validateInt,
  validateIsoDate,
  validateRegoSource,
  validateStage,
  validateUuid,
  validateUuidList,
  validateVerdict,
  BEHAVIOR_TRIGGER_ENUM,
  GUARDRAIL_TYPE_ALIASES,
} from '../../ts/src/validators/index.ts';

const originalExit = process.exit;

afterEach(() => {
  (process as any).exit = originalExit;
  vi.restoreAllMocks();
});

/** Run `fn`, capturing the exit code that `reportAndExit`/process.exit produces. */
function captureExit(fn: () => void): number | undefined {
  // Silence the stderr output emitted by printError.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let code: number | undefined;
  (process as any).exit = ((value?: number) => {
    code = value;
    throw new Error(`exit:${value}`);
  }) as never;
  expect(fn).toThrow(/exit:/);
  return code;
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('reportAndExit error routing', () => {
  it('routes DestructiveConfirmRequiredError to USAGE', () => {
    const err = new Error('confirm required');
    err.name = 'DestructiveConfirmRequiredError';
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.USAGE);
  });

  it('routes ValidationError (with fix + reference) to USAGE', () => {
    const err = new ValidationError('rule', 'bad', 'do this', 'see here');
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.USAGE);
  });

  it('routes ValidationError (no fix/reference) to USAGE', () => {
    expect(captureExit(() => reportAndExit(new ValidationError('rule', 'bad')))).toBe(
      EXIT.USAGE,
    );
  });

  // --- API error body -> extractApiErrorDetail branches -------------------

  it('handles API error with null body (extract returns null, status hint)', () => {
    const err = { name: 'OpenBoxApiError', message: 'boom', status: 401, body: null };
    // status 401 → AUTH exit, regardless of the (absent) detail body.
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.AUTH);
  });

  it('handles API error with non-object body', () => {
    const err = { name: 'CoreApiError', message: 'boom', status: 401, body: 'a string body' };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.AUTH);
  });

  it('handles API error with string message detail', () => {
    const err = {
      name: 'OpenBoxApiError',
      message: 'boom',
      status: 400,
      body: { message: 'plain detail' },
    };
    // 400 is not a specially mapped status → GENERIC.
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });

  it('handles API error with array message detail', () => {
    const err = {
      name: 'OpenBoxApiError',
      message: 'boom',
      status: 400,
      body: { message: ['field a invalid', 'field b invalid'] },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });

  it('handles API error with nested data.message string', () => {
    const err = {
      name: 'OpenBoxApiError',
      message: 'boom',
      status: 400,
      body: { data: { message: 'nested detail' } },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });

  it('handles API error with nested data.message array', () => {
    const err = {
      name: 'OpenBoxApiError',
      message: 'boom',
      status: 400,
      body: { data: { message: ['nested a', 'nested b'] } },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });

  it('handles API error with object body but no message/data (detail null)', () => {
    const err = {
      name: 'OpenBoxApiError',
      message: 'boom',
      status: 418,
      body: { somethingElse: true },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });

  it('handles API error with data present but data.message absent', () => {
    const err = {
      name: 'OpenBoxApiError',
      message: 'boom',
      status: 418,
      body: { data: { other: 1 } },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });

  // --- hintForDetail branches ---------------------------------------------

  it('hints for context-deadline-exceeded detail', () => {
    const err = {
      name: 'CoreApiError',
      message: 'boom',
      status: 500,
      body: { message: 'failed to start workflow: context deadline exceeded' },
    };
    // 5xx → SERVER exit; the detail drives the hint copy (not the exit code).
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.SERVER);
  });

  it('hints for RST_STREAM detail', () => {
    const err = {
      name: 'CoreApiError',
      message: 'boom',
      status: 500,
      body: { message: 'stream terminated by RST_STREAM' },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.SERVER);
  });

  it('hints for OPA-unavailable detail', () => {
    const err = {
      name: 'CoreApiError',
      message: 'boom',
      status: 500,
      body: { message: 'OPA unavailable' },
    };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.SERVER);
  });

  it('detail present but unmatched falls through to status hint (returns null)', () => {
    const err = {
      name: 'CoreApiError',
      message: 'boom',
      status: 404,
      body: { message: 'some unmatched detail' },
    };
    // 404 → NOT_FOUND exit.
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.NOT_FOUND);
  });

  // --- hintForStatus branches ---------------------------------------------

  it.each([
    [401],
    [403],
    [404],
    [422],
    [500],
    [400], // default branch -> null hint
  ])('produces a status hint for %i', (status) => {
    const err = { name: 'OpenBoxApiError', message: 'boom', status, body: {} };
    captureExit(() => reportAndExit(err));
  });

  // --- network + generic fall-through -------------------------------------

  it.each([
    ['ECONNREFUSED'],
    ['ENOTFOUND'],
    ['ETIMEDOUT'],
    ['ECONNRESET'],
    ['UND_ERR_SOCKET'],
    ['UND_ERR_CONNECT_TIMEOUT'],
  ])('routes %s network errors to NETWORK', (code) => {
    const err = Object.assign(new Error('net down'), { code });
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.NETWORK);
  });

  it('routes a non-Error network code value to NETWORK', () => {
    expect(captureExit(() => reportAndExit({ code: 'ECONNREFUSED' }))).toBe(EXIT.NETWORK);
  });

  it('routes a generic Error to GENERIC', () => {
    expect(captureExit(() => reportAndExit(new Error('mystery')))).toBe(EXIT.GENERIC);
  });

  it('routes a non-Error generic value to GENERIC', () => {
    expect(captureExit(() => reportAndExit('plain string'))).toBe(EXIT.GENERIC);
  });

  it('API error with no message/detail/hint uses defaults (?? branches)', () => {
    const err = { name: 'OpenBoxApiError', status: 400, body: {} };
    captureExit(() => reportAndExit(err));
  });

  it('API-shaped error with non-numeric status falls through to generic', () => {
    const err = { name: 'OpenBoxApiError', message: 'boom', status: 'oops' };
    expect(captureExit(() => reportAndExit(err))).toBe(EXIT.GENERIC);
  });
});

describe('ValidationError + block', () => {
  it('block throws a ValidationError carrying all fields', () => {
    try {
      block('r', 'm', 'f', 'ref');
      throw new Error('should not reach');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const ve = e as ValidationError;
      expect(ve.rule).toBe('r');
      expect(ve.fix).toBe('f');
      expect(ve.reference).toBe('ref');
      expect(ve.name).toBe('ValidationError');
    }
  });
});

describe('primitive validators', () => {
  it('validateUuid accepts and rejects', () => {
    expect(validateUuid(VALID_UUID, 'id')).toBe(VALID_UUID);
    expect(() => validateUuid('nope', 'id')).toThrow(ValidationError);
    expect(() => validateUuid(123, 'id')).toThrow(ValidationError);
  });

  it('validateUuidList accepts, rejects non-array and bad entry', () => {
    expect(validateUuidList([VALID_UUID], 'ids')).toEqual([VALID_UUID]);
    expect(() => validateUuidList('not-array', 'ids')).toThrow(ValidationError);
    expect(() => validateUuidList([VALID_UUID, 'bad'], 'ids')).toThrow(ValidationError);
  });

  it('validateInt handles string, number, NaN, min, max', () => {
    expect(validateInt('5', 'n')).toBe(5);
    expect(validateInt(7, 'n')).toBe(7);
    expect(() => validateInt('abc', 'n')).toThrow(ValidationError);
    expect(() => validateInt(1.5, 'n')).toThrow(ValidationError);
    expect(() => validateInt(true, 'n')).toThrow(ValidationError);
    expect(() => validateInt(2, 'n', { min: 3 })).toThrow(ValidationError);
    expect(() => validateInt(9, 'n', { max: 5 })).toThrow(ValidationError);
    expect(validateInt(4, 'n', { min: 1, max: 5 })).toBe(4);
  });

  it('validateEnum accepts and rejects (non-string + not-in-list)', () => {
    expect(validateEnum('a', ['a', 'b'] as const, 'x')).toBe('a');
    expect(() => validateEnum('z', ['a', 'b'] as const, 'x')).toThrow(ValidationError);
    expect(() => validateEnum(1, ['a', 'b'] as const, 'x')).toThrow(ValidationError);
  });

  it('validateIsoDate accepts and rejects', () => {
    expect(validateIsoDate('2026-04-24', 'd')).toBe('2026-04-24');
    expect(() => validateIsoDate('', 'd')).toThrow(ValidationError);
    expect(() => validateIsoDate(123, 'd')).toThrow(ValidationError);
    expect(() => validateIsoDate('not-a-date', 'd')).toThrow(ValidationError);
  });

  it('parsePagination defaults and explicit values', () => {
    expect(parsePagination({})).toEqual({ page: 0, perPage: 10 });
    expect(parsePagination({ page: '2', limit: '50' })).toEqual({ page: 2, perPage: 50 });
  });
});

describe('guardrail validators', () => {
  it('validateGuardrailType rejects non-string', () => {
    expect(() => validateGuardrailType(5)).toThrow(ValidationError);
    expect(() => validateGuardrailType(null)).toThrow(ValidationError);
  });

  it('validateGuardrailType resolves aliases and rejects unknown', () => {
    const firstAlias = Object.keys(GUARDRAIL_TYPE_ALIASES)[0];
    expect(validateGuardrailType(firstAlias.toUpperCase())).toBe(
      GUARDRAIL_TYPE_ALIASES[firstAlias],
    );
    expect(() => validateGuardrailType('definitely-not-a-type')).toThrow(ValidationError);
  });

  it('validateStage accepts 0/1, rejects others', () => {
    expect(validateStage('0')).toBe('0');
    expect(validateStage('1')).toBe('1');
    expect(() => validateStage('both')).toThrow(ValidationError);
  });

  it('validateGuardrailParams type 4 (ban list)', () => {
    expect(() => validateGuardrailParams('4', { banned_words: ['x'] })).not.toThrow();
    expect(() => validateGuardrailParams('4', {})).toThrow(ValidationError);
    expect(() => validateGuardrailParams('4', { banned_words: [] })).toThrow(ValidationError);
    expect(() => validateGuardrailParams('4', undefined)).toThrow(ValidationError);
    expect(() => validateGuardrailParams('4', { banned_words: ['ok', ''] })).toThrow(
      ValidationError,
    );
  });

  it('validateGuardrailParams type 5 (regex)', () => {
    expect(() => validateGuardrailParams('5', { regex: 'ab+' })).not.toThrow();
    expect(() => validateGuardrailParams('5', { regex: '' })).toThrow(ValidationError);
    expect(() => validateGuardrailParams('5', {})).toThrow(ValidationError);
    expect(() => validateGuardrailParams('5', { regex: '(' })).toThrow(ValidationError);
  });

  it('validateGuardrailParams type with no extra requirements is a no-op', () => {
    expect(() => validateGuardrailParams('1', {})).not.toThrow();
  });

  it('validateActivitiesConfig is a no-op', () => {
    expect(() => validateActivitiesConfig({ anything: true }, '0')).not.toThrow();
  });
});

describe('behavior + verdict validators', () => {
  it('validateBehaviorTrigger accepts a canonical trigger and rejects junk', () => {
    expect(validateBehaviorTrigger(BEHAVIOR_TRIGGER_ENUM[0])).toBe(BEHAVIOR_TRIGGER_ENUM[0]);
    expect(() => validateBehaviorTrigger('not-a-trigger')).toThrow(ValidationError);
  });

  it('validateBehaviorStates handles array, csv, invalid type, empty, bad entry', () => {
    const t = BEHAVIOR_TRIGGER_ENUM[0];
    expect(validateBehaviorStates([t])).toEqual([t]);
    expect(validateBehaviorStates(` ${t} , ${t} `)).toEqual([t, t]);
    expect(() => validateBehaviorStates(42)).toThrow(ValidationError);
    expect(() => validateBehaviorStates([])).toThrow(ValidationError);
    expect(() => validateBehaviorStates('')).toThrow(ValidationError);
    expect(() => validateBehaviorStates([t, 'bogus'])).toThrow(ValidationError);
  });

  it('validateVerdict range', () => {
    expect(validateVerdict('3')).toBe(3);
    expect(() => validateVerdict(5)).toThrow(ValidationError);
  });

  it('validateApprovalTimeout requires timeout only for verdict 2', () => {
    expect(() => validateApprovalTimeout(0, undefined)).not.toThrow();
    expect(() => validateApprovalTimeout(2, undefined)).toThrow(ValidationError);
    expect(() => validateApprovalTimeout(2, '')).toThrow(ValidationError);
    expect(() => validateApprovalTimeout(2, '300')).not.toThrow();
    expect(() => validateApprovalTimeout(2, '0')).toThrow(ValidationError); // min 1
  });
});

describe('validateRegoSource', () => {
  const good = [
    'package org.openbox_ai.my_policy',
    'result := {"decision": "BLOCK", "reason": "x"} if { input.x }',
  ].join('\n');

  it('accepts a well-formed policy', () => {
    expect(() => validateRegoSource(good)).not.toThrow();
  });

  it('rejects empty / non-string', () => {
    expect(() => validateRegoSource('')).toThrow(ValidationError);
    expect(() => validateRegoSource('   ')).toThrow(ValidationError);
    expect(() => validateRegoSource(123 as unknown as string)).toThrow(ValidationError);
  });

  it('rejects missing package', () => {
    expect(() => validateRegoSource('result := {"decision":"BLOCK"}')).toThrow(ValidationError);
  });

  it('rejects missing result, with and without deny[] hint', () => {
    expect(() => validateRegoSource('package org.openbox_ai.p\nallow = true')).toThrow(
      ValidationError,
    );
    expect(() =>
      validateRegoSource('package org.openbox_ai.p\ndeny[msg] { input.x }'),
    ).toThrow(ValidationError);
  });

  it('rejects an unrecognized decision value', () => {
    const bad = [
      'package org.openbox_ai.p',
      'result := {"decision": "DENY", "reason": "x"} if { true }',
    ].join('\n');
    expect(() => validateRegoSource(bad)).toThrow(ValidationError);
  });

  it('accepts case-insensitive aliased decisions', () => {
    const ok = [
      'package org.openbox_ai.p',
      'result := {"decision": "require-approval", "reason": "x"} if { true }',
    ].join('\n');
    expect(() => validateRegoSource(ok)).not.toThrow();
  });

  it('warns (does not throw) on a decorative package name', () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const src = [
      'package my.custom.pkg',
      'result := {"decision": "BLOCK", "reason": "x"} if { true }',
    ].join('\n');
    expect(() => validateRegoSource(src)).not.toThrow();
    warnSpy.mockRestore();
  });

  it('does not warn on a conventional org.<id>.policy_<id> package name', () => {
    const src = [
      'package org.abc123.policy_xyz',
      'result := {"decision": "BLOCK", "reason": "x"} if { true }',
    ].join('\n');
    expect(() => validateRegoSource(src)).not.toThrow();
  });
});
