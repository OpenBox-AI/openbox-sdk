// WebdriverIO + wdio-vscode-service config for the OpenBox extension.
//
// Run: `npm run test:e2e-extension`
//
// LIVE end-to-end suite; the extension activates inside a real
// VS Code / Cursor workbench and talks through the real SDK to the
// real backend. UI/glue layer logic (status bar paint shapes,
// MockStore fixtures, view contributions, fail-mode folding,
// approval-row resolution) is covered by unit tests under
// `apps/extension/src/*.test.ts`. This suite covers what those can't:
// extension activation, view registration, real polling round-trips,
// real governance.check verdicts, real save → revert flows.
//
// Zero URL vars required for a default localhost run. URLs and
// credentials auto-load the same way the SDK e2e suite does. Any
// injected env values win, so `infisical run --projectId ... --env=dev`
// can point this harness at a dev deployment without committing
// endpoint profiles or secrets:
//
//   OPENBOX_API_URL          ← override OR http://localhost:3000
//   OPENBOX_CORE_URL         ← override OR http://localhost:8086
//   OPENBOX_BACKEND_API_KEY  ← override OR API_KEY from ~/.openbox/tokens
//   OPENBOX_API_KEY          ← override OR OPENBOX_E2E_RUNTIME_KEY
//   OPENBOX_E2E_AGENT_ID     ← override OR e2e-agent cache OR bootstrap
//   OPENBOX_E2E_RUNTIME_KEY  ← override OR e2e-agent cache OR bootstrap
//
// Knobs:
//   OPENBOX_E2E_VSCODE_VERSION; VS Code version (default: stable)
//   OPENBOX_E2E_VSCODE_BINARY ; path to a VS Code-fork binary
//                                 (e.g. Cursor) to use instead of the
//                                 downloaded one. Versions must stay
//                                 close; chromedriver is bundled to
//                                 the VS Code version we downloaded.
//   OPENBOX_E2E_HEADLESS=1    ; pass `--no-sandbox` for Linux + Xvfb
//                                 environments. macOS shows the
//                                 workbench window; the in-test
//                                 before-hook minimizes it after launch.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ensureLiveVerdictMatrix } from './live-bootstrap.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const EXTENSION_DIR = resolve(ROOT, 'apps/extension');
const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_CORE_URL = 'http://localhost:8086';
const RUNTIME_KEY_PREFIX = /^obx_(?:test|live)_/;
const BACKEND_KEY_PREFIX = /^obx_key_/;

function isLocalUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

// ─── credential auto-load ────────────────────────────────────────────
//
// Pull the e2e-agent's runtime key from ~/.openbox/agent-keys (the
// canonical store openbox-local's bootstrap writes to). Same pattern
// as tests/setup-creds.ts; lets `npm run test:e2e-extension` Just Work
// after `cd ~/workspace/openbox-local && npm run bootstrap`.

const E2E_AGENT_NAME = 'e2e-agent';
const explicitApiUrl = process.env.OPENBOX_API_URL;
const explicitCoreUrl = process.env.OPENBOX_CORE_URL;

process.env.OPENBOX_API_URL = process.env.OPENBOX_API_URL ?? DEFAULT_API_URL;
process.env.OPENBOX_CORE_URL = process.env.OPENBOX_CORE_URL ?? DEFAULT_CORE_URL;

const usingLocalTarget = isLocalUrl(process.env.OPENBOX_API_URL) && isLocalUrl(process.env.OPENBOX_CORE_URL);
const allowLocalCredentialFallback =
  usingLocalTarget ||
  process.env.OPENBOX_ALLOW_LOCAL_TOKEN_FALLBACK === '1' ||
  (!explicitApiUrl && !explicitCoreUrl);

if (allowLocalCredentialFallback && (!process.env.OPENBOX_E2E_AGENT_ID || !process.env.OPENBOX_E2E_RUNTIME_KEY)) {
  const keysFile = resolve(homedir(), '.openbox', 'agent-keys');
  if (existsSync(keysFile)) {
    try {
      const cache = JSON.parse(readFileSync(keysFile, 'utf-8')) as Record<
        string,
        { agentId: string; agentName: string; runtimeKey: string }
      >;
      const entry = Object.values(cache).find((r) => r.agentName === E2E_AGENT_NAME);
      if (entry) {
        if (!process.env.OPENBOX_E2E_AGENT_ID) process.env.OPENBOX_E2E_AGENT_ID = entry.agentId;
        if (!process.env.OPENBOX_E2E_RUNTIME_KEY) process.env.OPENBOX_E2E_RUNTIME_KEY = entry.runtimeKey;
      }
    } catch {
      /* best-effort; the explicit-error path below catches missing creds */
    }
  }
}

