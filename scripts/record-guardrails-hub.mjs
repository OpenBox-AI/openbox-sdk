#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRoot = process.cwd();
const fixture = readJson(resolve(repoRoot, 'codegen/fixtures/provider-capabilities.json'));
const surface = fixture.guardrailsHubRecordingSurface;

if (!surface || typeof surface !== 'object') {
  throw new Error('Missing guardrailsHubRecordingSurface in codegen/fixtures/provider-capabilities.json');
}

const mode = parseMode(process.argv.slice(2));
const fixturePath = resolve(repoRoot, surface.fixturePath);

if (mode === 'record') {
  await recordHubFixture();
} else if (mode === 'provenance') {
  reportHubProvenance();
} else {
  replayHubFixture();
}

function parseMode(args) {
  if (args.includes('--record')) return 'record';
  if (args.includes('--replay') || args.includes('--check')) return 'replay';
  if (args.includes('--provenance')) return 'provenance';
  throw new Error('Usage: node scripts/record-guardrails-hub.mjs --record|--replay|--provenance');
}

async function recordHubFixture() {
  requireEnvValue(surface.recordEnv, 'set to 1 to allow overwriting the recorded Guardrails Hub fixture');
  if (process.env[surface.recordEnv] !== '1') {
    throw new Error(`${surface.recordEnv} must be exactly 1 before recording Guardrails Hub fixtures`);
  }
  requireEnvValue(surface.tokenEnv, 'required by the Guardrails Hub service during real Hub validation');
  const apiUrl = requireEnvValue(surface.backendApiUrlEnv, 'backend URL for /guardrails/run-test');
  const apiKey = requireEnvValue(surface.backendApiKeyEnv, 'backend X-API-Key for /guardrails/run-test');
  const provenance = loadAndAssertHubProvenance();
  const records = [];

  for (const testCase of surface.cases) {
    const sampleCount = testCase.sampleCount ?? surface.defaultSampleCount;
    for (const variant of recordingVariantsForCase(testCase)) {
      const samples = [];
      const variantRef = `${testCase.id}/${variant.id}`;
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const response = await postRunTest(apiUrl, apiKey, testCase, variant);
        const normalized = normalizeRunTestResponse(response);
        if (normalized.semanticStatus !== variant.expectedSemanticStatus) {
          throw new Error(
            `${variantRef} expected ${variant.expectedSemanticStatus} but got ${normalized.semanticStatus}`,
          );
        }
        samples.push(normalized);
      }

      const uniqueSamples = new Set(samples.map((sample) => stableJson(sample)));
      records.push({
        caseId: testCase.id,
        variantId: variant.id,
        guardrailType: testCase.guardrailType,
        expectedSemanticStatus: variant.expectedSemanticStatus,
        sampleCount,
        stable: uniqueSamples.size === 1,
        samples,
      });
    }
  }

  const recorded = {
    schemaVersion: 1,
    status: 'recorded',
    generatedBy: surface.recorderScript,
    source: surface.source,
    fixturePath: surface.fixturePath,
    policyId: surface.id,
    provenance,
    records,
  };
  assertRecordedFixture(recorded);
  writeJson(fixturePath, recorded);
  console.log(`recorded ${records.length} Guardrails Hub variants to ${surface.fixturePath}`);
}

function replayHubFixture() {
  const stored = readJson(fixturePath);
  if (stored.status === 'not-recorded') {
    assertNotRecordedFixture(stored);
    console.log(`${surface.fixturePath} is not recorded yet; record with ${surface.recordEnv}=1`);
    return;
  }
  assertRecordedFixture(stored);
  console.log(`replayed ${stored.records.length} Guardrails Hub recorded cases from ${surface.fixturePath}`);
}

function reportHubProvenance() {
  const provenance = loadHubProvenance();
  const report = summarizeHubProvenance(provenance);
  console.log(stableJson(report));
  if (
    process.env.OPENBOX_GUARDRAILS_PROVENANCE_ASSERT_HUB === '1' &&
    report.status !== 'hub-backed'
  ) {
    throw new Error(`Guardrails Hub provenance is ${report.status}; expected hub-backed`);
  }
}

