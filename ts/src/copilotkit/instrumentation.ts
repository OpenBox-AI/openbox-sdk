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

// ───────────────────────────────────────────────────────────────────────────
// File I/O
// ───────────────────────────────────────────────────────────────────────────

/**
 * Instrumented synchronous file read. Emits a `file_operation` (read) span pair
 * into the active capture scope, then returns the file contents. Use in place of
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
  try {
    const result = fs.readFileSync(path, options as never);
    if (isCapturing()) {
      recordFileOperation({
        filePath: String(path),
        operation: 'read',
        startMs,
        endMs: now(),
      });
    }
    return result;
  } catch (error) {
    if (isCapturing()) {
      recordFileOperation({
        filePath: String(path),
        operation: 'read',
        startMs,
        endMs: now(),
        error,
      });
    }
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
  try {
    const result = await fsp.readFile(path, options as never);
    if (isCapturing()) {
      recordFileOperation({
        filePath: String(path),
        operation: 'read',
        startMs,
        endMs: now(),
      });
    }
    return result;
  } catch (error) {
    if (isCapturing()) {
      recordFileOperation({
        filePath: String(path),
        operation: 'read',
        startMs,
        endMs: now(),
        error,
      });
    }
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

function sqlOperation(statement: string): string {
  const match = statement.trim().match(/^[a-zA-Z]+/);
  return (match ? match[0] : 'UNKNOWN').toUpperCase();
}

function timeDatabaseCall<T>(statement: string, run: () => T): T {
  const startMs = now();
  try {
    const result = run();
    if (isCapturing()) {
      recordDatabaseQuery({
        statement,
        operation: sqlOperation(statement),
        system: 'sqlite',
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
        startMs,
        endMs: now(),
        error,
      });
    }
    throw error;
  }
}

/**
 * Wrap a sqlite Database instance (better-sqlite3 or node:sqlite `DatabaseSync`)
 * so every `prepare(...).run/get/all` and `exec` emits a `db_query` span into the
 * active capture scope. Returns the same instance (mutated). Idempotent.
 */
export function instrumentSqlite<TDatabase extends SqliteDatabaseLike>(
  db: TDatabase,
): TDatabase {
  const flagged = db as TDatabase & { [INSTRUMENTED]?: boolean };
  if (flagged[INSTRUMENTED]) return db;
  flagged[INSTRUMENTED] = true;

  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql: string): SqliteStatementLike => {
    const stmt = originalPrepare(sql);
    for (const method of ['run', 'get', 'all'] as const) {
      const original = stmt[method];
      if (typeof original === 'function') {
        const bound = original.bind(stmt);
        stmt[method] = (...args: unknown[]) =>
          timeDatabaseCall(sql, () => bound(...args));
      }
    }
    return stmt;
  };

  if (typeof db.exec === 'function') {
    const originalExec = db.exec.bind(db);
    db.exec = (sql: string) => timeDatabaseCall(sql, () => originalExec(sql));
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