if (!process.env.OPENBOX_E2E_RUNTIME_KEY && RUNTIME_KEY_PREFIX.test(process.env.OPENBOX_API_KEY ?? '')) {
  process.env.OPENBOX_E2E_RUNTIME_KEY = process.env.OPENBOX_API_KEY;
}

process.env.OPENBOX_API_KEY = process.env.OPENBOX_API_KEY ?? process.env.OPENBOX_E2E_RUNTIME_KEY;
process.env.OPENBOX_E2E_EXPECT_ORG_ID = process.env.OPENBOX_E2E_EXPECT_ORG_ID ?? process.env.OPENBOX_ORG_ID;

if (allowLocalCredentialFallback && !process.env.OPENBOX_BACKEND_API_KEY) {
  for (const tokenFile of [
    resolve(ROOT, '.tokens'),
    resolve(homedir(), '.openbox', 'tokens'),
  ]) {
    if (!existsSync(tokenFile)) continue;
    const lines = readFileSync(tokenFile, 'utf-8').split('\n');
    const token =
      lines
        .map((line) => line.match(/^API_KEY=(.+)$/)?.[1])
        .find((value): value is string => !!value && BACKEND_KEY_PREFIX.test(value));
    if (token) {
      process.env.OPENBOX_BACKEND_API_KEY = token;
      break;
    }
  }
}

interface BackendEnvelope<T = any> {
  status?: number;
  data?: T;
  message?: string;
}

interface AgentRecord {
  id?: string;
  agent_name?: string;
  organization_id?: string;
}

