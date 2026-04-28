import { readFileSync } from 'fs';

/**
 * Parse a JSON input value that can be:
 * - A raw JSON string: '{"key": "value"}'
 * - A file path prefixed with @: @payload.json
 * - A dash for stdin: -
 */
export function parseJsonInput<T = unknown>(value: string): T {
  if (value === '-') {
    const chunks: Buffer[] = [];
    const fd = require('fs').openSync('/dev/stdin', 'r');
    const buf = Buffer.alloc(4096);
    let n: number;
    while ((n = require('fs').readSync(fd, buf)) > 0) {
      chunks.push(buf.subarray(0, n));
    }
    require('fs').closeSync(fd);
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  }

  if (value.startsWith('@')) {
    const filePath = value.slice(1);
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  return JSON.parse(value);
}
