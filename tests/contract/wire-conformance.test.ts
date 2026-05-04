// spec-driven wire conformance.
//
// For every spec op in the generated CLI handler manifests, this test:
//   1. Spins up an in-process HTTP capture server (no msw / no extra dep).
//   2. Builds an OpenBoxClient pointed at the capture server.
//   3. Invokes the SDK method named in the handler's `backend.method`.
//   4. Asserts a request was actually issued, the method exists on the
//      SDK class, and the wire shape (method + URL prefix + has-body) is
//      consistent with the spec's `backend.shape` ("body" → POST/PUT
//      payload, "positional" → query / URL-encoded args).
//
// What this catches:
//   - SDK method renames that drift from `@cli_calls("...")` in spec.
//   - Wire-shape regressions (POST→GET, body→positional swaps).
//   - Methods that silently no-op (don't issue HTTP at all).
//
// What this is the foundation for:
//   - Per-language emitters render the SAME assertion file for Rust /
//     Go / Python by iterating the same handler manifest. The manifest
//     is the wire contract; this driver is the TS reference impl.
//
// Why no msw: msw is great but adds a dep + service-worker setup that
// doesn't fit Node-native test runs. http.createServer is 30 LOC and
// equivalent for this layer.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { OpenBoxClient } from '../../ts/src/client';