async function backend<T = any>(path: string, init: RequestInit = {}): Promise<BackendEnvelope<T>> {
  const key = process.env.OPENBOX_BACKEND_API_KEY;
  if (!key || !BACKEND_KEY_PREFIX.test(key)) {
    throw new Error('OPENBOX_BACKEND_API_KEY is required to bootstrap extension e2e credentials');
  }
  const res = await fetch(`${process.env.OPENBOX_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as BackendEnvelope<T>;
  if (!res.ok) {
    throw new Error(`backend ${init.method ?? 'GET'} ${path} failed with ${res.status}: ${body.message ?? 'no message'}`);
  }
  return body;
}

async function resolveOrgId(): Promise<string | undefined> {
  if (process.env.OPENBOX_ORG_ID) return process.env.OPENBOX_ORG_ID;
  if (!process.env.OPENBOX_BACKEND_API_KEY) return undefined;
  const profile = await backend<{ orgId?: string }>('/auth/profile');
  const orgId = profile?.data?.orgId;
  if (orgId) process.env.OPENBOX_ORG_ID = orgId;
  return orgId;
}

async function resolveAgentFromRuntimeKey(): Promise<void> {
  const key = process.env.OPENBOX_E2E_RUNTIME_KEY ?? process.env.OPENBOX_API_KEY;
  if (process.env.OPENBOX_E2E_AGENT_ID || !key || !RUNTIME_KEY_PREFIX.test(key)) return;
  const res = await fetch(`${process.env.OPENBOX_CORE_URL}/api/v1/auth/validate`, {
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => undefined);
  if (!res?.ok) return;
  const body = (await res.json().catch(() => ({}))) as { agent_id?: string };
  if (body.agent_id) process.env.OPENBOX_E2E_AGENT_ID = body.agent_id;
}

async function validateRuntimeKey(): Promise<boolean> {
  const key = process.env.OPENBOX_E2E_RUNTIME_KEY ?? process.env.OPENBOX_API_KEY;
  if (!key || !RUNTIME_KEY_PREFIX.test(key)) return false;
  const res = await fetch(`${process.env.OPENBOX_CORE_URL}/api/v1/auth/validate`, {
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => undefined);
  if (!res?.ok) return false;
  const body = (await res.json().catch(() => ({}))) as { agent_id?: string; agentId?: string };
  const resolvedAgentId = body.agent_id ?? body.agentId;
  if (process.env.OPENBOX_E2E_AGENT_ID && resolvedAgentId && process.env.OPENBOX_E2E_AGENT_ID !== resolvedAgentId) {
    return false;
  }
  if (resolvedAgentId) process.env.OPENBOX_E2E_AGENT_ID = resolvedAgentId;
  return true;
}

function clearInvalidRuntimeKey(): void {
  const key = process.env.OPENBOX_E2E_RUNTIME_KEY;
  delete process.env.OPENBOX_E2E_AGENT_ID;
  delete process.env.OPENBOX_E2E_RUNTIME_KEY;
  if (key && process.env.OPENBOX_API_KEY === key) delete process.env.OPENBOX_API_KEY;
}

async function listTeamIds(orgId: string): Promise<string[]> {
  const teams = await backend<{ data?: Array<{ id?: string }> }>(`/organization/${orgId}/teams`);
  const rows = Array.isArray((teams.data as any)?.data) ? (teams.data as any).data : [];
  return rows.map((team: { id?: string }) => team.id).filter((id: string | undefined): id is string => !!id);
}

async function createDisposableAgent(): Promise<void> {
  const orgId = await resolveOrgId();
  if (!orgId) throw new Error('OPENBOX_ORG_ID could not be resolved for extension e2e bootstrap');
  const teamIds = await listTeamIds(orgId);
  const body = {
    agent_name: `e2e-extension-${Date.now().toString(36)}`,
    description: 'Disposable extension live e2e agent',
    icon: 'robot',
    agent_type: 'temporal',
    team_ids: teamIds,
    tags: ['e2e-test', 'extension-e2e'],
    attestation_mode: 'kms',
    aivss_config: {
      base_security: {
        attack_vector: 2,
        attack_complexity: 1,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1,
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 2,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3,
      },
      impact: {
        confidentiality_impact: 2,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1,
      },
    },
    goal_alignment_config: {
      alignment_threshold: 70,
      drift_detection_action: 'alert_only',
      evaluation_frequency: 'every_action',
      llama_firewall_model: 'gpt-4o-mini',
    },
  };
  const created = await backend<{ agent?: AgentRecord; token?: string }>('/agent/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const agentId = created.data?.agent?.id;
  const runtimeKey = created.data?.token;
  if (!agentId || !runtimeKey || !RUNTIME_KEY_PREFIX.test(runtimeKey)) {
    throw new Error('backend agent create did not return an agent id and runtime key');
  }
  process.env.OPENBOX_E2E_AGENT_ID = agentId;
  process.env.OPENBOX_E2E_RUNTIME_KEY = runtimeKey;
  process.env.OPENBOX_API_KEY = runtimeKey;
  process.env.OPENBOX_E2E_CREATED_AGENT_ID = agentId;
}

await resolveAgentFromRuntimeKey();

if (process.env.OPENBOX_E2E_RUNTIME_KEY && !(await validateRuntimeKey())) {
  clearInvalidRuntimeKey();
}

if (!process.env.OPENBOX_E2E_AGENT_ID || !process.env.OPENBOX_E2E_RUNTIME_KEY) {
  await resolveOrgId();
  await createDisposableAgent();
} else {
  await resolveOrgId().catch(() => undefined);
}

if (!process.env.OPENBOX_E2E_AGENT_ID || !process.env.OPENBOX_E2E_RUNTIME_KEY) {
  console.error(
    'No e2e agent credentials. Inject OPENBOX_E2E_AGENT_ID + OPENBOX_E2E_RUNTIME_KEY ' +
      'or provide OPENBOX_BACKEND_API_KEY so the harness can create a disposable agent.',
  );
  process.exit(1);
}

await ensureLiveVerdictMatrix();

const vscodeVersion = process.env.OPENBOX_E2E_VSCODE_VERSION ?? 'stable';
const vscodeBinary = process.env.OPENBOX_E2E_VSCODE_BINARY;
const headless = process.env.OPENBOX_E2E_HEADLESS === '1';

const userSettings: Record<string, unknown> = {
  'openbox.mockAuth': false,
  'openbox.agentId': process.env.OPENBOX_E2E_AGENT_ID!,
  'openbox.preWriteGate.active': true,
  'openbox.tabObserver.enabled': true,
  'openbox.tabObserver.active': true,
  'openbox.fileOpGate.enabled': true,
  'openbox.failClosed': false,
};

export const config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },

  // One consolidated spec file = one workbench launch = one window
  // flash on macOS. Splitting across N files multiplies the launch
  // count by N. The single spec file groups concerns via describe()
  // blocks for navigability.
  specs: ['./suites/live-e2e.e2e.ts'],
  maxInstances: 1,
  // Retry the spec file once on flaky launch failures (chromedriver
  // racing the workbench during cold boot occasionally counts a spec
  // as failed before any test runs).
  specFileRetries: 1,
  specFileRetriesDelay: 2,

  capabilities: [
    {
      browserName: 'vscode',
      browserVersion: vscodeVersion,
      'wdio:vscodeOptions': {
        extensionPath: EXTENSION_DIR,
        userSettings,
        workspacePath: resolve(HERE, 'fixtures-workspace'),
        ...(vscodeBinary ? { binary: vscodeBinary } : {}),
        ...(headless ? { vscodeArgs: ['--no-sandbox'] } : {}),
      },
    },
  ],

  services: ['vscode'],
  outputDir: resolve(ROOT, 'tests/e2e-extension/.wdio-cache/logs'),
  logLevel: 'info',
} as const;
