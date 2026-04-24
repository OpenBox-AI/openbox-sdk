// Pure unit tests for the validator helpers - no CLI plumbing, no network.
// These catch the cases I hit during real-backend smoke tests and a few more
// that would be expensive to test end-to-end (range bounds, edge-date
// formats, NaN from Commander-less invocation).

import { describe, it, expect } from 'vitest';
import {
  validateInt,
  validateEnum,
  validateIsoDate,
  parsePagination,
} from '../../src/validators/index.js';

describe('validateInt', () => {
  it('parses a numeric string', () => {
    expect(validateInt('42', '--x')).toBe(42);
  });
  it('accepts an actual number', () => {
    expect(validateInt(7, '--x')).toBe(7);
  });
  it('rejects NaN strings with exit-2', () => {
    expect(() => validateInt('abc', '--x')).toThrow();
  });
  it('rejects undefined with exit-2', () => {
    expect(() => validateInt(undefined, '--x')).toThrow();
  });
  it('enforces min', () => {
    expect(() => validateInt('0', '--x', { min: 1 })).toThrow();
    expect(validateInt('1', '--x', { min: 1 })).toBe(1);
  });
  it('enforces max', () => {
    expect(() => validateInt('100', '--x', { max: 99 })).toThrow();
    expect(validateInt('99', '--x', { max: 99 })).toBe(99);
  });
});

describe('validateEnum', () => {
  const KINDS = ['a', 'b', 'c'] as const;
  it('accepts a valid value', () => {
    expect(validateEnum('a', KINDS, '--k')).toBe('a');
  });
  it('rejects a missing value', () => {
    expect(() => validateEnum(undefined, KINDS, '--k')).toThrow();
  });
  it('rejects an invalid value', () => {
    expect(() => validateEnum('z', KINDS, '--k')).toThrow();
  });
  it('error message lists the allowed values', () => {
    try {
      validateEnum('z', KINDS, '--k');
      expect.fail('should have thrown');
    } catch (e) {
      expect(String((e as Error).message)).toContain('a, b, c');
    }
  });
});

describe('validateIsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(validateIsoDate('2026-04-24', '--from')).toBe('2026-04-24');
  });
  it('accepts full ISO 8601 with Z', () => {
    const v = '2026-04-24T15:30:00Z';
    expect(validateIsoDate(v, '--from')).toBe(v);
  });
  it('accepts offset format', () => {
    const v = '2026-04-24T15:30:00-07:00';
    expect(validateIsoDate(v, '--from')).toBe(v);
  });
  it('rejects unparseable garbage', () => {
    expect(() => validateIsoDate('last week', '--from')).toThrow();
  });
  it('rejects non-strings', () => {
    expect(() => validateIsoDate(42, '--from')).toThrow();
    expect(() => validateIsoDate(undefined, '--from')).toThrow();
    expect(() => validateIsoDate('', '--from')).toThrow();
  });
});

describe('parsePagination', () => {
  it('uses defaults when both fields are absent', () => {
    expect(parsePagination({})).toEqual({ page: 0, perPage: 10 });
  });
  it('coerces string numerics from Commander', () => {
    expect(parsePagination({ page: '3', limit: '50' })).toEqual({
      page: 3,
      perPage: 50,
    });
  });
  it('rejects NaN page', () => {
    expect(() => parsePagination({ page: 'abc' })).toThrow();
  });
  it('rejects perPage < 1', () => {
    expect(() => parsePagination({ limit: '0' })).toThrow();
  });
  it('allows large perPage (no client-side max)', () => {
    expect(parsePagination({ limit: '5000' })).toEqual({
      page: 0,
      perPage: 5000,
    });
  });
  it('rejects negative page', () => {
    expect(() => parsePagination({ page: '-1' })).toThrow();
  });
});
