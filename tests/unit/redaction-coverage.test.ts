// Coverage for ts/src/core-client/redaction.ts. Three exports .
// deepUpdateObject, applyInputRedaction, applyOutputRedaction .
// drive every branch of the redaction merge logic.

import { describe, it, expect } from 'vitest';
import {
  deepUpdateObject,
  applyInputRedaction,
  applyOutputRedaction,
  hasGuardrailRedaction,
  summarizeGuardrailRedaction,
} from '../../ts/src/core-client/redaction';

describe('deepUpdateObject', () => {
  it('shallow + nested merges', () => {
    const t: any = { a: 1, b: { c: 2 } };
    deepUpdateObject(t, { a: 9, b: { c: 8, d: 7 } });
    expect(t).toEqual({ a: 9, b: { c: 8, d: 7 } });
  });

  it('null / undefined source values overwrite (not deep-merge)', () => {
    const t: any = { a: { x: 1 } };
    deepUpdateObject(t, { a: null as any });
    expect(t).toEqual({ a: null });
  });

  it('arrays merge by index to preserve safe siblings', () => {
    const t: any = { a: [1, 2, 3] };
    deepUpdateObject(t, { a: [9] });
    expect(t).toEqual({ a: [9, 2, 3] });
  });

  it('throws when target is not a plain object', () => {
    expect(() => deepUpdateObject([1, 2] as any, { a: 1 })).toThrow();
    expect(() => deepUpdateObject(null as any, { a: 1 })).toThrow();
    expect(() => deepUpdateObject('s' as any, { a: 1 })).toThrow();
  });
});

describe('applyInputRedaction', () => {
  it('no-ops when guardrails undefined', () => {
    expect(applyInputRedaction({ x: 1 }, undefined)).toEqual({ x: 1 });
  });

  it('no-ops when inputType !== activity_input', () => {
    expect(
      applyInputRedaction({ x: 1 }, { inputType: 'activity_output', redactedInput: { x: 2 } } as any),
    ).toEqual({ x: 1 });
  });

  it('coerces a single object redaction into a one-element array', () => {
    const orig = { prompt: 'PII here' };
    const out = applyInputRedaction(orig, {
      inputType: 'activity_input',
      redactedInput: { prompt: '[REDACTED]' },
    } as any);
    expect(out).toEqual({ prompt: '[REDACTED]' });
  });

  it('treats signal_args as input-like redaction', () => {
    const out = applyInputRedaction(['email avery@example.com'], {
      inputType: 'signal_args',
      redactedInput: ['email <EMAIL_ADDRESS>'],
    } as any);
    expect(out).toEqual(['email <EMAIL_ADDRESS>']);
  });

  it('falls through when redactedInput is neither obj nor array', () => {
    expect(
      applyInputRedaction({ x: 1 }, { inputType: 'activity_input', redactedInput: 'plain' } as any),
    ).toEqual({ x: 1 });
  });

  it('replaces a non-object original with the first redaction value', () => {
    const out = applyInputRedaction('original-string', {
      inputType: 'activity_input',
      redactedInput: ['redacted-string'],
    } as any);
    expect(out).toBe('redacted-string');
  });

  it('handles empty redaction array against non-object original', () => {
    const out = applyInputRedaction('original-string', {
      inputType: 'activity_input',
      redactedInput: [],
    } as any);
    expect(out).toEqual([]);
  });

  it('deep-merges into a non-array original object', () => {
    const orig = { a: 1, b: { c: 2 } };
    const out: any = applyInputRedaction(orig, {
      inputType: 'activity_input',
      redactedInput: [{ b: { c: 9 } }],
    } as any);
    expect(out.b.c).toBe(9);
    expect(out.a).toBe(1);
    expect(orig).toEqual({ a: 1, b: { c: 2 } });
    expect(out).not.toBe(orig);
  });

  it('replaces non-object original with the first redaction object', () => {
    const out = applyInputRedaction(null as any, {
      inputType: 'activity_input',
      redactedInput: [{ replaced: true }],
    } as any);
    expect(out).toEqual({ replaced: true });
  });

  it('walks an array original, deep-merging matching positions', () => {
    const orig = [{ a: 1 }, { a: 2 }];
    const out: any = applyInputRedaction(orig, {
      inputType: 'activity_input',
      redactedInput: [{ a: 9 }, { a: 8 }],
    } as any);
    expect(out).toEqual([{ a: 9 }, { a: 8 }]);
    expect(orig).toEqual([{ a: 1 }, { a: 2 }]);
    expect(out).not.toBe(orig);
    expect(out[0]).not.toBe(orig[0]);
  });

  it('unwraps Core input envelopes before merging tool input redactions', () => {
    const orig = [
      {
        name: 'openbox_governed_action',
        args: {
          action: 'demo',
          request: 'account acct_9281 and avery@example.com',
        },
      },
    ];
    const out: any = applyInputRedaction(orig, {
      inputType: 'activity_input',
      redactedInput: {
        input: [
          {
            args: {
              request: 'account <ACCOUNT_ID> and <EMAIL_ADDRESS>',
            },
          },
        ],
      },
    } as any);
    expect(out[0].args).toEqual({
      action: 'demo',
      request: 'account <ACCOUNT_ID> and <EMAIL_ADDRESS>',
    });
    expect(out).not.toBe(orig);
  });

  it('replaces array elements when types disagree', () => {
    const orig = ['plain'];
    const out: any = applyInputRedaction(orig, {
      inputType: 'activity_input',
      redactedInput: [{ becomes: 'object' }],
    } as any);
    expect(out[0]).toEqual({ becomes: 'object' });
  });
});