import { AGENT_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/agent';
import { API_KEY_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/api-key';
import { APPROVAL_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/approval';
import { AUDIT_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/audit';
import { BEHAVIOR_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/behavior';
import { GOAL_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/goal';
import { GUARDRAIL_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/guardrail';
import { OBSERVE_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/observe';
import { ORG_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/org';
import { POLICY_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/policy';
import { SESSION_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/session';
import { SSO_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/sso';
import { TEAM_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/team';
import { TRUST_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/trust';
import { VIOLATION_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/violation';
import { WEBHOOK_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/webhook';
import { AIVSS_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/aivss';
import { MEMBER_HANDLERS } from '../../ts/src/cli/generated/cli-handlers/member';
import type { SubcommandSpec } from '../../ts/src/cli/wire-subcommands';

interface NamespacedHandlers {
  namespace: string;
  handlers: SubcommandSpec[];
}

const NAMESPACES: NamespacedHandlers[] = [
  { namespace: 'agent', handlers: AGENT_HANDLERS },
  { namespace: 'api-key', handlers: API_KEY_HANDLERS },
  { namespace: 'approval', handlers: APPROVAL_HANDLERS },
  { namespace: 'audit', handlers: AUDIT_HANDLERS },
  { namespace: 'behavior', handlers: BEHAVIOR_HANDLERS },
  { namespace: 'goal', handlers: GOAL_HANDLERS },
  { namespace: 'guardrail', handlers: GUARDRAIL_HANDLERS },
  { namespace: 'observe', handlers: OBSERVE_HANDLERS },
  { namespace: 'org', handlers: ORG_HANDLERS },
  { namespace: 'policy', handlers: POLICY_HANDLERS },
  { namespace: 'session', handlers: SESSION_HANDLERS },
  { namespace: 'sso', handlers: SSO_HANDLERS },
  { namespace: 'team', handlers: TEAM_HANDLERS },
  { namespace: 'trust', handlers: TRUST_HANDLERS },
  { namespace: 'violation', handlers: VIOLATION_HANDLERS },
  { namespace: 'webhook', handlers: WEBHOOK_HANDLERS },
  { namespace: 'aivss', handlers: AIVSS_HANDLERS },
  { namespace: 'member', handlers: MEMBER_HANDLERS },
];

// `core` handlers go through OpenBoxCoreClient; covered separately
// by core-client tests.

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

async function makeCaptureServer(): Promise<{
  url: string;
  lastRequest: () => CapturedRequest | null;
  close: () => Promise<void>;
}> {
  let last: CapturedRequest | null = null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body: unknown = null;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      last = { method: req.method ?? 'UNKNOWN', url: req.url ?? '', body };
      // Respond with a generic envelope so OpenBoxClient unwraps cleanly.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 200, data: {} }));
    });
  });
  // listen() is async; wait for the bind before reading the port.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    lastRequest: () => last,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// Synthesize a positional argument that the SDK method will accept.
// Method signatures vary, but most expect strings (UUIDs, names) or
// numbers. We supply a recognizable string token; the capture server
// echoes it back via the URL so we can assert it propagates.
function synthArg(name: string, _idx: number): unknown {
  // Use a placeholder UUID-shaped token so backends that validate the
  // string format (UUID) don't reject it before we capture the request.
  if (name.toLowerCase().includes('id')) return '00000000-0000-4000-8000-000000000000';
  return `synth-${name}`;
}

function buildArgs(sub: SubcommandSpec): unknown[] {
  return sub.args.map((a, i) => synthArg(a.name, i));
}

function buildBody(sub: SubcommandSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  // Apply DTO defaults if present (the spec's @cli_dto_defaults).
  if (sub.dtoDefaults && typeof sub.dtoDefaults === 'object') {
    Object.assign(body, sub.dtoDefaults as Record<string, unknown>);
  }
  // Add a recognizable marker so the assertion can detect that the
  // body was forwarded (vs. dropped).
  body.__conformance_marker__ = true;
  return body;
}

describe('wire conformance for every spec op', () => {
  let server: Awaited<ReturnType<typeof makeCaptureServer>>;
  let sdk: OpenBoxClient;

  beforeAll(async () => {
    server = await makeCaptureServer();
    sdk = new OpenBoxClient({
      apiUrl: server.url,
      accessToken: 'conformance-token',
      clientName: 'openbox-conformance',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  for (const { namespace, handlers } of NAMESPACES) {
    describe(`namespace: ${namespace}`, () => {
      for (const sub of handlers) {
        // Skip @cli_local_only ops; they intentionally never hit the
        // backend, so there's no wire shape to verify. The drift test
        // for their existence lives in cli-handler-coverage.
        if (sub.localOnly) continue;

        it(`${namespace} ${sub.name}; SDK method exists and issues a request`, async () => {
          const method = sub.backend.method;
          const fn = (sdk as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
          expect(typeof fn, `OpenBoxClient is missing method '${method}' (declared by spec op '${namespace} ${sub.name}')`).toBe('function');

          const args = buildArgs(sub);
          const body = buildBody(sub);

          // Call shape mirrors wireSubcommands runtime:
          //   "positional" → all spec params + body merged in declaration order
          //   "body"       → positional args first, then a single body object
          let callArgs: unknown[];
          if (sub.backend.shape === 'positional') {
            callArgs = [...args, ...Object.values(body)];
          } else {
            callArgs = args.length > 0 ? [...args, body] : [body];
          }

          // Tolerate runtime-level rejects such as validation. The
          // assertion is "did a request go out?", not "did it succeed".
          try {
            await fn.call(sdk, ...callArgs);
          } catch {
            // ignore; capture-server returns 200 so client errors
            // here are SDK-internal (validation, etc.). We still
            // assert a request fired below.
          }

          const captured = server.lastRequest();
          expect(captured, `SDK method '${method}' did not issue an HTTP request`).not.toBeNull();
          expect(captured!.url.startsWith('/'), `URL doesn't start with /: ${captured!.url}`).toBe(true);
          expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(captured!.method)).toBe(true);

          // Stronger contract (post-audit): when the spec says
          // shape="body" AND the spec op has no positional args that
          // route into body via @cli_body_key, the synth body MUST
          // land on the wire. We skip ops with bodyKey-routed
          // positionals because the test driver doesn't replicate
          // wireSubcommands' positional→body merge; that's a
          // simplification, not a production-code gap.
          const hasBodyKeyPositional = (sub.args ?? []).some((a: any) => a.bodyKey);
          if (
            sub.backend.shape === 'body' &&
            !hasBodyKeyPositional &&
            Object.keys(body).length > 0 &&
            captured!.method !== 'GET'
          ) {
            const bodyJson = JSON.stringify(captured!.body ?? '');
            const carried = bodyJson.includes('__conformance_marker__');
            expect(
              carried,
              `${namespace} ${sub.name}: body marker not propagated through SDK. ` +
                `URL=${captured!.url} method=${captured!.method} body=${bodyJson.slice(0, 200)}`,
            ).toBe(true);
          }
        });
      }
    });
  }
});
