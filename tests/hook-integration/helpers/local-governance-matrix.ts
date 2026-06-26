import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OpenBoxClient } from '../../../ts/src/client/index.js';
import { checkGovernance } from '../../../ts/src/governance/check.js';
import {
  makeCreateAgentDto,
  makeCreateBehaviorRuleDto,
} from '../../../ts/src/test-utils/fixtures.js';
import { parseTokenStore } from '../../../ts/src/env/index.js';
import type { AgentIdentityConfig } from '../../../ts/src/core-client/index.js';
import { recordAgentKey } from '../../../ts/src/file-tokens/agent-keys.js';
import {
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  type Verdict,
  type VerdictMatrixCase,
  shouldSeedRule,
} from '../fixtures/verdict-matrix.js';

const DEFAULT_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_CORE_URL = 'http://127.0.0.1:8086';
const UNIT_API_URL = 'http://localhost:18080';
const UNIT_CORE_URL = 'http://localhost:18081';
const E2E_AGENT_NAME = 'e2e-agent';
const SHARED_AGENT_ENV = 'OPENBOX_E2E_SHARED_AGENT';
const RUNTIME_KEY_PREFIX = /^obx_(?:test|live)_/;
const BACKEND_KEY_PREFIX = /^obx_key_/;
const PROJECT_OPENBOX = path.resolve(process.cwd(), '.openbox');
const MATRIX_VERIFY_MAX_ATTEMPTS = 12;
const MATRIX_VERIFY_RETRY_MS = 5_000;
const fallbackRunId = `pid-${process.pid}-${Date.now().toString(36)}`;

interface LocalGovernanceRuntime {
  apiUrl: string;
  coreUrl: string;
  backendKey: string;
  agentId: string;
  runtimeKey: string;
  agentIdentity?: AgentIdentityConfig;
  signingRequired?: boolean;
}

interface AgentKeyRecord {
  agentId: string;
  agentName?: string;
  runtimeKey?: string;
}

interface AgentRecord {
  id?: string;
  agent_id?: string;
  agent_name?: string;
  name?: string;
  team_ids?: string[];
  teams?: Array<{ id?: string }>;
}

interface TeamRecord {
  id?: string;
  name?: string;
}

interface BehaviorRuleRecord {
  id?: string;
  rule_name?: string;
  trigger?: string;
  states?: unknown;
  verdict?: number | string;
  is_active?: boolean;
}

const VERDICT_TO_INT: Record<Verdict, 0 | 1 | 2 | 3 | 4> = {
  allow: 0,
  constrain: 1,
  require_approval: 2,
  block: 3,
  halt: 4,
};

const INT_TO_VERDICT: Record<string, Verdict> = {
  '0': 'allow',
  '1': 'constrain',
  '2': 'require_approval',
  '3': 'block',
  '4': 'halt',
};

function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env[name] ?? '').trim().toLowerCase());
}

function sharedAgentMode(): boolean {
  return envFlag(SHARED_AGENT_ENV);
}

function normalizeRunIdPart(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized ? normalized.slice(0, 96) : undefined;
}

function localRunId(): string {
  return normalizeRunIdPart(process.env.OPENBOX_E2E_RUN_ID) ?? fallbackRunId;
}

function localAgentName(): string {
  if (sharedAgentMode()) return E2E_AGENT_NAME;
  return `${E2E_AGENT_NAME}-${localRunId()}`.slice(0, 120);
}

function configuredUrl(kind: 'api' | 'core'): string {
  const value = kind === 'api' ? process.env.OPENBOX_API_URL : process.env.OPENBOX_CORE_URL;
  const unit = kind === 'api' ? UNIT_API_URL : UNIT_CORE_URL;
  const fallback = kind === 'api' ? DEFAULT_API_URL : DEFAULT_CORE_URL;
  return value && value !== unit ? value : fallback;
}

