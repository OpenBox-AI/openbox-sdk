<!-- TODO: post-monorepo-consolidation rewrite. References below describe the standalone repos; the consolidated openbox-sdk has the same surface under openbox-sdk/runtime/<x> sub-paths and openbox-sdk CLI subcommands. -->
# OpenBox TypeScript SDK Reference

Package: `openbox-sdk` (install: `npm install openbox-sdk@github:OpenBox-AI/openbox-sdk`)
Requires: Node.js >= 18

Use `govern()` for all integrations. It handles the full lifecycle automatically (WorkflowStarted → ActivityStarted → your code → ActivityCompleted → WorkflowCompleted). Only use `GovernanceEngine` or `OpenBoxClient.evaluate()` for debugging or when you need manual control over individual lifecycle steps - in production, `govern()` prevents the span/payload errors that cause 500s.

## Quick Start

```typescript
import { govern } from 'openbox-sdk';
import type { HttpTransport } from 'openbox-sdk';

const transport: HttpTransport = async (opts) => {
  const res = await fetch(opts.url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
};

const { output, meta } = await govern(
  transport,
  { apiKey: 'obx_live_...', activityType: 'CustomerSupport' },
  'SupportWorkflow',
  { message: userMessage },
  async (governed) => {
    // governed.message may be redacted by guardrails
    const response = await callLlm(governed.message);
    return { response };
  },
);
// meta.verdict, meta.pii_redacted, meta.risk_score, meta.trust_tier (number|null)
```

The SDK wraps your call with: `WorkflowStarted → ActivityStarted → [your code] → ActivityCompleted → WorkflowCompleted`

## govern() API

```typescript
govern(transport, config, workflowName, input, activity, options?)
```

| Param | Type | Description |
|-------|------|-------------|
| `transport` | `HttpTransport` | HTTP function (fetch/axios/etc) |
| `config` | `object \| string` | Config object or just API key string |
| `workflowName` | `string` | Workflow name (shown in dashboard) |
| `input` | `Record<string, unknown>` | Input to govern |
| `activity` | `(governed) => Promise<T>` | Your callback - receives governed input |
| `options.validate` | `boolean` | Validate API key on startup |

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | - | `obx_live_*` or `obx_test_*` |
| `apiEndpoint` | `string` | `https://core.openbox.ai` | Core API URL |
| `activityType` | `string` | `DefaultActivity` | Must match dashboard config |
| `governancePolicy` | `'fail_open' \| 'fail_closed'` | `'fail_open'` | Behavior when Core unreachable |
| `apiTimeout` | `number` | `30` | Seconds before Core HTTP request times out |
| `maxBodySize` | `number \| null` | `null` | Optional cap on payload body size; `null` = unlimited |
| `sendStartEvent` | `boolean` | `true` | Emit `WorkflowStarted` events |
| `sendActivityStartEvent` | `boolean` | `true` | Emit `ActivityStarted` events (disable to skip input-stage guardrails) |
| `skipWorkflowTypes` | `Set<string>` | `new Set()` | Workflow names to bypass entirely |
| `skipActivityTypes` | `Set<string>` | `new Set()` | Activity types to bypass entirely |
| `skipHitlActivityTypes` | `Set<string>` | `new Set()` | Activity types that never block on approval |
| `hitlEnabled` | `boolean` | `false` | Enable approval workflows |
| `hitlPollInterval` | `number` | `5` | Seconds between approval polls |
| `hitlMaxWait` | `number` | `300` | Max seconds to wait for approval |
| `taskQueue` | `string` | `'default'` | Framework identifier |
| `spanType` | `'http_request' \| 'db_query' \| 'file_operation' \| 'function_call' \| 'gen_ai'` | `'function_call'` | Span type for behavior rule matching. Must match core's semantic type detection. |
| `spanAttributes` | `Record<string, unknown>` | `{}` | Gate attributes for semantic type detection. See below. |

## Emitted Event Types

The SDK emits 5 of the 6 core event types:

