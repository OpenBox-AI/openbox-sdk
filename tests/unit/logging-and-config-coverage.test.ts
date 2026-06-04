import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadDotenv, loadJsonConfig } from '../../ts/src/config/host-config.ts';
import { MAX_BYTES, makeHookLog, tailHookLog } from '../../ts/src/logging/hook-log.ts';

const temps: string[] = [];
const oldOpenboxHome = process.env.OPENBOX_HOME;

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openbox-log-config-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  if (oldOpenboxHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = oldOpenboxHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('hook log writer/tailer', () => {
  it('writes JSONL under OPENBOX_HOME and rotates large files', () => {
    const root = tempRoot();
    process.env.OPENBOX_HOME = root;
    const log = makeHookLog('cursor');

    log.record({ ts: '2026-05-25T00:00:00Z', event: 'preToolUse', verdict_kind: 'permission' });
    expect(readFileSync(log.path, 'utf-8')).toContain('"event":"preToolUse"');

    truncateSync(log.path, 0);
    appendFileSync(log.path, Buffer.alloc(MAX_BYTES));
    log.record({ ts: '2026-05-25T00:00:01Z', event: 'postToolUse' });
    expect(existsSync(`${log.path}.1`)).toBe(true);
    expect(readFileSync(log.path, 'utf-8')).toContain('"event":"postToolUse"');
  });

  it('tails only new lines and reports rotation', async () => {
    vi.useFakeTimers();
    const root = tempRoot();
    const file = join(root, 'tail.jsonl');
    mkdirSync(root, { recursive: true });
    writeFileSync(file, '{"event":"old","ts":"t"}\n');
    const seen: string[] = [];
    let rotated = 0;

    const tail = tailHookLog(
      file,
      (line, raw) => seen.push(line.event || raw),
      { intervalMs: 10, onRotated: () => rotated++ },
    );

    appendFileSync(file, '{"event":"new","ts":"t"}\nnot-json\n');
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual(['new', 'not-json']);

    writeFileSync(file, '{"event":"after-rotate","ts":"t"}\n');
    await vi.advanceTimersByTimeAsync(10);
    expect(rotated).toBe(1);
    expect(seen.at(-1)).toBe('after-rotate');
    tail.stop();
  });
});

describe('host config readers', () => {
  it('loads JSON keys in original and env-var forms and tolerates bad files', () => {
    const root = tempRoot();
    const file = join(root, 'config.json');
    writeFileSync(file, JSON.stringify({ openboxApiKey: 'k', dryRun: false }));
    expect(loadJsonConfig(file)).toMatchObject({
      OPENBOXAPIKEY: 'k',
      openboxApiKey: 'k',
      DRYRUN: 'false',
      dryRun: 'false',
    });
    writeFileSync(file, '{bad');
    expect(loadJsonConfig(file)).toEqual({});
    expect(loadJsonConfig(join(root, 'missing.json'))).toEqual({});
  });

  it('loads dotenv keys, strips paired quotes, and ignores malformed lines', () => {
    const root = tempRoot();
    const file = join(root, '.env');
    writeFileSync(file, [
      '# comment',
      'OPENBOX_API_KEY = "obx_test_x"',
      "OPENBOX_CORE_URL='http://localhost:8086'",
      'BAD_LINE',
      '',
    ].join('\n'));
    expect(loadDotenv(file)).toEqual({
      OPENBOX_API_KEY: 'obx_test_x',
      OPENBOX_CORE_URL: 'http://localhost:8086',
    });
    expect(loadDotenv(join(root, 'missing.env'))).toEqual({});
  });
});