function readAgentRecords(): AgentKeyRecord[] {
  if (!sharedAgentMode()) return [];
  const keysFile = path.join(PROJECT_OPENBOX, 'agent-keys');
  if (!existsSync(keysFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(keysFile, 'utf-8')) as Record<string, AgentKeyRecord>;
    return Object.values(parsed);
  } catch {
    return [];
  }
}

function resolveBackendApiKey(): string | undefined {
  const envKey = process.env.OPENBOX_BACKEND_API_KEY;
  if (envKey && BACKEND_KEY_PREFIX.test(envKey)) return envKey;

  for (const tokenFile of [
    path.resolve(process.cwd(), '.tokens'),
    path.join(PROJECT_OPENBOX, 'tokens'),
  ]) {
    if (!existsSync(tokenFile)) continue;
    const store = parseTokenStore(readFileSync(tokenFile, 'utf-8'));
    if (store.apiKey && BACKEND_KEY_PREFIX.test(store.apiKey)) return store.apiKey;
  }
  return undefined;
}

function resolveRuntimeKey(record: AgentKeyRecord | undefined): string | undefined {
  return record?.runtimeKey && RUNTIME_KEY_PREFIX.test(record.runtimeKey)
    ? record.runtimeKey
    : undefined;
}

function rowsFromListResponse<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return data as T[];
  const nested = data && typeof data === 'object'
    ? (data as { data?: unknown }).data
    : undefined;
  return Array.isArray(nested) ? nested as T[] : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unwrapData(value: unknown): unknown {
  const record = objectRecord(value);
  return 'data' in record ? record.data : value;
}

function profileOrgId(profile: unknown): string | undefined {
  const body = objectRecord(unwrapData(profile));
  const nested = objectRecord(body.data);
  const orgId = body.orgId ?? body.org_id ?? nested.orgId ?? nested.org_id;
  return typeof orgId === 'string' && orgId.trim() ? orgId.trim() : undefined;
}

function agentId(record: AgentRecord | undefined): string | undefined {
  return record?.id ?? record?.agent_id;
}

function agentName(record: AgentRecord | undefined): string | undefined {
  return record?.agent_name ?? record?.name;
}

function agentTeamIds(record: AgentRecord | undefined): string[] {
  if (!record) return [];
  if (Array.isArray(record.team_ids)) return record.team_ids.filter(Boolean);
  if (Array.isArray(record.teams)) {
    return record.teams.map((team) => team.id).filter((id): id is string => Boolean(id));
  }
  return [];
}

function runtimeKeyFromCreateResponse(response: unknown): string | undefined {
  const body = objectRecord(unwrapData(response));
  const nested = objectRecord(body.data);
  for (const candidate of [
    body.token,
    body.runtimeKey,
    body.runtime_key,
    body.apiKey,
    body.api_key,
    nested.token,
    nested.runtimeKey,
    nested.runtime_key,
    nested.apiKey,
    nested.api_key,
  ]) {
    if (typeof candidate === 'string' && RUNTIME_KEY_PREFIX.test(candidate)) return candidate;
  }
  return undefined;
}

function identityFromCreateResponse(response: unknown): AgentIdentityConfig | undefined {
  const body = objectRecord(unwrapData(response));
  const nested = objectRecord(body.data);
  const identity = objectRecord(body.identity);
  const nestedIdentity = objectRecord(nested.identity);
  for (const candidate of [identity, nestedIdentity]) {
    if (typeof candidate.did === 'string' && typeof candidate.privateKey === 'string') {
      return { did: candidate.did, privateKey: candidate.privateKey };
    }
  }
  return undefined;
}

function agentFromCreateResponse(response: unknown): AgentRecord | undefined {
  const body = objectRecord(unwrapData(response));
  const nested = objectRecord(body.data);
  const agent = objectRecord(body.agent);
  const nestedAgent = objectRecord(nested.agent);
  for (const candidate of [agent, nestedAgent, body, nested]) {
    if (typeof candidate.id === 'string' || typeof candidate.agent_id === 'string') {
      return candidate as unknown as AgentRecord;
    }
  }
  return undefined;
}