| Event | Emitted? | Notes |
|-------|----------|-------|
| `WorkflowStarted` | ✓ | Auto-sent unless `sendStartEvent: false` |
| `ActivityStarted` | ✓ | Auto-sent unless `sendActivityStartEvent: false` |
| `ActivityCompleted` | ✓ | Always sent |
| `WorkflowCompleted` | ✓ | On success path |
| `WorkflowFailed` | ✓ | Emitted from `govern()`'s error path - `engine.ts:230-241` builds a `workflow-failed` span and `deriveEventType` maps `module: 'workflow-failed'` to this event_type |
| `SignalReceived` | ✗ | Not exposed by `govern()`. Needed for Temporal-like signals or drift-detection goals - build manually via `OpenBoxClient.evaluate()` if required. |

For the canonical event-type list and wire fields (`parent_workflow_id`, `signal_name`, `signal_args`, `start_time`, `end_time`, `sdk_version`, `duration_ms`), see `references/governance-flow.md`. Those fields are accepted by core but not currently set by this SDK's `GovernancePayload` type.

**spanType + spanAttributes examples:**
```typescript
// HTTP tool → behavior rules for http_post will fire
{ spanType: 'http_request', spanAttributes: { 'http.method': 'POST', 'http.url': 'https://api.stripe.com/charges' } }

// Database tool → behavior rules for database_select will fire
{ spanType: 'db_query', spanAttributes: { 'db.system': 'postgresql', 'db.operation': 'SELECT' } }

// File tool → behavior rules for file_write will fire
{ spanType: 'file_operation', spanAttributes: { 'file.path': '/tmp/output.csv' } }

// Default (no spanType) → function_call → semantic type 'internal' → no behavior rules fire
```

## Transport Examples

```typescript
// fetch (browser/Node 18+)
const transport: HttpTransport = async (opts) => {
  const res = await fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return res.json();
};

// axios
const transport: HttpTransport = async (opts) => {
  const { data } = await axios({ method: opts.method, url: opts.url, headers: opts.headers, data: opts.body });
  return data;
};
```

## Error Handling

```typescript
import {
  GovernanceError,           // base class for all governance errors
  GovernanceBlockedError,    // BLOCK or HALT verdict
  GuardrailsValidationError, // guardrail check failed
  ApprovalExpiredError,      // approval timed out
  ApprovalRejectedError,     // human rejected
  ApprovalDisabledError,     // require_approval but hitlEnabled=false
  OpenBoxConfigError,        // base class for config-layer errors
  OpenBoxAuthError,          // invalid API key
  OpenBoxNetworkError,       // Core unreachable
  OpenBoxInsecureURLError,   // apiEndpoint isn't https (rejects plaintext for prod keys)
} from 'openbox-sdk';

try {
  const { output } = await govern(transport, config, 'Wf', input, activity);
} catch (err) {
  if (err instanceof GuardrailsValidationError) {
    // err.reasons - string[], err.context - 'input'|'output'
  }
  if (err instanceof GovernanceBlockedError) {
    // err.verdict - 'block'|'halt', err.reason - string
  }
  if (err instanceof ApprovalRejectedError) {
    // err.reason - rejection reason
  }
}
```

## Direct Engine Access

For manual control over individual lifecycle steps:

```typescript
import { GovernanceEngine, OpenBoxClient, createConfig } from 'openbox-sdk';

const config = createConfig({ apiKey: 'obx_live_...', activityType: 'CustomerSupport' });
const client = new OpenBoxClient(transport, config);
const engine = new GovernanceEngine(client, config);

const session = engine.createSession('SupportWorkflow');
const { data: governed } = await engine.governInput(session, userInput);
const llmResult = await callLlm(governed.message);
const { data: final, meta } = await engine.governOutput(session, llmResult);
```

## Guardrail Field Paths

The SDK sends input as `activity_input: [{ message: "..." }]`. Dashboard field paths use `input.*` wildcard:
- Input field `{ message }` → path: `input.*.message`
- Input field `{ body }` → path: `input.*.body`

## Key Facts

- Input guardrails can **redact** (replace PII with placeholders) - the callback receives the redacted version
- Output guardrails can redact the return value
- `fail_open` (default): Core errors are logged, execution continues ungoverned
- `fail_closed`: Core errors throw, execution stops
- The SDK handles `activity_input` array wrapping internally - pass a plain object to `govern()`
- Verdicts: `allow`, `require_approval`, `block`, `halt` (lowercase strings in JSON). CONSTRAIN is not produced by any server component.
- `meta.trust_tier` is `number | null` (server sends integer, not string)
- `meta.alignment_score` does not exist - alignment data is inside `age_result.span_results[].alignment_result.score` (per-span, not root level)
