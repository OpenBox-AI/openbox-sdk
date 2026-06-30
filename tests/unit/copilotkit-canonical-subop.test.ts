import { describe, expect, test } from 'vitest';
import {
  capturedSubOpSpans,
  parentSpanIdForActivity,
  recordDatabaseQuery,
  recordFileOperation,
  runWithSubOpCapture,
} from '../../ts/src/copilotkit/otel-capture.js';

// Locks the copilotkit-only canonicalization against the Python reference
// (_build_file_span_data / _build_db_span_data). These are stripped/rewritten in
// canonicalizeSubOpSpan so the shared builder (cursor/claude-code/codex) is
// untouched.
describe('copilotkit canonical sub-op span shape', () => {
  test('file.open attributes are exactly {file.path, file.mode} — no file.operation (canonical traced_open)', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'act-1' }, async () => {
      recordFileOperation({
        filePath: '/tmp/vault/prod.env',
        operation: 'open',
        fileMode: 'r',
        bytesRead: 449,
        startMs: 1000,
        endMs: 1002,
      });
      return capturedSubOpSpans();
    });

    const open = spans.filter((s) => s.name === 'file.open');
    expect(open.length).toBeGreaterThan(0);
    for (const s of open) {
      const attrs = (s as unknown as { attributes: Record<string, unknown> })
        .attributes;
      expect(attrs['file.path']).toBe('/tmp/vault/prod.env');
      expect(attrs['file.mode']).toBe('r');
      // Canonical open span sets file.operation only at the ROOT (file_operation),
      // never as an attribute (unlike read/write).
      expect('file.operation' in attrs).toBe(false);
      expect(['open', 'close']).toContain(
        (s as unknown as { file_operation: string }).file_operation,
      );
      // Parented to the activity span like its siblings.
      expect((s as unknown as { parent_span_id: string }).parent_span_id).toBe(
        parentSpanIdForActivity('act-1'),
      );
    }
  });

  test('db span name is "{operation} {system}" and the started span carries db_name (canonical _build_db_span_data)', async () => {
    const spans = await runWithSubOpCapture({ activityId: 'act-2' }, async () => {
      recordDatabaseQuery({
        statement: 'SELECT 1',
        operation: 'SELECT',
        system: 'sqlite',
        dbName: '/tmp/app.db',
        serverAddress: null,
        serverPort: null,
        rowcount: 1,
        startMs: 2000,
        endMs: 2003,
      });
      return capturedSubOpSpans();
    });

    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.name).toBe('SELECT');
      expect((s as unknown as { db_system: string }).db_system).toBe('sqlite');
    }
    const started = spans.find(
      (s) => (s as unknown as { stage: string }).stage === 'started',
    );
    expect((started as unknown as { db_name: string }).db_name).toBe(
      '/tmp/app.db',
    );
  });
});