function normalizeVerdict(value: unknown): Verdict | undefined {
  if (typeof value === 'number') return INT_TO_VERDICT[String(value)];
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'continue') return 'allow';
  return (
    normalized === 'allow' ||
    normalized === 'constrain' ||
    normalized === 'require_approval' ||
    normalized === 'block' ||
    normalized === 'halt'
  )
    ? normalized
    : INT_TO_VERDICT[normalized];
}

function resultUsesAgeFallback(result: unknown): boolean {
  const body = objectRecord(result);
  const metadata = objectRecord(body.metadata);
  const ageResult = objectRecord(body.age_result);
  return body.fallback_used === true
    || ageResult.fallback_used === true
    || metadata.age_fallback_used === true;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function ruleBody(c: VerdictMatrixCase, index: number) {
  const trigger = c.expectedTrigger;
  const verdict = VERDICT_TO_INT[c.expectedVerdict];
  return makeCreateBehaviorRuleDto({
    rule_name: c.expectedRule,
    description: `OpenBox SDK local governance matrix: ${c.name}`,
    priority: Math.max(1, 100 - index),
    trigger,
    states: [trigger],
    time_window: 300,
    verdict,
    reject_message: c.expectedRule,
    approval_timeout: verdict === 2 ? 30 : undefined,
    trust_impact: 'none',
  });
}

function ruleMatches(rule: BehaviorRuleRecord, body: ReturnType<typeof ruleBody>): boolean {
  const states = Array.isArray(rule.states) ? rule.states.map(String) : [];
  return rule.rule_name === body.rule_name
    && rule.trigger === body.trigger
    && Number(rule.verdict) === Number(body.verdict)
    && states.includes(String(body.trigger))
    && rule.is_active !== false;
}

async function upsertMatrixRules(client: OpenBoxClient, agentId: string): Promise<void> {
  const list = await client.listBehaviorRules(agentId, { page: 0, perPage: 200 });
  const rows = rowsFromListResponse<BehaviorRuleRecord>(list);

  for (const [index, c] of LOCAL_GOVERNANCE_VERDICT_MATRIX.entries()) {
    if (!shouldSeedRule(c)) continue;
    const body = ruleBody(c, index);
    const existing = rows.find((rule) => rule.rule_name === c.expectedRule);
    if (!existing) {
      await client.createBehaviorRule(agentId, body as never);
      continue;
    }
    if (!existing.id || ruleMatches(existing, body)) continue;

    await client.updateBehaviorRule(agentId, existing.id, {
      ...body,
      change_log: 'Sync OpenBox SDK local governance matrix',
    } as never);
    if (existing.is_active === false) {
      await client.toggleBehaviorRuleStatus(agentId, existing.id, { is_active: true } as never);
    }
  }
}

async function currentAgents(client: OpenBoxClient): Promise<AgentRecord[]> {
  const list = await client.listAgents({ page: 0, perPage: 200 });
  return rowsFromListResponse<AgentRecord>(list);
}

async function ensureTeamIds(
  client: OpenBoxClient,
  orgId: string,
  agents: AgentRecord[],
): Promise<string[]> {
  const fromAgents = agents.flatMap(agentTeamIds);
  if (fromAgents.length > 0) return Array.from(new Set(fromAgents));

  const listed = await client.listTeams(orgId, { page: 0, perPage: 100 });
  const teamIds = rowsFromListResponse<TeamRecord>(listed)
    .map((team) => team.id)
    .filter((id): id is string => Boolean(id));
  if (teamIds.length > 0) return teamIds;

  const created = await client.createTeam(orgId, {
    name: 'Local E2E',
    description: 'Local SDK governance matrix tests',
    icon: 'robot',
  } as never);
  const createdBody = objectRecord(unwrapData(created));
  const createdNested = objectRecord(createdBody.data);
  const teamId = createdBody.id ?? createdNested.id;
  if (typeof teamId === 'string' && teamId.trim()) return [teamId];
  throw new Error('Could not resolve or create a team for local governance matrix');
}

async function ensureUnsignedLocalAgent(
  client: OpenBoxClient,
  agent: AgentRecord,
  fallbackTeamIds: string[],
  fallbackName: string,
): Promise<void> {
  const id = agentId(agent);
  if (!id) return;
  const teamIds = agentTeamIds(agent);
  await client.updateAgent(id, {
    agent_name: agentName(agent) ?? fallbackName,
    team_ids: teamIds.length > 0 ? teamIds : fallbackTeamIds,
    signing_required: false,
  } as never);
}

async function createLocalAgent(
  client: OpenBoxClient,
  orgId: string,
  agents: AgentRecord[],
  options: { signingRequired?: boolean; nameSuffix?: string } = {},
): Promise<{ agentId: string; runtimeKey: string; agentName?: string; agentIdentity?: AgentIdentityConfig }> {
  const teamIds = await ensureTeamIds(client, orgId, agents);
  const baseName = options.nameSuffix ? `${localAgentName()}-${options.nameSuffix}`.slice(0, 120) : localAgentName();
  const name = agents.some((agent) => agentName(agent) === baseName)
    ? `${baseName}-${Date.now().toString(36)}`.slice(0, 120)
    : baseName;
  const created = await client.createAgent(makeCreateAgentDto(teamIds, {
    agent_name: name,
    description: 'Local SDK governance matrix agent',
    agent_type: 'claude-code',
    tags: ['e2e-test', 'local-governance-matrix'],
    signing_required: options.signingRequired === true,
  }) as never);
  const createdAgent = agentFromCreateResponse(created);
  const createdAgentId = agentId(createdAgent);
  const runtimeKey = runtimeKeyFromCreateResponse(created);
  const agentIdentity = identityFromCreateResponse(created);
  if (!createdAgentId || !runtimeKey) {
    throw new Error(
      `Backend createAgent did not return a usable agent id and runtime key: ${JSON.stringify(created).slice(0, 500)}`,
    );
  }
  if (options.signingRequired === true) {
    await client.updateAgent(createdAgentId, {
      agent_name: name,
      team_ids: teamIds,
      signing_required: true,
    } as never);
  } else {
    await ensureUnsignedLocalAgent(client, { ...createdAgent, team_ids: teamIds, agent_name: name }, teamIds, name);
  }
  if (sharedAgentMode()) recordAgentKey(createdAgentId, runtimeKey, name);
  return { agentId: createdAgentId, runtimeKey, agentName: name, agentIdentity };
}

async function resolveOrCreateAgent(
  client: OpenBoxClient,
  apiUrl: string,
  coreUrl: string,
  backendKey: string,
): Promise<LocalGovernanceRuntime> {
  const profile = await client.getProfile();
  const orgId = profileOrgId(profile);
  if (!orgId) throw new Error('Could not resolve local organization id from /auth/profile');

  const agents = await currentAgents(client);
  const records = readAgentRecords();
  const envAgentId = process.env.OPENBOX_AGENT_ID;
  const envRuntimeKey = process.env.OPENBOX_API_KEY;
  const targetAgentName = localAgentName();
  const candidates = records.filter((record) => (
    (envAgentId && record.agentId === envAgentId) ||
    record.agentName === targetAgentName ||
    Boolean(record.agentId && record.runtimeKey)
  ));
  if (sharedAgentMode() && envAgentId && envRuntimeKey && RUNTIME_KEY_PREFIX.test(envRuntimeKey)) {
    candidates.unshift({ agentId: envAgentId, runtimeKey: envRuntimeKey });
  }

  for (const candidate of candidates) {
    const existingAgent = agents.find((agent) => agentId(agent) === candidate.agentId);
    const runtimeKey = resolveRuntimeKey(candidate);
    if (existingAgent && runtimeKey) {
      await ensureUnsignedLocalAgent(
        client,
        existingAgent,
        await ensureTeamIds(client, orgId, agents),
        targetAgentName,
      );
      return { apiUrl, coreUrl, backendKey, agentId: candidate.agentId, runtimeKey };
    }
  }

  const created = await createLocalAgent(client, orgId, agents);
  return {
    apiUrl,
    coreUrl,
    backendKey,
    agentId: created.agentId,
    runtimeKey: created.runtimeKey,
  };
}

async function verifyMatrix(agentId: string, runtimeKey: string, coreUrl: string): Promise<void> {
  for (const c of LOCAL_GOVERNANCE_VERDICT_MATRIX) {
    let result: Awaited<ReturnType<typeof checkGovernance>> | undefined;
    for (let attempt = 1; attempt <= MATRIX_VERIFY_MAX_ATTEMPTS; attempt += 1) {
      result = await checkGovernance({
        agentId,
        apiKey: runtimeKey,
        coreUrl,
        spanType: c.spanType,
        activityInput: c.activityInput,
      });
      if (!resultUsesAgeFallback(result)) break;
      if (attempt < MATRIX_VERIFY_MAX_ATTEMPTS) await sleep(MATRIX_VERIFY_RETRY_MS);
    }
    if (!result) throw new Error(`local governance matrix did not return a result for ${c.expectedRule}`);
    if (resultUsesAgeFallback(result)) {
      throw new Error(
        `local governance matrix still used AGE fallback for ${c.expectedRule}: ${JSON.stringify(result).slice(0, 500)}`,
      );
    }
    const verdict = normalizeVerdict(result.verdict ?? result.action);
    if (verdict !== c.expectedVerdict) {
      throw new Error(
        `local governance matrix mismatch for ${c.expectedRule}: expected ${c.expectedVerdict}, got ${JSON.stringify(result).slice(0, 500)}`,
      );
    }
    const reason = typeof result.reason === 'string' ? result.reason : '';
    if (shouldSeedRule(c) && reason && !reason.includes(c.expectedRule)) {
      throw new Error(
        `local governance matrix reason mismatch for ${c.expectedRule}: ${reason}`,
      );
    }
  }
}

const inflight = new Map<string, Promise<LocalGovernanceRuntime>>();
const signedInflight = new Map<string, Promise<LocalGovernanceRuntime>>();
const configuredCache = new Map<string, boolean>();

function matrixCacheKey(apiUrl: string, coreUrl: string, backendKey: string | undefined): string {
  return [
    apiUrl,
    coreUrl,
    backendKey ?? 'no-backend-key',
    sharedAgentMode() ? 'shared-agent' : `isolated-${localRunId()}`,
  ].join('\n');
}

function localHttpOk(url: string): boolean {
  const probe = [
    'const url = process.env.OPENBOX_LOCAL_MATRIX_PROBE_URL;',
    'if (!url) process.exit(1);',
    'fetch(url, { signal: AbortSignal.timeout(750) })',
    '  .then((response) => process.exit(response.ok ? 0 : 1))',
    '  .catch(() => process.exit(1));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', probe], {
    env: { ...process.env, OPENBOX_LOCAL_MATRIX_PROBE_URL: url },
    stdio: 'ignore',
    timeout: 1_500,
  });
  return result.status === 0;
}

