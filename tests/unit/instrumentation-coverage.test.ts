import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  instrumentSqlite,
  traced,
  tracedReadFile,
  tracedReadFileSync,
  tracedWriteFile,
  tracedWriteFileSync,
} from '../../ts/src/copilotkit/instrumentation.js';
import {
  capturedSubOpSpans,
  isCapturing,
  runWithSubOpCapture,
} from '../../ts/src/copilotkit/otel-capture.js';

// Drives ts/src/copilotkit/instrumentation.ts (the explicit-entry-point file/db/
// function instrumentation) to 100% statement + branch coverage against real
// temp files and a real node:sqlite DatabaseSync, with crafted fakes for the
// driver-shape branches that real drivers can't exercise (missing methods,
// bigint rowcounts, name/location resolution, error paths).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-instr-'));
const created: string[] = [];

function tmp(name: string): string {
  const p = path.join(tmpDir, name);
  created.push(p);
  return p;
}

// This file patches no globals: it uses real temp files (cleaned below) and
// fresh per-instance sqlite objects (the INSTRUMENTED flag lives on each
// instance, never on a shared module/global). The teardown below is defensive —
// it restores any spies and clears mock state so the file is deterministic
// whether run alone or interleaved with the rest of the suite.
afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function capture<T>(fn: () => Promise<T> | T): Promise<T> {
  return runWithSubOpCapture({ activityId: 'act-instr' }, async () => fn());
}

// ───────────────────────────────────────────────────────────────────────────
// File reads (sync + async): success/error × capturing/not-capturing × flags ×
// string-vs-buffer result (textData branches) × bytes-known/unknown.
// ───────────────────────────────────────────────────────────────────────────

