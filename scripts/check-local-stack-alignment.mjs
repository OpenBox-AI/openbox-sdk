#!/usr/bin/env node
// Validate that the live local stack points backend, OPA, and S3 at the same bundle source.

import { accessSync, constants as fsConstants, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const expectedBucket = process.env.OPENBOX_LOCAL_S3_BUCKET ?? 'openbox-local';
const expectedAgeSlowCallThresholdSec =
  process.env.OPENBOX_LOCAL_AGE_SLOW_CALL_THRESHOLD_SEC ?? '120';
const expectedGovernanceWorkflowTimeoutSec =
  process.env.OPENBOX_LOCAL_GOVERNANCE_WORKFLOW_TIMEOUT_SEC ?? '120';
const expectedGovernanceActivityTimeoutSec =
  process.env.OPENBOX_LOCAL_GOVERNANCE_ACTIVITY_TIMEOUT_SEC ?? '120';
const expectedKmsProvider = process.env.OPENBOX_LOCAL_KMS_PROVIDER ?? 'local';
const expectedKmsAuthMode = process.env.OPENBOX_LOCAL_KMS_AUTH_MODE ?? 'local';
const expectedLocalKmsSecret =
  process.env.OPENBOX_LOCAL_KMS_SECRET ?? 'openbox-local-sdk-secret';
const s3Endpoint = normalizeUrl(
  process.env.OPENBOX_LOCAL_S3_URL ??
    process.env.AWS_ENDPOINT_URL_S3 ??
    process.env.AWS_ENDPOINT_URL ??
    'http://127.0.0.1:5001',
);
const backendUrl = normalizeUrl(process.env.OPENBOX_API_URL ?? 'http://127.0.0.1:3000');
const coreUrl = normalizeUrl(process.env.OPENBOX_CORE_URL ?? 'http://127.0.0.1:8086');
const opaUrl = normalizeUrl(process.env.OPENBOX_E2E_OPA_URL ?? 'http://127.0.0.1:8181');
const guardrailsUrl = normalizeUrl(
  process.env.OPENBOX_GUARDRAIL_API_URL ?? process.env.GUARDRAIL_API_URL ?? 'http://127.0.0.1:8182',
);
const ageUrl = normalizeUrl(process.env.OPENBOX_AGE_URL ?? process.env.AGE_URL ?? 'http://127.0.0.1:8183');
const llamaFirewallUrl = normalizeUrl(
  process.env.OPENBOX_LLAMAFIREWALL_HOST ??
    process.env.LLAMAFIREWALL_HOST ??
    'http://127.0.0.1:8184',
);
const checkLlamaFirewall = process.env.OPENBOX_LOCAL_STACK_CHECK_LLAMAFIREWALL !== '0';
const requiredCoreWorkers = (
  process.env.OPENBOX_LOCAL_STACK_REQUIRED_CORE_WORKERS ??
  'governance-worker,attestation-worker,observability-worker'
)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const backendRepo = process.env.OPENBOX_BACKEND_REPO ?? resolve(repoRoot, '../openbox-repos/openbox-backend');
const backendEnvPath = process.env.OPENBOX_BACKEND_ENV ?? resolve(backendRepo, '.env');
const backendEnvLabel = process.env.OPENBOX_BACKEND_ENV ? 'OPENBOX_BACKEND_ENV' : 'backend .env';
const expectedOpaBinaryPath = process.env.OPENBOX_LOCAL_OPA_BINARY_PATH ?? '/opt/homebrew/bin/opa';
const coreRepo = process.env.OPENBOX_CORE_REPO ?? resolve(repoRoot, '../openbox-repos/openbox-core');
const coreEnvPath = process.env.OPENBOX_CORE_ENV ?? resolve(coreRepo, '.env');
const coreEnvLabel = process.env.OPENBOX_CORE_ENV ? 'OPENBOX_CORE_ENV' : 'core .env';
const opaConfigPath = process.env.OPENBOX_OPA_CONFIG_PATH ?? '/tmp/openbox-sdk-opa-config.yaml';

const failures = [];
const warnings = [];
const checks = [];

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function localEquivalentUrl(value) {
  try {
    const url = new URL(normalizeUrl(value));
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
      url.hostname = 'localhost';
    }
    return normalizeUrl(url.toString());
  } catch {
    return normalizeUrl(value);
  }
}

function recordCheck(message) {
  checks.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function expectOk(name, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      fail(`${name} returned HTTP ${response.status} from ${url}`);
      return;
    }
    recordCheck(`${name}: ${url}`);
  } catch (error) {
    fail(`${name} is not reachable at ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseEnvFile(path) {
  const values = new Map();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    values.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  return values;
}

function assertEquals(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} must be ${expected}, got ${actual ?? '<unset>'}`);
    return;
  }
  recordCheck(`${label}: ${expected}`);
}