export function localGovernanceMatrixConfigured(): boolean {
  const apiUrl = configuredUrl('api');
  const coreUrl = configuredUrl('core');
  const backendKey = resolveBackendApiKey();
  const cacheKey = matrixCacheKey(apiUrl, coreUrl, backendKey);
  const cached = configuredCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const configured = isLoopbackUrl(apiUrl)
    && isLoopbackUrl(coreUrl)
    && Boolean(backendKey)
    && localHttpOk(`${apiUrl}/health`)
    && localHttpOk(coreUrl);
  configuredCache.set(cacheKey, configured);
  return configured;
}

export async function ensureLocalGovernanceMatrix(): Promise<LocalGovernanceRuntime> {
  const apiUrl = configuredUrl('api');
  const coreUrl = configuredUrl('core');
  const backendKey = resolveBackendApiKey();
  const cacheKey = matrixCacheKey(apiUrl, coreUrl, backendKey);
  const cached = inflight.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (!isLoopbackUrl(apiUrl) || !isLoopbackUrl(coreUrl)) {
      throw new Error(`local governance matrix requires loopback API/Core URLs, got ${apiUrl} / ${coreUrl}`);
    }

    if (!backendKey) throw new Error('No backend X-API-Key found for local governance matrix');

    const client = new OpenBoxClient({
      apiUrl,
      apiKey: backendKey,
      clientName: 'openbox-hook-integration',
      retry: { maxRetries: 0 },
    });

    const runtime = await resolveOrCreateAgent(client, apiUrl, coreUrl, backendKey);
    await upsertMatrixRules(client, runtime.agentId);
    await verifyMatrix(runtime.agentId, runtime.runtimeKey, coreUrl);
    return runtime;
  })();
  inflight.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
    throw error;
  }
}