async function postRunTest(apiUrl, apiKey, testCase, variant) {
  const response = await fetch(new URL('/guardrails/run-test', normalizeBaseUrl(apiUrl)), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Openbox-Client': 'openbox-guardrails-hub-recorder',
    },
    body: JSON.stringify({
      guardrail_type: testCase.guardrailType,
      params: variant.params,
      settings: variant.settings,
      logs: variant.logs,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const contentType = response.headers.get('content-type');
  const body = contentType?.includes('application/json') ? await response.json() : await response.text();
  return { statusCode: response.status, body };
}

function expectedRecordingEntries() {
  const entries = [];
  for (const testCase of surface.cases) {
    const sampleCount = testCase.sampleCount ?? surface.defaultSampleCount;
    for (const variant of recordingVariantsForCase(testCase)) {
      entries.push({ testCase, variant, sampleCount });
    }
  }
  return entries;
}

function recordingVariantsForCase(testCase) {
  if (!Array.isArray(testCase.variants) || testCase.variants.length === 0) {
    throw new Error(`${testCase.id} must declare at least one Guardrails Hub recording variant`);
  }
  return testCase.variants;
}

function recordingKey(entry) {
  return `${entry.caseId}/${entry.variantId}`;
}

function normalizeRunTestResponse(response) {
  const body = response.body && typeof response.body === 'object' ? response.body : {};
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const violationsDetected = Boolean(data.violations_detected);
  return {
    statusCode: response.statusCode,
    envelopeStatus: typeof body.status === 'number' ? body.status : null,
    success: typeof data.success === 'boolean' ? data.success : null,
    violationsDetected,
    semanticStatus: violationsDetected ? 'violation' : data.success === true ? 'allowed' : 'failure',
    detail: typeof data.detail === 'string' ? data.detail : null,
    validatedLogs: scrubDynamicValues(data.validated_logs ?? null),
  };
}

function loadAndAssertHubProvenance() {
  const provenance = loadHubProvenance();
  const report = summarizeHubProvenance(provenance);
  if (report.status !== 'hub-backed') {
    throw new Error(`Guardrails Hub provenance is ${report.status}; expected hub-backed`);
  }

  return {
    source: 'guardrails-hub',
    requiredValidatorModulePrefix: surface.requiredValidatorModulePrefix,
    validators: report.validators
      .map((entry) => ({
        guardrailType: entry.guardrailType,
        className: entry.className,
        module: entry.module,
      }))
      .sort((left, right) => left.guardrailType.localeCompare(right.guardrailType)),
  };
}

function summarizeHubProvenance(provenance) {
  const validators = Array.isArray(provenance.validators) ? provenance.validators : [];
  const requiredTypes = [...new Set(surface.cases.map((entry) => String(entry.guardrailType)))]
    .sort((left, right) => left.localeCompare(right));
  const validatorsByType = new Map(validators.map((entry) => [String(entry.guardrailType), entry]));
  const normalizedValidators = validators
    .map((entry) => ({
      guardrailType: String(entry.guardrailType),
      className: String(entry.className ?? ''),
      module: String(entry.module ?? ''),
    }))
    .sort((left, right) => left.guardrailType.localeCompare(right.guardrailType));
  const missingGuardrailTypes = requiredTypes.filter((guardrailType) => !validatorsByType.has(guardrailType));
  const nonHubValidators = [];
  const forbiddenValidators = [];

  for (const guardrailType of requiredTypes) {
    const validator = validatorsByType.get(guardrailType);
    if (!validator) continue;
    const moduleName = String(validator.module ?? '');
    if (!moduleName.startsWith(surface.requiredValidatorModulePrefix)) {
      nonHubValidators.push({ guardrailType, module: moduleName || '<empty>' });
    }
    for (const forbiddenPrefix of surface.forbiddenValidatorModulePrefixes) {
      if (moduleName.startsWith(forbiddenPrefix)) {
        forbiddenValidators.push({ guardrailType, module: moduleName, forbiddenPrefix });
      }
    }
  }

  const status = missingGuardrailTypes.length > 0
    ? 'missing-types'
    : forbiddenValidators.length > 0
      ? 'local-fixture'
      : nonHubValidators.length > 0
        ? 'not-hub-backed'
        : 'hub-backed';

  return {
    generatedBy: surface.recorderScript,
    policyId: surface.id,
    source: surface.source,
    status,
    requiredValidatorModulePrefix: surface.requiredValidatorModulePrefix,
    forbiddenValidatorModulePrefixes: surface.forbiddenValidatorModulePrefixes,
    requiredGuardrailTypes: requiredTypes,
    missingGuardrailTypes,
    nonHubValidators,
    forbiddenValidators,
    validators: normalizedValidators,
  };
}

function loadHubProvenance() {
  const rawJson = process.env[surface.provenanceJsonEnv];
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed) ? { validators: parsed } : parsed;
  }

  const guardrailsRepo = process.env[surface.guardrailsRepoEnv];
  if (!guardrailsRepo) {
    throw new Error(
      `Set ${surface.provenanceJsonEnv} or ${surface.guardrailsRepoEnv} so the recorder can prove Hub validator provenance`,
    );
  }

  const resolvedRepo = resolve(guardrailsRepo);
  const defaultPython = resolve(resolvedRepo, '.venv/bin/python3');
  const python = process.env[surface.guardrailsPythonEnv] ||
    (existsSync(defaultPython) ? defaultPython : 'python3');
  const code = `
import inspect
import json
from src.guardrails import GUARDRAILS_MAP

validators = []
for guardrail_type, validator in sorted(GUARDRAILS_MAP.items(), key=lambda item: str(item[0])):
    module = getattr(validator, "__module__", "") or ""
    validators.append({
        "guardrailType": str(guardrail_type),
        "className": getattr(validator, "__name__", str(validator)),
        "module": module,
        "file": inspect.getsourcefile(validator) or "",
    })
print(json.dumps({"validators": validators}, sort_keys=True))
`;
  const result = spawnSync(python, ['-c', code], {
    cwd: resolvedRepo,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to inspect Guardrails Hub provenance via ${python}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

function assertRecordedFixture(stored) {
  if (stored.schemaVersion !== 1) throw new Error('Guardrails Hub fixture schemaVersion must be 1');
  if (stored.status !== 'recorded') throw new Error('Guardrails Hub fixture status must be recorded');
  if (stored.generatedBy !== surface.recorderScript) throw new Error('Guardrails Hub fixture generatedBy drifted');
  if (stored.source !== surface.source) throw new Error('Guardrails Hub fixture source drifted');
  if (stored.policyId !== surface.id) throw new Error('Guardrails Hub fixture policyId drifted');
  if (stored.provenance?.source !== 'guardrails-hub') throw new Error('Guardrails Hub fixture lacks Hub provenance');

  const expectedEntries = expectedRecordingEntries();
  const expectedByKey = new Map(
    expectedEntries.map((entry) => [`${entry.testCase.id}/${entry.variant.id}`, entry]),
  );
  const recordKeys = stored.records.map(recordingKey);
  const uniqueRecordKeys = new Set(recordKeys);
  if (uniqueRecordKeys.size !== recordKeys.length) {
    throw new Error('Guardrails Hub fixture contains duplicate case/variant records');
  }
  if (
    expectedByKey.size !== uniqueRecordKeys.size ||
    [...expectedByKey.keys()].some((key) => !uniqueRecordKeys.has(key))
  ) {
    throw new Error('Guardrails Hub fixture record case/variant IDs do not match the TypeSpec corpus');
  }

  for (const record of stored.records) {
    const expected = expectedByKey.get(recordingKey(record));
    if (!expected) throw new Error(`Unknown Guardrails Hub record ${recordingKey(record)}`);
    const recordRef = recordingKey(record);
    if (record.sampleCount !== expected.sampleCount) {
      throw new Error(`${recordRef} sampleCount drifted from TypeSpec`);
    }
    if (!record.stable) throw new Error(`${recordRef} has non-deterministic samples`);
    if (!Array.isArray(record.samples) || record.samples.length !== expected.sampleCount) {
      throw new Error(`${recordRef} must store exactly ${expected.sampleCount} samples`);
    }
    for (const sample of record.samples) {
      if (sample.semanticStatus !== expected.variant.expectedSemanticStatus) {
        throw new Error(`${recordRef} sample semanticStatus drifted`);
      }
    }
  }

  assertNoSecretLeak(stored);
}

function assertNotRecordedFixture(stored) {
  if (stored.schemaVersion !== 1) throw new Error('Guardrails Hub fixture schemaVersion must be 1');
  if (stored.status !== 'not-recorded') throw new Error('Guardrails Hub fixture status must be not-recorded');
  if (stored.policyId !== surface.id) throw new Error('Guardrails Hub placeholder policyId drifted');
  if (stored.generatedBy !== surface.recorderScript) throw new Error('Guardrails Hub placeholder generatedBy drifted');
  if (!stored.recordingRequired) throw new Error('Guardrails Hub placeholder must mark recordingRequired=true');
  if (!Array.isArray(stored.records) || stored.records.length !== 0) {
    throw new Error('Guardrails Hub placeholder must not contain records');
  }
  assertNoSecretLeak(stored);
}

function assertNoSecretLeak(value) {
  const text = stableJson(value);
  const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  if (jwtPattern.test(text)) {
    throw new Error('Guardrails Hub fixture appears to contain a JWT/token');
  }
}

function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

function requireEnvValue(name, reason) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}: ${reason}`);
  return value;
}

function scrubDynamicValues(value) {
  if (Array.isArray(value)) return value.map(scrubDynamicValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['id', 'request_id', 'created_at', 'updated_at', 'timestamp'].includes(key))
      .map(([key, item]) => [key, scrubDynamicValues(item)]),
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stableJson(value)}\n`);
}

function stableJson(value) {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortJson(value[key])]),
  );
}