describe('file read instrumentation', () => {
  test('sync read: string result (utf8), buffer result, flags, capturing on/off', async () => {
    const file = tmp('read-sync.txt');
    fs.writeFileSync(file, 'hello world');

    // Capturing + string result (textData -> string), explicit flag option.
    const spans = await capture(() => {
      const out = tracedReadFileSync(file, { encoding: 'utf8', flag: 'r' });
      expect(out).toBe('hello world');
      return capturedSubOpSpans();
    });
    expect(spans.some((s) => s.name === 'file.read')).toBe(true);
    // Completed-only fields (data/bytes) live on the completed span
    // (duration_ns !== null), not the started one.
    const read = spans.find(
      (s) =>
        s.name === 'file.read' &&
        (s as unknown as { duration_ns: number | null }).duration_ns !== null,
    ) as unknown as {
      data?: unknown;
      bytes_read?: number;
    };
    expect(read.data).toBe('hello world');
    expect(read.bytes_read).toBe(Buffer.byteLength('hello world'));

    // Parity (D1-file): the open→close lifecycle span carries BOTH cumulative
    // counters — the unused side as 0 (canonical close always sends both).
    const readClose = spans.find(
      (s) =>
        s.name === 'file.open' &&
        (s as unknown as { duration_ns: number | null }).duration_ns !== null,
    ) as unknown as { bytes_read?: number; bytes_written?: number };
    expect(readClose.bytes_read).toBe(Buffer.byteLength('hello world'));
    expect(readClose.bytes_written).toBe(0);

    // Capturing + buffer result (no encoding -> Buffer -> textData undefined),
    // string options form ('utf8' as the whole options arg => not an object).
    await capture(() => {
      const buf = tracedReadFileSync(file);
      expect(Buffer.isBuffer(buf)).toBe(true);
      const out = tracedReadFileSync(file, 'utf8');
      expect(out).toBe('hello world');
    });

    // NOT capturing: success path, isCapturing() false branch.
    expect(isCapturing()).toBe(false);
    expect(String(tracedReadFileSync(file, { encoding: 'utf8' }))).toBe(
      'hello world',
    );
  });

  test('sync read error: capturing on (records error) and off', async () => {
    const missing = path.join(tmpDir, 'does-not-exist.txt');

    await capture(() => {
      expect(() => tracedReadFileSync(missing)).toThrow();
      const spans = capturedSubOpSpans();
      const read = spans.find((s) => s.name === 'file.read') as unknown as {
        bytes_read?: number;
        error?: unknown;
      };
      expect(read).toBeTruthy();
      expect(read.bytes_read).toBeUndefined();
    });

    // NOT capturing: error path isCapturing() false branch.
    expect(() => tracedReadFileSync(missing)).toThrow();
  });

  test('async read: success + error × capturing on/off, flag number option', async () => {
    const file = tmp('read-async.txt');
    fs.writeFileSync(file, 'async contents');

    await capture(async () => {
      const out = await tracedReadFile(file, { encoding: 'utf8', flag: 0 });
      expect(out).toBe('async contents');
      const buf = await tracedReadFile(file);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    // NOT capturing success.
    expect(String(await tracedReadFile(file, 'utf8'))).toBe('async contents');

    const missing = path.join(tmpDir, 'missing-async.txt');
    await capture(async () => {
      await expect(tracedReadFile(missing)).rejects.toThrow();
    });
    // NOT capturing error.
    await expect(tracedReadFile(missing)).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// File writes (sync + async): success/error × capturing/not × string-vs-view
// data (byteLength string/Buffer/view-known/view-unknown branches).
// ───────────────────────────────────────────────────────────────────────────

describe('file write instrumentation', () => {
  test('sync write: string data, view data (byteLength known), capturing on/off', async () => {
    const file = tmp('write-sync.txt');

    const spans = await capture(() => {
      tracedWriteFileSync(file, 'written text', { encoding: 'utf8', flag: 'w' });
      return capturedSubOpSpans();
    });
    const write = spans.find(
      (s) =>
        s.name === 'file.write' &&
        (s as unknown as { duration_ns: number | null }).duration_ns !== null,
    ) as unknown as {
      data?: unknown;
      bytes_written?: number;
    };
    expect(write.data).toBe('written text');
    expect(write.bytes_written).toBe(Buffer.byteLength('written text'));

    // Parity (D1-file): write-side open→close lifecycle span carries bytes_read:0.
    const writeClose = spans.find(
      (s) =>
        s.name === 'file.open' &&
        (s as unknown as { duration_ns: number | null }).duration_ns !== null,
    ) as unknown as { bytes_read?: number; bytes_written?: number };
    expect(writeClose.bytes_written).toBe(Buffer.byteLength('written text'));
    expect(writeClose.bytes_read).toBe(0);

    // Buffer data -> Buffer.isBuffer branch, textData undefined.
    await capture(() => {
      tracedWriteFileSync(file, Buffer.from('buf data'));
    });
    // Typed-array view with a numeric byteLength -> view branch (known bytes).
    await capture(() => {
      tracedWriteFileSync(file, new Uint8Array([1, 2, 3, 4]));
    });

    // NOT capturing: success path false branch.
    tracedWriteFileSync(file, 'no capture');
    expect(fs.readFileSync(file, 'utf8')).toBe('no capture');
  });

  test('sync write: view with undefined byteLength hits the `?? 0` fallback', async () => {
    const file = tmp('write-view-unknown.bin');
    const view = new Uint8Array([9, 9, 9]);
    // A real ArrayBufferView always has a numeric byteLength, so override it to
    // exercise the `(view).byteLength ?? 0` nullish fallback in byteLength().
    Object.defineProperty(view, 'byteLength', {
      value: undefined,
      configurable: true,
    });

    const spans = await capture(() => {
      // fs.writeFileSync still accepts the tampered view (writes 0 bytes).
      tracedWriteFileSync(file, view as unknown as NodeJS.ArrayBufferView);
      return capturedSubOpSpans();
    });
    const write = spans.find(
      (s) =>
        s.name === 'file.write' &&
        (s as unknown as { duration_ns: number | null }).duration_ns !== null,
    ) as unknown as {
      bytes_written?: number;
    };
    expect(write.bytes_written).toBe(0);
  });

  test('sync write error: capturing on (records, bytes undefined) and off', async () => {
    const badPath = path.join(tmpDir, 'no-such-dir', 'nested.txt');

    await capture(() => {
      expect(() => tracedWriteFileSync(badPath, 'x')).toThrow();
      const write = capturedSubOpSpans().find(
        (s) => s.name === 'file.write',
      ) as unknown as { bytes_written?: number; error?: unknown };
      expect(write).toBeTruthy();
      expect(write.bytes_written).toBeUndefined();
    });

    // NOT capturing error path false branch.
    expect(() => tracedWriteFileSync(badPath, 'x')).toThrow();
  });

  test('async write: success + error × capturing on/off', async () => {
    const file = tmp('write-async.txt');

    await capture(async () => {
      await tracedWriteFile(file, 'async write', { flag: 'w' });
      await tracedWriteFile(file, new Uint8Array([5, 6]));
    });
    expect(fs.existsSync(file)).toBe(true);

    // NOT capturing success.
    await tracedWriteFile(file, 'async no capture');
    expect(fs.readFileSync(file, 'utf8')).toBe('async no capture');

    const badPath = path.join(tmpDir, 'no-such-dir', 'a.txt');
    await capture(async () => {
      await expect(tracedWriteFile(badPath, 'x')).rejects.toThrow();
    });
    // NOT capturing error.
    await expect(tracedWriteFile(badPath, 'x')).rejects.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SQLite: real DatabaseSync happy path + fakes for driver-shape branches.
// ───────────────────────────────────────────────────────────────────────────

describe('sqlite instrumentation (real node:sqlite DatabaseSync)', () => {
  test('SELECT/INSERT/exec/get/all emit db_query spans; idempotent; dbName null', async () => {
    const db = new DatabaseSync(':memory:');
    // DatabaseSync's prepare returns StatementSync (a nominal type), so cast to
    // the structural SqliteDatabaseLike the instrumenter accepts.
    const wrapped = instrumentSqlite(db as never);
    expect(wrapped).toBe(db);
    // Idempotent: second call short-circuits on the INSTRUMENTED flag.
    expect(instrumentSqlite(db as never)).toBe(db);

    const spans = await capture(() => {
      db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
      const ins = db.prepare('INSERT INTO t(v) VALUES (?)').run('a');
      expect(Number((ins as { changes: number }).changes)).toBe(1);
      const row = db.prepare('SELECT * FROM t WHERE id = ?').get(1) as {
        v: string;
      };
      expect(row.v).toBe('a');
      const rows = db.prepare('SELECT * FROM t').all();
      expect(rows.length).toBe(1);
      return capturedSubOpSpans();
    });

    const dbSpans = spans.filter(
      (s) => (s as unknown as { hook_type?: string }).hook_type === 'db_query',
    );
    expect(dbSpans.length).toBeGreaterThan(0);
    // node:sqlite DatabaseSync exposes `location` as a function (not a string)
    // and no string `name`, so db_name resolves to null.
    for (const s of dbSpans) {
      expect((s as unknown as { db_name: unknown }).db_name).toBeNull();
    }

    // Wrapped method outside a capture scope -> timeDatabaseCall isCapturing()
    // false branch.
    expect(isCapturing()).toBe(false);
    const outRows = db.prepare('SELECT * FROM t').all();
    expect(outRows.length).toBe(1);

    db.close();
  });
});

// Configurable fake sqlite db to drive the remaining instrumentSqlite /
// rowcountFor / sqliteDbName / timeDatabaseCall branches.
interface FakeOpts {
  name?: unknown;
  location?: unknown;
  withExec?: boolean;
  run?: (...a: unknown[]) => unknown;
  get?: (...a: unknown[]) => unknown;
  all?: (...a: unknown[]) => unknown;
  // When true, the prepared statement exposes `get` as a non-function (covers
  // the `typeof original === 'function'` false branch).
  getNotAFunction?: boolean;
  exec?: (sql: string) => unknown;
}

// A statement whose run/get/all may be a function (wrapped) or, for the
// getNotAFunction case, a non-function value (skipped by the wrapper).
type FakeStmt = Record<string, unknown>;
interface FakeDb {
  prepare: (sql: string) => FakeStmt;
  exec?: (sql: string) => unknown;
  name?: unknown;
  location?: unknown;
}

function makeFakeDb(opts: FakeOpts): FakeDb {
  const db: FakeDb = {
    prepare(_sql: string): FakeStmt {
      const stmt: FakeStmt = {};
      if (opts.run) stmt.run = opts.run;
      if (opts.getNotAFunction) {
        stmt.get = 123; // present but not callable -> skipped by the wrapper
      } else if (opts.get) {
        stmt.get = opts.get;
      }
      if (opts.all) stmt.all = opts.all;
      return stmt;
    },
  };
  if (opts.name !== undefined) db.name = opts.name;
  if (opts.location !== undefined) db.location = opts.location;
  if (opts.withExec) db.exec = opts.exec ?? ((_sql: string) => undefined);
  return db;
}

describe('sqlite instrumentation (fakes for driver-shape branches)', () => {
  test('rowcount paths: all(array/non-array), get(null/row), run(number/bigint/other/null)', async () => {
    let allReturn: unknown = [{ a: 1 }, { a: 2 }];
    let getReturn: unknown = { a: 1 };
    let runReturn: unknown = { changes: 3 };
    const db = makeFakeDb({
      all: () => allReturn,
      get: () => getReturn,
      run: () => runReturn,
    });
    instrumentSqlite(db as never);

    const rowcountOf = (sql: string, spans: ReturnType<typeof capturedSubOpSpans>) => {
      const completed = spans
        .filter(
          (s) =>
            (s as unknown as { db_statement?: string }).db_statement === sql &&
            (s as unknown as { duration_ns: number | null }).duration_ns !== null,
        )
        .map((s) => (s as unknown as { rowcount?: number }).rowcount);
      return completed[0];
    };

    // all -> array length (2)
    const s1 = await capture(() => {
      (db.prepare('SELECT a') as { all: () => unknown }).all();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('SELECT a', s1)).toBe(2);

    // all -> non-array -> rowcount undefined (dropped)
    allReturn = null;
    const s2 = await capture(() => {
      (db.prepare('SELECT b') as { all: () => unknown }).all();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('SELECT b', s2) ?? null).toBeNull();

    // get -> row -> 1
    const s3 = await capture(() => {
      (db.prepare('SELECT c') as { get: () => unknown }).get();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('SELECT c', s3)).toBe(1);

    // get -> null -> 0
    getReturn = null;
    const s4 = await capture(() => {
      (db.prepare('SELECT d') as { get: () => unknown }).get();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('SELECT d', s4)).toBe(0);

    // run -> { changes: number }
    const s5 = await capture(() => {
      (db.prepare('UPDATE e') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('UPDATE e', s5)).toBe(3);

    // run -> { changes: bigint } -> Number(...)
    runReturn = { changes: 7n };
    const s6 = await capture(() => {
      (db.prepare('UPDATE f') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('UPDATE f', s6)).toBe(7);

    // run -> { changes: 'x' } (neither number nor bigint) -> undefined
    runReturn = { changes: 'x' };
    const s7 = await capture(() => {
      (db.prepare('UPDATE g') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('UPDATE g', s7) ?? null).toBeNull();

    // run -> null -> optional chaining -> undefined
    runReturn = null;
    const s8 = await capture(() => {
      (db.prepare('UPDATE h') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    expect(rowcountOf('UPDATE h', s8) ?? null).toBeNull();
  });

  test('exec present (rowcount undefined for exec) and statement missing get method', async () => {
    const db = makeFakeDb({
      run: () => ({ changes: 1 }),
      getNotAFunction: true, // get present but not a function -> skipped
      all: () => [{}],
      withExec: true,
      exec: (_sql) => undefined,
    });
    instrumentSqlite(db as never);

    await capture(() => {
      (db.exec as (s: string) => unknown)('VACUUM');
      // statement.get is still the raw non-function value (wrapper skipped it).
      const stmt = db.prepare('SELECT 1') as Record<string, unknown>;
      expect(typeof stmt.get).toBe('number');
      (stmt.run as () => unknown)();
    });
  });

  test('error path: a wrapped call that throws records the error span and rethrows', async () => {
    const boom = new Error('db boom');
    const db = makeFakeDb({
      run: () => {
        throw boom;
      },
    });
    instrumentSqlite(db as never);

    await capture(() => {
      expect(() => (db.prepare('DELETE x') as { run: () => unknown }).run()).toThrow(
        'db boom',
      );
      const errSpan = capturedSubOpSpans().find(
        (s) =>
          (s as unknown as { db_statement?: string }).db_statement === 'DELETE x' &&
          (s as unknown as { error?: unknown }).error,
      );
      expect(errSpan).toBeTruthy();
    });

    // NOT capturing: wrapped throwing call, isCapturing() false branch on error.
    expect(() => (db.prepare('DELETE y') as { run: () => unknown }).run()).toThrow(
      'db boom',
    );
  });

  test('db_name resolution: name string, location string, neither -> null', async () => {
    const byName = makeFakeDb({ name: '/data/by-name.db', run: () => ({ changes: 1 }) });
    instrumentSqlite(byName as never);
    const s1 = await capture(() => {
      (byName.prepare('INSERT n') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    expect(
      s1.some((s) => (s as unknown as { db_name?: unknown }).db_name === '/data/by-name.db'),
    ).toBe(true);

    // No string name -> falls through to location.
    const byLocation = makeFakeDb({
      name: 123,
      location: '/data/by-location.db',
      run: () => ({ changes: 1 }),
    });
    instrumentSqlite(byLocation as never);
    const s2 = await capture(() => {
      (byLocation.prepare('INSERT l') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    expect(
      s2.some(
        (s) => (s as unknown as { db_name?: unknown }).db_name === '/data/by-location.db',
      ),
    ).toBe(true);

    // Neither string -> null.
    const byNone = makeFakeDb({ location: 42, run: () => ({ changes: 1 }) });
    instrumentSqlite(byNone as never);
    const s3 = await capture(() => {
      (byNone.prepare('INSERT z') as { run: () => unknown }).run();
      return capturedSubOpSpans();
    });
    const insZ = s3.filter(
      (s) => (s as unknown as { db_statement?: string }).db_statement === 'INSERT z',
    );
    expect(insZ.length).toBeGreaterThan(0);
    for (const s of insZ) {
      expect((s as unknown as { db_name: unknown }).db_name).toBeNull();
    }
  });

  test('sqlOperation verb classification: SELECT, INSERT, unknown verb, no leading letter', async () => {
    const db = makeFakeDb({ run: () => ({ changes: 0 }) });
    instrumentSqlite(db as never);

    const opFor = (sql: string, spans: ReturnType<typeof capturedSubOpSpans>) =>
      spans
        .filter((s) => (s as unknown as { db_statement?: string }).db_statement === sql)
        .map((s) => (s as unknown as { db_operation?: string }).db_operation)[0];

    const spans = await capture(() => {
      (db.prepare('  select * from t') as { run: () => unknown }).run();
      (db.prepare('INSERT INTO t VALUES (1)') as { run: () => unknown }).run();
      (db.prepare('VACUUM') as { run: () => unknown }).run(); // not whitelisted
      (db.prepare('123 not sql') as { run: () => unknown }).run(); // no leading letter
      return capturedSubOpSpans();
    });

    expect(opFor('  select * from t', spans)).toBe('SELECT');
    expect(opFor('INSERT INTO t VALUES (1)', spans)).toBe('INSERT');
    expect(opFor('VACUUM', spans)).toBe('UNKNOWN');
    expect(opFor('123 not sql', spans)).toBe('UNKNOWN');
  });

  test('db without exec: the exec wrapping branch is skipped', async () => {
    const db = makeFakeDb({ run: () => ({ changes: 1 }) }); // withExec false
    instrumentSqlite(db as never);
    expect('exec' in db).toBe(false);
    await capture(() => {
      (db.prepare('UPDATE noexec') as { run: () => unknown }).run();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// traced(): sync/async × success/error × capturing on/off × capture options.
// ───────────────────────────────────────────────────────────────────────────

describe('traced function instrumentation', () => {
  test('sync success records a function_call span; default capture options', async () => {
    const fn = traced('addNums', (a: number, b: number) => a + b);
    const spans = await capture(() => {
      expect(fn(2, 3)).toBe(5);
      return capturedSubOpSpans();
    });
    expect(
      spans.some(
        (s) => (s as unknown as { hook_type?: string }).hook_type === 'function_call',
      ),
    ).toBe(true);
  });

  test('sync function that throws records the error and rethrows', async () => {
    const boom = new Error('sync boom');
    const fn = traced('throws', () => {
      throw boom;
    });
    await capture(() => {
      expect(() => fn()).toThrow('sync boom');
      expect(
        capturedSubOpSpans().some(
          (s) => (s as unknown as { error?: unknown }).error === 'sync boom',
        ),
      ).toBe(true);
    });
  });

  test('async resolve and async reject paths', async () => {
    const ok = traced('asyncOk', async (x: number) => x * 2);
    const bad = traced('asyncBad', async () => {
      throw new Error('async boom');
    });

    await capture(async () => {
      expect(await ok(4)).toBe(8);
      await expect(bad()).rejects.toThrow('async boom');
      const spans = capturedSubOpSpans();
      expect(
        spans.some(
          (s) => (s as unknown as { error?: unknown }).error === 'async boom',
        ),
      ).toBe(true);
    });
  });

  test('capture options off and not-capturing short-circuit', async () => {
    const fn = traced('noCapture', (a: number) => a + 1, {
      captureArgs: false,
      captureResult: false,
    });
    // capturing: record() runs but with args/result omitted.
    await capture(() => {
      expect(fn(1)).toBe(2);
    });
    // NOT capturing: record() returns early at `if (!isCapturing())`.
    expect(isCapturing()).toBe(false);
    expect(fn(10)).toBe(11);

    // Async not capturing (covers async record() early-return on resolve path).
    const asyncFn = traced('asyncNoCapture', async (a: number) => a + 1);
    expect(await asyncFn(5)).toBe(6);
  });
});