export async function ensureSignedLocalGovernanceMatrix(): Promise<LocalGovernanceRuntime> {
  const apiUrl = configuredUrl('api');
  const coreUrl = configuredUrl('core');
  const backendKey = resolveBackendApiKey();
  const cacheKey = `${matrixCacheKey(apiUrl, coreUrl, backendKey)}\nsigned-required`;
  const cached = signedInflight.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (!isLoopbackUrl(apiUrl) || !isLoopbackUrl(coreUrl)) {
      throw new Error(`signed local governance matrix requires loopback API/Core URLs, got ${apiUrl} / ${coreUrl}`);
    }
    if (!backendKey) throw new Error('No backend X-API-Key found for signed local governance matrix');

    const client = new OpenBoxClient({
      apiUrl,
      apiKey: backendKey,
      clientName: 'openbox-hook-integration-signed',
      retry: { maxRetries: 0 },
    });
    const profile = await client.getProfile();
    const orgId = profileOrgId(profile);
    if (!orgId) throw new Error('Could not resolve local organization id from /auth/profile');
    const agents = await currentAgents(client);
    const created = await createLocalAgent(client, orgId, agents, {
      signingRequired: true,
      nameSuffix: 'signed',
    });
    if (!created.agentIdentity) {
      throw new Error('Backend createAgent did not return signed agent identity for signing_required=true proof');
    }
    await upsertMatrixRules(client, created.agentId);
    const sample = LOCAL_GOVERNANCE_VERDICT_MATRIX.find((entry) => entry.expectedVerdict === 'allow') ??
      LOCAL_GOVERNANCE_VERDICT_MATRIX[0];
    const result = await checkGovernance({
      agentId: created.agentId,
      apiKey: created.runtimeKey,
      coreUrl,
      spanType: sample.spanType,
      activityInput: sample.activityInput,
      agentIdentity: created.agentIdentity,
    });
    const verdict = normalizeVerdict(result.verdict ?? result.action);
    if (verdict !== sample.expectedVerdict) {
      throw new Error(
        `signed local governance matrix mismatch for ${sample.expectedRule}: expected ${sample.expectedVerdict}, got ${JSON.stringify(result).slice(0, 500)}`,
      );
    }
    return {
      apiUrl,
      coreUrl,
      backendKey,
      agentId: created.agentId,
      runtimeKey: created.runtimeKey,
      agentIdentity: created.agentIdentity,
      signingRequired: true,
    };
  })();
  signedInflight.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    if (signedInflight.get(cacheKey) === promise) signedInflight.delete(cacheKey);
    throw error;
  }
}

export function expectedVerdict(c: VerdictMatrixCase): Verdict {
  return c.expectedVerdict;
}

export function normalizeMatrixVerdict(value: unknown): Verdict | undefined {
  return normalizeVerdict(value);
}
