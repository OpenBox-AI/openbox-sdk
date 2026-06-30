// Sub-operation instrumentation entry points for governed tools.
//
// Canonical (openbox-langgraph-sdk-python) auto-instruments HTTP/DB/file/function
// via OpenTelemetry monkey-patching of the underlying libraries. Node/ESM cannot
// reliably monkey-patch built-in modules (`node:fs`, db drivers) for ESM
// consumers — namespaces are frozen and named imports are live bindings — so the
// only true global we patch is `fetch` (see registerOpenBoxOtel in
// otel-capture.ts). For file and database I/O we instead expose instrumented
// entry points: the span is still emitted automatically from the REAL operation
// (real path, statement, timing, bytes), not hand-fabricated. The integrator
// performs I/O through these wrappers instead of declaring spans by hand.
//
// Every span produced here lands in the active capture scope
// (`runWithSubOpCapture`) and is later submitted as a canonical `hook_trigger`
// span evaluation correlated to the parent activity.

import * as fs from 'node:fs';
import { CANONICAL_SPAN } from '../core-client/generated/govern.js';
import * as fsp from 'node:fs/promises';
import {
  isCapturing,
  recordDatabaseQuery,
  recordFileOperation,
  recordFunctionCall,
} from './otel-capture.js';

function now(): number {
  return Date.now();
}

function byteLength(data: string | Buffer | NodeJS.ArrayBufferView): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.byteLength;
  return (data as ArrayBufferView).byteLength ?? 0;
}

// Capture text content only (binary stays as bytes_read without a body).
function textData(data: unknown): string | undefined {
  return typeof data === 'string' ? data : undefined;
}

function fileFlag(
  options:
    | { encoding?: BufferEncoding | null; flag?: string | number }
    | BufferEncoding
    | null
    | undefined,
  fallback: string,
): string {
  if (options && typeof options === 'object' && options.flag != null) {
    return String(options.flag);
  }
  return fallback;
}

// Mirror the canonical open→operation→close lifecycle: a `file.open` span held
// across the op (started 'open', completed 'close' carrying aggregate bytes +
// operations[]) PLUS the per-operation read/write span carrying data + bytes.
function emitFileRead(
  filePath: string,
  mode: string,
  result: string | Buffer | undefined,
  startMs: number,
  endMs: number,
  error?: unknown,
): void {
  const bytesRead = error || result === undefined ? undefined : byteLength(result);
  recordFileOperation({
    filePath,
    operation: 'open',
    fileMode: mode,
    operations: ['read'],
    bytesRead,
    // Canonical close emits BOTH cumulative counters (the unused side as 0,
    // since `0 is not None`); a read-only close still carries bytes_written:0.
    bytesWritten: 0,
    startMs,
    endMs,
    error,
  });
  recordFileOperation({
    filePath,
    operation: 'read',
    fileMode: mode,
    bytesRead,
    data: error ? undefined : textData(result),
    startMs,
    endMs,
    error,
  });
}