function assertUrlEquivalent(actual, expected, label) {
  if (!actual || localEquivalentUrl(actual) !== localEquivalentUrl(expected)) {
    fail(`${label} must be ${expected}, got ${actual ?? '<unset>'}`);
    return;
  }
  recordCheck(`${label}: ${expected}`);
}

function assertNumberAtLeast(actual, minimum, label) {
  const parsed = Number(actual);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    fail(`${label} must be >= ${minimum}, got ${actual ?? '<unset>'}`);
    return;
  }
  recordCheck(`${label}: ${parsed}`);
}

function assertSecretEquals(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} must match expected local secret, got ${actual ? '<redacted>' : '<unset>'}`);
    return;
  }
  recordCheck(`${label}: <redacted>`);
}

function assertExecutableFile(path, label) {
  if (!path) {
    fail(`${label} must be ${expectedOpaBinaryPath}, got <unset>`);
    return;
  }
  if (path !== expectedOpaBinaryPath) {
    fail(`${label} must be ${expectedOpaBinaryPath}, got ${path}`);
    return;
  }
  try {
    accessSync(path, fsConstants.X_OK);
  } catch (error) {
    fail(`${label} must point to an executable OPA binary: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const result = spawnSync(path, ['version'], { encoding: 'utf8', timeout: 5_000 });
  if (result.error) {
    fail(`${label} must point to an executable OPA binary: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    fail(`${label} must execute 'opa version', got exit ${result.status}: ${result.stderr.trim()}`);
    return;
  }
  const version = result.stdout.match(/^Version:\s*(.+)$/m)?.[1] ?? 'unknown';
  recordCheck(`${label}: ${path} (${version})`);
}

function checkBackendEnvFile() {
  if (!existsSync(backendEnvPath)) {
    warn('backend env file not found; set OPENBOX_BACKEND_ENV to enable static config validation');
    return;
  }
  const env = parseEnvFile(backendEnvPath);
  assertEquals(env.get('S3_BUCKET_NAME'), expectedBucket, `${backendEnvLabel}:S3_BUCKET_NAME`);
  assertEquals(env.get('KMS_PROVIDER'), expectedKmsProvider, `${backendEnvLabel}:KMS_PROVIDER`);
  assertEquals(env.get('KMS_AUTH_MODE'), expectedKmsAuthMode, `${backendEnvLabel}:KMS_AUTH_MODE`);
  assertSecretEquals(
    env.get('OPENBOX_LOCAL_KMS_SECRET'),
    expectedLocalKmsSecret,
    `${backendEnvLabel}:OPENBOX_LOCAL_KMS_SECRET`,
  );
  for (const name of ['AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL_KMS', 'AWS_ENDPOINT_URL_STS']) {
    assertEquals(normalizeUrl(env.get(name) ?? ''), s3Endpoint, `${backendEnvLabel}:${name}`);
  }
  assertExecutableFile(env.get('OPA_BINARY_PATH'), `${backendEnvLabel}:OPA_BINARY_PATH`);
  assertUrlEquivalent(env.get('GUARDRAIL_API_URL'), guardrailsUrl, `${backendEnvLabel}:GUARDRAIL_API_URL`);
}

function checkOpaConfigFile() {
  if (!existsSync(opaConfigPath)) {
    warn(`OPA config file not found at ${opaConfigPath}; set OPENBOX_OPA_CONFIG_PATH to validate the watched bundle URL`);
    return;
  }
  const config = readFileSync(opaConfigPath, 'utf8');
  const expectedPath = `/${expectedBucket}`;
  if (!config.includes(expectedPath)) {
    fail(`${opaConfigPath} must point OPA at bucket ${expectedBucket}`);
    return;
  }
  recordCheck(`${opaConfigPath}: bucket ${expectedBucket}`);
}

function checkCoreEnvFile() {
  if (!existsSync(coreEnvPath)) {
    warn('core env file not found; set OPENBOX_CORE_ENV to enable static Core config validation');
    return;
  }
  const env = parseEnvFile(coreEnvPath);
  assertUrlEquivalent(env.get('OPA_URL'), opaUrl, `${coreEnvLabel}:OPA_URL`);
  assertUrlEquivalent(env.get('GUARDRAIL_URL'), guardrailsUrl, `${coreEnvLabel}:GUARDRAIL_URL`);
  assertUrlEquivalent(env.get('AGE_URL'), ageUrl, `${coreEnvLabel}:AGE_URL`);
  assertEquals(env.get('KMS_PROVIDER'), expectedKmsProvider, `${coreEnvLabel}:KMS_PROVIDER`);
  assertEquals(env.get('KMS_AUTH_MODE'), expectedKmsAuthMode, `${coreEnvLabel}:KMS_AUTH_MODE`);
  assertSecretEquals(
    env.get('OPENBOX_LOCAL_KMS_SECRET'),
    expectedLocalKmsSecret,
    `${coreEnvLabel}:OPENBOX_LOCAL_KMS_SECRET`,
  );
  assertNumberAtLeast(
    env.get('AGE_CB_SLOW_CALL_THRESHOLD_SEC'),
    Number(expectedAgeSlowCallThresholdSec),
    `${coreEnvLabel}:AGE_CB_SLOW_CALL_THRESHOLD_SEC`,
  );
  assertNumberAtLeast(
    env.get('GOVERNANCE_WORKFLOW_TIMEOUT_SEC'),
    Number(expectedGovernanceWorkflowTimeoutSec),
    `${coreEnvLabel}:GOVERNANCE_WORKFLOW_TIMEOUT_SEC`,
  );
  assertNumberAtLeast(
    env.get('GOVERNANCE_ACTIVITY_TIMEOUT_SEC'),
    Number(expectedGovernanceActivityTimeoutSec),
    `${coreEnvLabel}:GOVERNANCE_ACTIVITY_TIMEOUT_SEC`,
  );
}

function urlPort(url) {
  const parsed = new URL(url);
  if (parsed.port) return parsed.port;
  return parsed.protocol === 'https:' ? '443' : '80';
}

function findListenPids(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  });
  if (result.error?.code === 'ENOENT') {
    warn('lsof not found; skipping running backend process environment validation');
    return [];
  }
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function processEnvValue(pid, name) {
  const result = spawnSync('ps', ['eww', '-p', pid, '-o', 'command='], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') {
    warn('ps not found; skipping running backend process environment validation');
    return undefined;
  }
  if (result.status !== 0) return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = result.stdout.match(new RegExp(`(?:^|\\s)${escaped}=([^\\s]+)`));
  return match?.[1];
}

function findCommandPids(pattern) {
  const result = spawnSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') {
    warn('ps not found; skipping running process command validation');
    return [];
  }
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return [];
      return pattern.test(match[2]) ? [match[1]] : [];
    });
}

function checkRunningBackendEnv() {
  const pids = findListenPids(urlPort(backendUrl));
  if (pids.length === 0) {
    warn(`no backend listener found for ${backendUrl}; health check will report reachability separately`);
    return;
  }
  let checked = false;
  for (const pid of pids) {
    const bucket = processEnvValue(pid, 'S3_BUCKET_NAME');
    if (!bucket) continue;
    checked = true;
    assertEquals(bucket, expectedBucket, `backend process ${pid}:S3_BUCKET_NAME`);
    assertEquals(processEnvValue(pid, 'KMS_PROVIDER'), expectedKmsProvider, `backend process ${pid}:KMS_PROVIDER`);
    assertEquals(processEnvValue(pid, 'KMS_AUTH_MODE'), expectedKmsAuthMode, `backend process ${pid}:KMS_AUTH_MODE`);
    assertSecretEquals(
      processEnvValue(pid, 'OPENBOX_LOCAL_KMS_SECRET'),
      expectedLocalKmsSecret,
      `backend process ${pid}:OPENBOX_LOCAL_KMS_SECRET`,
    );
    const endpoint = processEnvValue(pid, 'AWS_ENDPOINT_URL');
    assertEquals(normalizeUrl(endpoint ?? ''), s3Endpoint, `backend process ${pid}:AWS_ENDPOINT_URL`);
    const runtimeOpaBinaryPath = processEnvValue(pid, 'OPA_BINARY_PATH');
    if (runtimeOpaBinaryPath) {
      assertExecutableFile(runtimeOpaBinaryPath, `backend process ${pid}:OPA_BINARY_PATH`);
    } else {
      assertExecutableFile(expectedOpaBinaryPath, `backend process ${pid}:OPA_BINARY_PATH default`);
    }
    assertUrlEquivalent(
      processEnvValue(pid, 'GUARDRAIL_API_URL'),
      guardrailsUrl,
      `backend process ${pid}:GUARDRAIL_API_URL`,
    );
  }
  if (!checked) {
    recordCheck(
      `backend listener env visibility skipped: ps did not expose S3_BUCKET_NAME for ${pids.join(', ')}`,
    );
  }
}

function checkCoreProcessEnv() {
  const pids = findListenPids(urlPort(coreUrl));
  if (pids.length === 0) {
    warn(`no core listener found for ${coreUrl}; health check will report reachability separately`);
    return;
  }
  for (const pid of pids) {
    checkCoreRuntimeEnv(pid, `core process ${pid}`);
    const opa = processEnvValue(pid, 'OPA_URL');
    if (opa) assertUrlEquivalent(opa, opaUrl, `core process ${pid}:OPA_URL`);
    const guardrail = processEnvValue(pid, 'GUARDRAIL_URL');
    if (guardrail) assertUrlEquivalent(guardrail, guardrailsUrl, `core process ${pid}:GUARDRAIL_URL`);
    const age = processEnvValue(pid, 'AGE_URL');
    if (age) assertUrlEquivalent(age, ageUrl, `core process ${pid}:AGE_URL`);
  }
}

function checkCoreRuntimeEnv(pid, label) {
  assertEquals(processEnvValue(pid, 'KMS_PROVIDER'), expectedKmsProvider, `${label}:KMS_PROVIDER`);
  assertEquals(processEnvValue(pid, 'KMS_AUTH_MODE'), expectedKmsAuthMode, `${label}:KMS_AUTH_MODE`);
  assertSecretEquals(
    processEnvValue(pid, 'OPENBOX_LOCAL_KMS_SECRET'),
    expectedLocalKmsSecret,
    `${label}:OPENBOX_LOCAL_KMS_SECRET`,
  );
  const ageSlowCallThreshold = processEnvValue(pid, 'AGE_CB_SLOW_CALL_THRESHOLD_SEC');
  if (ageSlowCallThreshold) {
    assertNumberAtLeast(
      ageSlowCallThreshold,
      Number(expectedAgeSlowCallThresholdSec),
      `${label}:AGE_CB_SLOW_CALL_THRESHOLD_SEC`,
    );
  } else {
    fail(`${label}:AGE_CB_SLOW_CALL_THRESHOLD_SEC must be >= ${expectedAgeSlowCallThresholdSec}, got <unset>`);
  }
  const governanceWorkflowTimeout = processEnvValue(pid, 'GOVERNANCE_WORKFLOW_TIMEOUT_SEC');
  if (governanceWorkflowTimeout) {
    assertNumberAtLeast(
      governanceWorkflowTimeout,
      Number(expectedGovernanceWorkflowTimeoutSec),
      `${label}:GOVERNANCE_WORKFLOW_TIMEOUT_SEC`,
    );
  } else {
    fail(`${label}:GOVERNANCE_WORKFLOW_TIMEOUT_SEC must be >= ${expectedGovernanceWorkflowTimeoutSec}, got <unset>`);
  }
  const governanceActivityTimeout = processEnvValue(pid, 'GOVERNANCE_ACTIVITY_TIMEOUT_SEC');
  if (governanceActivityTimeout) {
    assertNumberAtLeast(
      governanceActivityTimeout,
      Number(expectedGovernanceActivityTimeoutSec),
      `${label}:GOVERNANCE_ACTIVITY_TIMEOUT_SEC`,
    );
  } else {
    fail(`${label}:GOVERNANCE_ACTIVITY_TIMEOUT_SEC must be >= ${expectedGovernanceActivityTimeoutSec}, got <unset>`);
  }
}

function checkCoreWorkerProcessEnv() {
  for (const worker of requiredCoreWorkers) {
    const escaped = worker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pids = findCommandPids(new RegExp(`(?:^|/)core ${escaped}$`));
    if (pids.length === 0) {
      fail(`core ${worker} process must be running`);
      continue;
    }
    for (const pid of pids) {
      checkCoreRuntimeEnv(pid, `core ${worker} process ${pid}`);
    }
  }
}

await expectOk('backend health', `${backendUrl}/health`);
await expectOk('core health', `${coreUrl}/`);
await expectOk('OPA health', `${opaUrl}/health`);
await expectOk('Guardrails health', `${guardrailsUrl}/`);
await expectOk('AGE health', `${ageUrl}/health`);
if (checkLlamaFirewall) await expectOk('LlamaFirewall health', `${llamaFirewallUrl}/health`);
await expectOk('S3 bucket', `${s3Endpoint}/${expectedBucket}`);
checkBackendEnvFile();
checkOpaConfigFile();
checkCoreEnvFile();
checkRunningBackendEnv();
checkCoreProcessEnv();
checkCoreWorkerProcessEnv();

for (const check of checks) {
  console.log(`ok - ${check}`);
}
for (const warning of warnings) {
  console.warn(`warn - ${warning}`);
}
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`fail - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `local stack alignment verified: bucket=${expectedBucket} s3=${s3Endpoint} guardrails=${guardrailsUrl}`,
);