describe('applyOutputRedaction', () => {
  it('no-ops when guardrails undefined', () => {
    expect(applyOutputRedaction({ x: 1 }, undefined)).toEqual({ x: 1 });
  });

  it('no-ops when inputType !== activity_output', () => {
    expect(
      applyOutputRedaction({ x: 1 }, { inputType: 'activity_input', redactedInput: { x: 2 } } as any),
    ).toEqual({ x: 1 });
  });

  it('no-ops when redactedInput is null/undefined', () => {
    expect(
      applyOutputRedaction({ x: 1 }, { inputType: 'activity_output', redactedInput: null } as any),
    ).toEqual({ x: 1 });
    expect(
      applyOutputRedaction({ x: 1 }, { inputType: 'activity_output', redactedInput: undefined } as any),
    ).toEqual({ x: 1 });
  });

  it('deep-merges object original with object redaction', () => {
    const orig = { a: 1, b: { c: 2 } };
    const out: any = applyOutputRedaction(orig, {
      inputType: 'activity_output',
      redactedInput: { b: { c: 9 } },
    } as any);
    expect(out).toEqual({ a: 1, b: { c: 9 } });
    expect(orig).toEqual({ a: 1, b: { c: 2 } });
    expect(out).not.toBe(orig);
  });

  it('unwraps Core output envelopes before merging result redactions', () => {
    const orig = { artifact: { body: 'session_id raw', status: 'ready' } };
    const out: any = applyOutputRedaction(orig, {
      inputType: 'activity_output',
      redactedInput: {
        output: {
          artifact: {
            body: '<SESSION_ID> redacted',
          },
        },
      },
    } as any);
    expect(out).toEqual({
      artifact: {
        body: '<SESSION_ID> redacted',
        status: 'ready',
      },
    });
    expect(out).not.toBe(orig);
  });

  it('replaces non-object original with the redaction value', () => {
    expect(
      applyOutputRedaction('original', { inputType: 'activity_output', redactedInput: 'redacted' } as any),
    ).toBe('redacted');
  });
});

describe('guardrail redaction helpers', () => {
  it('detects typed redacted field results with a redaction payload', () => {
    expect(
      hasGuardrailRedaction({
        inputType: 'activity_output',
        redactedInput: { artifact: { body: '[REDACTED]' } },
        validationPassed: true,
        reasons: [],
        fieldResults: [{ field: 'output.artifact.body', status: 'redacted' }],
      }),
    ).toBe(true);
  });

  it('treats backend transformed field results as SDK redactions', () => {
    expect(
      hasGuardrailRedaction({
        inputType: 'activity_output',
        redactedInput: { artifact: { body: '[REDACTED]' } },
        validationPassed: true,
        reasons: [],
        fieldResults: [{ field: 'output.artifact.body', status: 'transformed' }],
      }),
    ).toBe(true);
  });

  it('treats a Core redaction payload as authoritative without field rows', () => {
    expect(
      hasGuardrailRedaction({
        inputType: 'activity_input',
        redactedInput: [{ prompt: '[REDACTED]' }],
        validationPassed: true,
        reasons: [],
        fieldResults: [],
      }),
    ).toBe(true);
  });

  it('detects signal_args redaction payloads', () => {
    expect(
      hasGuardrailRedaction({
        inputType: 'signal_args',
        redactedInput: ['<EMAIL_ADDRESS>'],
        validationPassed: true,
        reasons: [],
        fieldResults: [],
      }),
    ).toBe(true);
  });

  it('does not count redacted status without a payload as an applied redaction', () => {
    expect(
      hasGuardrailRedaction({
        inputType: 'activity_output',
        redactedInput: undefined,
        validationPassed: true,
        reasons: [],
        fieldResults: [{ field: 'output.artifact.body', status: 'redacted' }],
      }),
    ).toBe(false);
  });

  it('summarizes redacted fields with bounded output', () => {
    const summary = summarizeGuardrailRedaction({
      inputType: 'activity_output',
      redactedInput: {},
      validationPassed: true,
      reasons: [],
      fieldResults: [
        { field: 'output.a', status: 'redacted' },
        { field: 'output.b', status: 'transformed' },
        { field: 'output.c', status: 'redacted' },
        { field: 'output.d', status: 'redacted' },
        { field: 'output.e', status: 'redacted' },
      ],
    });

    expect(summary).toBe('OpenBox redacted output.a, output.b, output.c, output.d and 1 more field.');
  });

  it('dedupes repeated redacted fields in summaries', () => {
    const summary = summarizeGuardrailRedaction({
      inputType: 'activity_input',
      redactedInput: [{ args: { request: '<EMAIL_ADDRESS>' } }],
      validationPassed: true,
      reasons: [],
      fieldResults: [
        { field: 'input.0.args.request', status: 'redacted' },
        { field: 'input.0.args.request', status: 'transformed' },
      ],
    });

    expect(summary).toBe('OpenBox redacted input.0.args.request.');
  });

  it('returns the fallback when there are no redacted field names', () => {
    expect(
      summarizeGuardrailRedaction(
        {
          inputType: 'activity_output',
          redactedInput: {},
          validationPassed: true,
          reasons: [],
          fieldResults: [],
        },
        'Redacted.',
      ),
    ).toBe('Redacted.');
  });
});
