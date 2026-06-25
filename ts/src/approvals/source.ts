// Source attribution for an approval row. The backend's `Approval`
// model has no first-class `source` column; the originating host
// (such as `cursor` or `claude-code`) is recoverable through three
// read paths the SDK guarantees, in priority order:
//
//   1. `metadata.source`. Preferred. `ApprovalMetadata` is
//      open-keyed, so a future backend step can populate this from
//      the span data below without breaking the spec. Reading this
//      first means consumers automatically pick up the new field
//      once it lands.
//
//   2. `input[0]._openbox_source`. SDK-side mirror the runtime
//      adapter stamps onto every dispatched activity payload (see
//      `stampSource()`). This field survives the backend's
//      pending-list endpoint because the `input` array is preserved
//      verbatim; spans are not. Without this mirror, every row
//      attributed via spans alone resolves to undefined on the live
//      Cursor / mobile feeds, which makes source-filtering useless
//      in practice. Adapters that want their rows filterable should
//      call `stampSource(payload, host)` before each
//      `session.activity()` call.
//
//   3. `spans[0].module` or
//      `spans[0].attributes['gen_ai.system']`. Available on the
//      single-row detail endpoint (which keeps spans). Adapters set
//      `module: <host>` via `buildSpan()` in `governance/spans.ts`.
//
// Approvals of unknown origin return `undefined` rather than a
// guess. Consumers (extension filter, approver badge, mobile chip)
// should treat `undefined` permissively by default, displaying the
// row rather than hiding it; opt-in strict-filter modes can flip
// that.

import type { Approval } from '../types/index.js';

/** Key the SDK stamps on every activity input item to attribute the
 *  row to its originating host. Adapters should use `stampSource()`
 *  below rather than writing the key directly. */
export const SOURCE_INPUT_KEY = '_openbox_source';

/** Canonical host names. Free-form so a third-party host
 *  integration can use its own slug without an SDK change. */
export type ApprovalSource = string;

function readMetadataSource(a: Approval): string | undefined {
  const meta = (a as { metadata?: unknown }).metadata;
  if (!meta || typeof meta !== 'object') return undefined;
  const src = (meta as Record<string, unknown>).source;
  return typeof src === 'string' && src.length > 0 ? src : undefined;
}

function readInputSource(a: Approval): string | undefined {
  const input = (a as { input?: unknown }).input;
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const head = input[0];
  if (!head || typeof head !== 'object') return undefined;
  const src = (head as Record<string, unknown>)[SOURCE_INPUT_KEY];
  return typeof src === 'string' && src.length > 0 ? src : undefined;
}

function readSpanModule(a: Approval): string | undefined {
  const spans = (a as { spans?: unknown }).spans;
  if (!Array.isArray(spans) || spans.length === 0) return undefined;
  const span = spans[0];
  if (!span || typeof span !== 'object') return undefined;
  const s = span as Record<string, unknown>;
  if (typeof s.module === 'string' && s.module.length > 0) return s.module;
  const attrs = s.attributes;
  if (attrs && typeof attrs === 'object') {
    const sys = (attrs as Record<string, unknown>)['gen_ai.system'];
    if (typeof sys === 'string' && sys.length > 0) return sys;
  }
  return undefined;
}

/**
 * Infers the originating host for an approval. The file header
 * describes the three read paths. Returns `undefined` when none
 * carries a value; callers should treat that as "unknown".
 */
export function approvalSource(a: Approval): ApprovalSource | undefined {
  return readMetadataSource(a) ?? readInputSource(a) ?? readSpanModule(a);
}

/**
 * Attaches host attribution to an activity input payload. The
 * adapter's mappers call this on every payload before passing it to
 * `session.activity()`; downstream readers see the source in the
 * persisted approval row's `input[0]._openbox_source` even after
 * the backend strips spans from list responses.
 *
 * Returns a new object so the caller's payload is not mutated.
 */
export function stampSource<T extends Record<string, unknown>>(
  payload: T,
  host: string,
): T & { [SOURCE_INPUT_KEY]: string } {
  return { ...payload, [SOURCE_INPUT_KEY]: host };
}