function emitFileWrite(
  filePath: string,
  mode: string,
  data: string | Buffer | NodeJS.ArrayBufferView,
  startMs: number,
  endMs: number,
  error?: unknown,
): void {
  const bytesWritten = error ? undefined : byteLength(data);
  recordFileOperation({
    filePath,
    operation: 'open',
    fileMode: mode,
    operations: ['write'],
    bytesWritten,
    // Canonical close emits BOTH cumulative counters (the unused side as 0);
    // a write-only close still carries bytes_read:0.
    bytesRead: 0,
    startMs,
    endMs,
    error,
  });
  recordFileOperation({
    filePath,
    operation: 'write',
    fileMode: mode,
    bytesWritten,
    data: error ? undefined : textData(data),
    startMs,
    endMs,
    error,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// File I/O
// ───────────────────────────────────────────────────────────────────────────

/**
 * Instrumented synchronous file read. Emits the canonical `file.open`(open→close)
 * + `file.read` span pair (with file_mode, bytes_read, and text data) into the
 * active capture scope, then returns the file contents. Use in place of
 * `fs.readFileSync` inside a governed tool so secret-path reads are governed by
 * OpenBox's file-read behavioral rules.
 */
export function tracedReadFileSync(
  path: string | URL,
  options?:
    | { encoding?: BufferEncoding | null; flag?: string }
    | BufferEncoding
    | null,
): string | Buffer {
  const startMs = now();
  const mode = fileFlag(options as never, 'r');
  try {
    const result = fs.readFileSync(path, options as never);
    if (isCapturing()) emitFileRead(String(path), mode, result, startMs, now());
    return result;
  } catch (error) {
    if (isCapturing()) emitFileRead(String(path), mode, undefined, startMs, now(), error);
    throw error;
  }
}

/** Instrumented asynchronous file read (promise form). */
export async function tracedReadFile(
  path: string | URL,
  options?:
    | { encoding?: BufferEncoding | null; flag?: string | number }
    | BufferEncoding
    | null,
): Promise<string | Buffer> {
  const startMs = now();
  const mode = fileFlag(options, 'r');
  try {
    const result = await fsp.readFile(path, options as never);
    if (isCapturing()) emitFileRead(String(path), mode, result, startMs, now());
    return result;
  } catch (error) {
    if (isCapturing()) emitFileRead(String(path), mode, undefined, startMs, now(), error);
    throw error;
  }
}

/**
 * Instrumented synchronous file write. Emits the canonical `file.open`(open→close)
 * + `file.write` span pair (file_mode, bytes_written, text data) so file-write
 * behavioral rules fire on real writes. Use in place of `fs.writeFileSync`.
 */
export function tracedWriteFileSync(
  path: string | URL,
  data: string | NodeJS.ArrayBufferView,
  options?:
    | { encoding?: BufferEncoding | null; mode?: number; flag?: string }
    | BufferEncoding
    | null,
): void {
  const startMs = now();
  const mode = fileFlag(options as never, 'w');
  try {
    fs.writeFileSync(path, data as never, options as never);
    if (isCapturing()) emitFileWrite(String(path), mode, data, startMs, now());
  } catch (error) {
    if (isCapturing()) emitFileWrite(String(path), mode, data, startMs, now(), error);
    throw error;
  }
}

/** Instrumented asynchronous file write (promise form). */
export async function tracedWriteFile(
  path: string | URL,
  data: string | NodeJS.ArrayBufferView,
  options?:
    | { encoding?: BufferEncoding | null; mode?: number; flag?: string }
    | BufferEncoding
    | null,
): Promise<void> {
  const startMs = now();
  const mode = fileFlag(options as never, 'w');
  try {
    await fsp.writeFile(path, data as never, options as never);
    if (isCapturing()) emitFileWrite(String(path), mode, data, startMs, now());
  } catch (error) {
    if (isCapturing()) emitFileWrite(String(path), mode, data, startMs, now(), error);
    throw error;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Database (instance wrapping — works for better-sqlite3 and node:sqlite)
// ───────────────────────────────────────────────────────────────────────────

interface SqliteStatementLike {
  run?: (...args: unknown[]) => unknown;
  get?: (...args: unknown[]) => unknown;
  all?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

interface SqliteDatabaseLike {
  prepare: (sql: string) => SqliteStatementLike;
  exec?: (sql: string) => unknown;
  [key: string]: unknown;
}

const INSTRUMENTED = Symbol('openbox.sqlite.instrumented');

// Canonical _classify_sql verb whitelist (db_governance_hooks.py:71-80) — any
// other leading token classifies as UNKNOWN.
const SQL_VERBS = new Set<string>(CANONICAL_SPAN.sqlVerbs);

function sqlOperation(statement: string): string {
  const match = statement.trim().match(/^[a-zA-Z]+/);
  const verb = (match ? match[0] : '').toUpperCase();
  return SQL_VERBS.has(verb) ? verb : 'UNKNOWN';
}

// rowcount from the driver result, by call shape (canonical reads cursor.rowcount).
function rowcountFor(
  method: 'run' | 'get' | 'all' | 'exec',
  result: unknown,
): number | undefined {
  if (method === 'all') return Array.isArray(result) ? result.length : undefined;
  if (method === 'get') return result == null ? 0 : 1;
  if (method === 'run') {
    const changes = (result as { changes?: unknown } | null)?.changes;
    if (typeof changes === 'number') return changes;
    if (typeof changes === 'bigint') return Number(changes);
  }
  return undefined;
}

function timeDatabaseCall<T>(
  statement: string,
  method: 'run' | 'get' | 'all' | 'exec',
  dbName: string | null,
  run: () => T,
): T {
  const startMs = now();
  try {
    const result = run();
    if (isCapturing()) {
      recordDatabaseQuery({
        statement,
        operation: sqlOperation(statement),
        system: 'sqlite',
        dbName,
        // sqlite is file/in-memory — no network endpoint (canonical leaves these
        // null for sqlite too).
        serverAddress: null,
        serverPort: null,
        rowcount: rowcountFor(method, result),
        startMs,
        endMs: now(),
      });
    }
    return result;
  } catch (error) {
    if (isCapturing()) {
      recordDatabaseQuery({
        statement,
        operation: sqlOperation(statement),
        system: 'sqlite',
        dbName,
        serverAddress: null,
        serverPort: null,
        startMs,
        endMs: now(),
        error,
      });
    }
    throw error;
  }
}

function sqliteDbName(db: SqliteDatabaseLike): string | null {
  // better-sqlite3 exposes `name` (file path); node:sqlite DatabaseSync exposes
  // `location`. Fall back to null (canonical db_name is nullable).
  const named = db as { name?: unknown; location?: unknown };
  if (typeof named.name === 'string') return named.name;
  if (typeof named.location === 'string') return named.location;
  return null;
}

/**
 * Wrap a sqlite Database instance (better-sqlite3 or node:sqlite `DatabaseSync`)
 * so every `prepare(...).run/get/all` and `exec` emits a `db_query` span (with
 * db_name + rowcount) into the active capture scope. Returns the same instance
 * (mutated). Idempotent.
 */
export function instrumentSqlite<TDatabase extends SqliteDatabaseLike>(
  db: TDatabase,
): TDatabase {
  const flagged = db as TDatabase & { [INSTRUMENTED]?: boolean };
  if (flagged[INSTRUMENTED]) return db;
  flagged[INSTRUMENTED] = true;
  const dbName = sqliteDbName(db);

  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql: string): SqliteStatementLike => {
    const stmt = originalPrepare(sql);
    for (const method of ['run', 'get', 'all'] as const) {
      const original = stmt[method];
      if (typeof original === 'function') {
        const bound = original.bind(stmt);
        stmt[method] = (...args: unknown[]) =>
          timeDatabaseCall(sql, method, dbName, () => bound(...args));
      }
    }
    return stmt;
  };

  if (typeof db.exec === 'function') {
    const originalExec = db.exec.bind(db);
    db.exec = (sql: string) =>
      timeDatabaseCall(sql, 'exec', dbName, () => originalExec(sql));
  }

  return db;
}

// ───────────────────────────────────────────────────────────────────────────
// Function tracing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wrap a function so each call emits a `function_call` span (args + result,
 * serialized and truncated) into the active capture scope. Mirrors the
 * reference `@traced` decorator. Supports sync and async functions.
 */
export function traced<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => TResult,
  options: { captureArgs?: boolean; captureResult?: boolean } = {},
): (...args: TArgs) => TResult {
  const captureArgs = options.captureArgs !== false;
  const captureResult = options.captureResult !== false;
  return (...args: TArgs): TResult => {
    const startMs = now();
    const record = (result: unknown, error?: unknown) => {
      if (!isCapturing()) return;
      recordFunctionCall({
        name,
        args: captureArgs ? args : undefined,
        result: captureResult ? result : undefined,
        startMs,
        endMs: now(),
        error,
      });
    };
    let result: TResult;
    try {
      result = fn(...args);
    } catch (error) {
      record(undefined, error);
      throw error;
    }
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          record(value);
          return value;
        },
        (error) => {
          record(undefined, error);
          throw error;
        },
      ) as unknown as TResult;
    }
    record(result);
    return result;
  };
}
