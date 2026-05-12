// Hook-log rotation unit test.
//
// `makeHookLog` (ts/src/logging/hook-log.ts) appends one JSONL
// line per hook event. To prevent a runaway hook from filling
// the disk, the writer rotates the log when it grows past
// MAX_BYTES (currently 5 MiB), renaming the active file to
// `<host>-hook.jsonl.1` and starting fresh.
//
// This test isolates the writer with `OPENBOX_HOME`, hammers it
// past the cap with synthetic lines, and asserts the rotation
// landed and the new file is below the cap.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeHookLog, MAX_BYTES } from '../../ts/src/logging/hook-log.js';

describe('hook-log rotation', () => {
  let prevHome: string | undefined;
  let home: string;

  beforeEach(() => {
    prevHome = process.env.OPENBOX_HOME;
    home = mkdtempSync(path.join(tmpdir(), 'obx-log-rotation-'));
    process.env.OPENBOX_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) {
      delete process.env.OPENBOX_HOME;
    } else {
      process.env.OPENBOX_HOME = prevHome;
    }
  });

  it('rotates the active file to .jsonl.1 when it crosses MAX_BYTES', () => {
    const log = makeHookLog('claude-code');
    const active = log.path;

    // Plant a near-cap file so a single record tips it over the
    // edge. Cheaper than appending millions of records.
    const dir = path.dirname(active);
    mkdirSync(dir, { recursive: true });
    writeFileSync(active, 'x'.repeat(MAX_BYTES + 1024), { mode: 0o600 });
    expect(statSync(active).size).toBeGreaterThan(MAX_BYTES);

    // One record triggers rotation: the rename happens before the
    // append.
    log.record({
      ts: new Date().toISOString(),
      event: 'preToolUse',
      verdict_kind: 'permission',
      took_ms: 12,
    });

    // After rotation, the active file holds only the new record
    // (well under the cap) and `<file>.1` holds the prior bulk.
    expect(existsSync(active)).toBe(true);
    expect(existsSync(active + '.1')).toBe(true);
    expect(statSync(active).size).toBeLessThan(MAX_BYTES);
    expect(statSync(active + '.1').size).toBeGreaterThan(MAX_BYTES);
    const fresh = readFileSync(active, 'utf-8');
    expect(fresh.trim().split('\n').length).toBe(1);
    expect(fresh).toContain('preToolUse');
  });

  it('keeps appending without rotation while the file stays under the cap', () => {
    const log = makeHookLog('claude-code');
    for (let i = 0; i < 50; i++) {
      log.record({
        ts: new Date().toISOString(),
        event: 'preToolUse',
        verdict_kind: 'permission',
        took_ms: i,
      });
    }
    expect(existsSync(log.path + '.1')).toBe(false);
    const text = readFileSync(log.path, 'utf-8');
    expect(text.trim().split('\n').length).toBe(50);
  });

  it('honors per-host filename isolation (claude-code vs cursor)', () => {
    const cc = makeHookLog('claude-code');
    const cu = makeHookLog('cursor');
    expect(cc.path).not.toBe(cu.path);
    cc.record({ ts: '', event: 'preToolUse' });
    cu.record({ ts: '', event: 'beforeReadFile' });
    expect(readFileSync(cc.path, 'utf-8')).toContain('preToolUse');
    expect(readFileSync(cu.path, 'utf-8')).toContain('beforeReadFile');
    expect(readFileSync(cc.path, 'utf-8')).not.toContain('beforeReadFile');
  });
});
