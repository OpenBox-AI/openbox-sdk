import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { parseJsonInput } from '../../ts/cli/src/input.js';

describe('parseJsonInput', () => {
  const tmpFile = join(process.cwd(), 'test-input-tmp.json');
  const testData = { agent_name: 'test', team_ids: ['t1'] };

  afterAll(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      // file may not exist
    }
  });

  it('parses raw JSON string', () => {
    const result = parseJsonInput('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses complex JSON', () => {
    const json = JSON.stringify(testData);
    const result = parseJsonInput(json);
    expect(result).toEqual(testData);
  });

  it('reads JSON from file with @ prefix', () => {
    writeFileSync(tmpFile, JSON.stringify(testData));
    const result = parseJsonInput(`@${tmpFile}`);
    expect(result).toEqual(testData);
  });

  it('throws on invalid JSON string', () => {
    expect(() => parseJsonInput('not json')).toThrow();
  });

  it('throws on non-existent file', () => {
    expect(() => parseJsonInput('@/nonexistent/file.json')).toThrow();
  });
});
