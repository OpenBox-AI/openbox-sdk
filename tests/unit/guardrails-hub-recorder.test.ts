import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { GUARDRAILS_HUB_RECORDING_SURFACE } from '../../ts/src/governance/capability-matrix.js';

function runProvenance(validators: Array<{ guardrailType: string; className: string; module: string }>) {
  const output = execFileSync(
    process.execPath,
    ['scripts/record-guardrails-hub.mjs', '--provenance'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        [GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv]: JSON.stringify({ validators }),
      },
    },
  );
  return JSON.parse(output) as {
    status: string;
    forbiddenValidators: unknown[];
    missingGuardrailTypes: string[];
    nonHubValidators: unknown[];
    requiredGuardrailTypes: string[];
  };
}

function runProvenanceRaw(
  validators: Array<{ guardrailType: string; className: string; module: string }>,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return runProvenanceJsonRaw(JSON.stringify({ validators }), extraEnv);
}

function runProvenanceJsonRaw(rawJson: string | undefined, extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
  }
  if (rawJson === undefined) {
    delete env[GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv];
  } else {
    env[GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv] = rawJson;
  }

  const result = spawnSync(
    process.execPath,
    ['scripts/record-guardrails-hub.mjs', '--provenance'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    },
  );
  return {
    exitCode: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function hubValidators() {
  return [...new Set(GUARDRAILS_HUB_RECORDING_SURFACE.cases.map((entry) => entry.guardrailType))]
    .sort((left, right) => left.localeCompare(right))
    .map((guardrailType) => ({
      guardrailType,
      className: `HubGuardrail${guardrailType}`,
      module: `guardrails_grhub_validator_${guardrailType}.main`,
    }));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function variantRequestKey(
  guardrailType: string,
  variant: (typeof GUARDRAILS_HUB_RECORDING_SURFACE.cases)[number]['variants'][number],
) {
  return stableJson({
    guardrail_type: guardrailType,
    logs: variant.logs,
    params: variant.params,
    settings: variant.settings,
  });
}

async function runRecorder(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const result = await runRecorderRaw(args, options);
  if (result.exitCode !== 0) {
    throw new Error(`record-guardrails-hub exited ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

async function runRecorderRaw(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const child = spawn(process.execPath, [resolve('scripts/record-guardrails-hub.mjs'), ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`record-guardrails-hub timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
  return { exitCode, stderr, stdout };
}

function writeTempCapabilitiesFixture(tmp: string) {
  mkdirSync(join(tmp, 'codegen/fixtures'), { recursive: true });
  writeFileSync(
    join(tmp, 'codegen/fixtures/provider-capabilities.json'),
    JSON.stringify({ guardrailsHubRecordingSurface: GUARDRAILS_HUB_RECORDING_SURFACE }, null, 2),
  );
}

function writeTempGuardrailsHubFixture(tmp: string, value: unknown) {
  const fixturePath = join(tmp, GUARDRAILS_HUB_RECORDING_SURFACE.fixturePath);
  mkdirSync(resolve(fixturePath, '..'), { recursive: true });
  writeFileSync(fixturePath, `${JSON.stringify(value, null, 2)}\n`);
}

function recordedHubSample(semanticStatus: string): {
  detail: string | null;
  envelopeStatus: number;
  semanticStatus: string;
  statusCode: number;
  success: boolean;
  validatedLogs: unknown;
  violationsDetected: boolean;
} {
  const violation = semanticStatus === 'violation';
  return {
    detail: null,
    envelopeStatus: 200,
    semanticStatus,
    statusCode: 200,
    success: !violation,
    validatedLogs: null,
    violationsDetected: violation,
  };
}

function recordedHubFixture() {
  return {
    fixturePath: GUARDRAILS_HUB_RECORDING_SURFACE.fixturePath,
    generatedBy: GUARDRAILS_HUB_RECORDING_SURFACE.recorderScript,
    policyId: GUARDRAILS_HUB_RECORDING_SURFACE.id,
    provenance: {
      source: 'guardrails-hub',
      validators: hubValidators(),
    },
    records: GUARDRAILS_HUB_RECORDING_SURFACE.cases.flatMap((testCase) =>
      testCase.variants.map((variant) => {
        const sampleCount: number = testCase.sampleCount ?? GUARDRAILS_HUB_RECORDING_SURFACE.defaultSampleCount;
        return {
          caseId: testCase.id,
          expectedSemanticStatus: variant.expectedSemanticStatus,
          guardrailType: testCase.guardrailType,
          sampleCount,
          samples: Array.from({ length: sampleCount }, () => recordedHubSample(variant.expectedSemanticStatus)),
          stable: true,
          variantId: variant.id,
        };
      }),
    ),
    schemaVersion: 1,
    source: GUARDRAILS_HUB_RECORDING_SURFACE.source,
    status: 'recorded',
  };
}

function expectedHubVariantRefs() {
  return GUARDRAILS_HUB_RECORDING_SURFACE.cases
    .flatMap((testCase) => testCase.variants.map((variant) => `${testCase.id}/${variant.id}`))
    .sort();
}

describe('Guardrails Hub recorder', () => {
  it('reports hub-backed provenance when every required validator comes from Guardrails Hub', () => {
    const report = runProvenance(hubValidators());

    expect(report.status).toBe('hub-backed');
    expect(report.requiredGuardrailTypes).toEqual(['1', '2', '3', '4', '5']);
    expect(report.missingGuardrailTypes).toEqual([]);
    expect(report.nonHubValidators).toEqual([]);
    expect(report.forbiddenValidators).toEqual([]);
  });

  it('accepts array shorthand provenance JSON for Hub validator inspection', () => {
    const result = runProvenanceJsonRaw(JSON.stringify(hubValidators()));

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('hub-backed');
  });

  it('requires explicit provenance JSON or a guardrails repo before inspecting Hub validators', () => {
    const result = runProvenanceJsonRaw(undefined, {
      [GUARDRAILS_HUB_RECORDING_SURFACE.guardrailsPythonEnv]: undefined,
      [GUARDRAILS_HUB_RECORDING_SURFACE.guardrailsRepoEnv]: undefined,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `Set ${GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv} or ${GUARDRAILS_HUB_RECORDING_SURFACE.guardrailsRepoEnv}`,
    );
  });

  it('reports local fixture provenance without requiring a Hub token', () => {
    const report = runProvenance(
      hubValidators().map((validator) => ({
        ...validator,
        module: 'src.guardrails.local',
      })),
    );

    expect(report.status).toBe('local-fixture');
    expect(report.missingGuardrailTypes).toEqual([]);
    expect(report.nonHubValidators).toHaveLength(5);
    expect(report.forbiddenValidators).toHaveLength(5);
  });

  it('reports missing guardrail types before treating remaining validators as Hub-backed', () => {
    const report = runProvenance(hubValidators().filter((validator) => validator.guardrailType !== '5'));

    expect(report.status).toBe('missing-types');
    expect(report.requiredGuardrailTypes).toEqual(['1', '2', '3', '4', '5']);
    expect(report.missingGuardrailTypes).toEqual(['5']);
    expect(report.nonHubValidators).toEqual([]);
    expect(report.forbiddenValidators).toEqual([]);
  });

  it('reports non-Hub provenance when validators are neither Hub-backed nor local fixtures', () => {
    const report = runProvenance(
      hubValidators().map((validator) => ({
        ...validator,
        module: `third.party.validator_${validator.guardrailType}`,
      })),
    );

    expect(report.status).toBe('not-hub-backed');
    expect(report.missingGuardrailTypes).toEqual([]);
    expect(report.nonHubValidators).toHaveLength(5);
    expect(report.forbiddenValidators).toEqual([]);
  });

  it('fails provenance assertion mode unless every validator is Hub-backed', () => {
    const result = runProvenanceRaw(
      hubValidators().map((validator) => ({
        ...validator,
        module: 'src.guardrails.local',
      })),
      { OPENBOX_GUARDRAILS_PROVENANCE_ASSERT_HUB: '1' },
    );

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('local-fixture');
    expect(result.stderr).toContain('Guardrails Hub provenance is local-fixture; expected hub-backed');
  });

  it('refuses to record local fixture provenance before calling the backend', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-local-fixture-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      const result = await runRecorderRaw(['--record'], {
        cwd: tmp,
        env: {
          ...process.env,
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiKeyEnv]: 'obx_test_recorder_key',
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiUrlEnv]: 'http://127.0.0.1:9',
          [GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv]: JSON.stringify({
            validators: hubValidators().map((validator) => ({
              ...validator,
              module: 'src.guardrails.local',
            })),
          }),
          [GUARDRAILS_HUB_RECORDING_SURFACE.recordEnv]: '1',
          [GUARDRAILS_HUB_RECORDING_SURFACE.tokenEnv]: 'test-guardrails-token',
        },
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Guardrails Hub provenance is local-fixture; expected hub-backed');
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('records every spec variant with five deterministic samples through /guardrails/run-test', async () => {
    const expectedByRequest = new Map<
      string,
      {
        caseId: string;
        expectedSemanticStatus: string;
        guardrailType: string;
        variantId: string;
      }
    >();
    for (const testCase of GUARDRAILS_HUB_RECORDING_SURFACE.cases) {
      for (const variant of testCase.variants) {
        expectedByRequest.set(variantRequestKey(testCase.guardrailType, variant), {
          caseId: testCase.id,
          expectedSemanticStatus: variant.expectedSemanticStatus,
          guardrailType: testCase.guardrailType,
          variantId: variant.id,
        });
      }
    }
    expect(expectedByRequest.size).toBe(10);

    const seenRequests: Array<{
      caseId: string;
      headers: Record<string, string | string[] | undefined>;
      variantId: string;
    }> = [];
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/guardrails/run-test') {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const expected = expectedByRequest.get(stableJson(body));
      if (!expected) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unexpected recorder payload', body }));
        return;
      }
      seenRequests.push({
        caseId: expected.caseId,
        headers: req.headers,
        variantId: expected.variantId,
      });
      const violation = expected.expectedSemanticStatus === 'violation';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          detail: `${expected.caseId}/${expected.variantId}`,
          success: !violation,
          validated_logs: { id: 'dynamic-log-id', timestamp: '2026-06-22T00:00:00.000Z' },
          violations_detected: violation,
        },
        status: 200,
      }));
    });

    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-record-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const address = server.address() as AddressInfo;

      const stdout = await runRecorder(['--record'], {
        cwd: tmp,
        env: {
          ...process.env,
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiKeyEnv]: 'obx_test_recorder_key',
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiUrlEnv]: `http://127.0.0.1:${address.port}`,
          [GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv]: JSON.stringify({ validators: hubValidators() }),
          [GUARDRAILS_HUB_RECORDING_SURFACE.recordEnv]: '1',
          [GUARDRAILS_HUB_RECORDING_SURFACE.tokenEnv]: 'test-guardrails-token',
        },
      });
      expect(stdout).toContain('recorded 10 Guardrails Hub variants');

      const recorded = JSON.parse(
        readFileSync(join(tmp, GUARDRAILS_HUB_RECORDING_SURFACE.fixturePath), 'utf8'),
      ) as {
        provenance: { source: string };
        records: Array<{
          caseId: string;
          expectedSemanticStatus: string;
          sampleCount: number;
          samples: Array<{ semanticStatus: string }>;
          stable: boolean;
          variantId: string;
        }>;
        status: string;
      };
      expect(recorded.status).toBe('recorded');
      expect(recorded.provenance.source).toBe('guardrails-hub');
      expect(recorded.records).toHaveLength(10);
      expect(recorded.records.map((record) => `${record.caseId}/${record.variantId}`).sort()).toEqual(expectedHubVariantRefs());
      for (const record of recorded.records) {
        expect(record.sampleCount, `${record.caseId}/${record.variantId}`).toBe(5);
        expect(record.stable, `${record.caseId}/${record.variantId}`).toBe(true);
        expect(record.samples, `${record.caseId}/${record.variantId}`).toHaveLength(5);
        expect(
          record.samples.every((sample) => sample.semanticStatus === record.expectedSemanticStatus),
          `${record.caseId}/${record.variantId}`,
        ).toBe(true);
      }

      expect(seenRequests).toHaveLength(50);
      const sampleCounts = new Map<string, number>();
      for (const request of seenRequests) {
        expect(request.headers['x-api-key']).toBe('obx_test_recorder_key');
        expect(request.headers['x-openbox-client']).toBe('openbox-guardrails-hub-recorder');
        const key = `${request.caseId}/${request.variantId}`;
        sampleCounts.set(key, (sampleCounts.get(key) ?? 0) + 1);
      }
      expect([...sampleCounts.values()].sort()).toEqual(Array.from({ length: 10 }, () => 5));
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('refuses to record when backend semantic status drifts from the spec', async () => {
    const server = createServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          detail: 'forced-allowed',
          success: true,
          validated_logs: {},
          violations_detected: false,
        },
        status: 200,
      }));
    });
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-semantic-drift-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const address = server.address() as AddressInfo;
      const result = await runRecorderRaw(['--record'], {
        cwd: tmp,
        env: {
          ...process.env,
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiKeyEnv]: 'obx_test_recorder_key',
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiUrlEnv]: `http://127.0.0.1:${address.port}`,
          [GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv]: JSON.stringify({ validators: hubValidators() }),
          [GUARDRAILS_HUB_RECORDING_SURFACE.recordEnv]: '1',
          [GUARDRAILS_HUB_RECORDING_SURFACE.tokenEnv]: 'test-guardrails-token',
        },
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('detect-pii/email-violation expected violation but got allowed');
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('refuses to write non-deterministic recorded samples', async () => {
    let requestCount = 0;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const expected = [...GUARDRAILS_HUB_RECORDING_SURFACE.cases]
        .flatMap((testCase) =>
          testCase.variants.map((variant) => ({ testCase, variant })),
        )
        .find(({ testCase, variant }) => variantRequestKey(testCase.guardrailType, variant) === stableJson(body));
      if (!expected) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unexpected recorder payload', body }));
        return;
      }
      requestCount += 1;
      const violation = expected.variant.expectedSemanticStatus === 'violation';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          detail: `${expected.testCase.id}/${expected.variant.id}/${requestCount}`,
          success: !violation,
          validated_logs: {},
          violations_detected: violation,
        },
        status: 200,
      }));
    });
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-nondeterministic-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
      const address = server.address() as AddressInfo;
      const result = await runRecorderRaw(['--record'], {
        cwd: tmp,
        env: {
          ...process.env,
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiKeyEnv]: 'obx_test_recorder_key',
          [GUARDRAILS_HUB_RECORDING_SURFACE.backendApiUrlEnv]: `http://127.0.0.1:${address.port}`,
          [GUARDRAILS_HUB_RECORDING_SURFACE.provenanceJsonEnv]: JSON.stringify({ validators: hubValidators() }),
          [GUARDRAILS_HUB_RECORDING_SURFACE.recordEnv]: '1',
          [GUARDRAILS_HUB_RECORDING_SURFACE.tokenEnv]: 'test-guardrails-token',
        },
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('detect-pii/safe has non-deterministic samples');
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('replays the not-recorded placeholder without requiring backend credentials', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-replay-placeholder-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      writeTempGuardrailsHubFixture(tmp, {
        generatedBy: GUARDRAILS_HUB_RECORDING_SURFACE.recorderScript,
        policyId: GUARDRAILS_HUB_RECORDING_SURFACE.id,
        recordingRequired: true,
        records: [],
        schemaVersion: 1,
        status: 'not-recorded',
      });

      const stdout = await runRecorder(['--replay'], {
        cwd: tmp,
        env: process.env,
      });

      expect(stdout).toContain(`${GUARDRAILS_HUB_RECORDING_SURFACE.fixturePath} is not recorded yet`);
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('replays a complete recorded fixture bound to the TypeSpec corpus', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-replay-recorded-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      writeTempGuardrailsHubFixture(tmp, recordedHubFixture());

      const stdout = await runRecorder(['--replay'], {
        cwd: tmp,
        env: process.env,
      });

      expect(stdout).toContain('replayed 10 Guardrails Hub recorded cases');
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('refuses to replay duplicate case/variant records', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-replay-duplicate-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      const fixture = recordedHubFixture();
      fixture.records.push({ ...fixture.records[0] });
      writeTempGuardrailsHubFixture(tmp, fixture);

      const result = await runRecorderRaw(['--replay'], {
        cwd: tmp,
        env: process.env,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Guardrails Hub fixture contains duplicate case/variant records');
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('refuses to replay sample-count drift from the TypeSpec corpus', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-replay-sample-count-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      const fixture = recordedHubFixture();
      fixture.records[0].sampleCount = 4;
      writeTempGuardrailsHubFixture(tmp, fixture);

      const result = await runRecorderRaw(['--replay'], {
        cwd: tmp,
        env: process.env,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('detect-pii/safe sampleCount drifted from TypeSpec');
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('refuses to replay semantic-status drift from recorded Hub samples', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-replay-semantic-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      const fixture = recordedHubFixture();
      fixture.records[0].samples[0].semanticStatus = 'violation';
      writeTempGuardrailsHubFixture(tmp, fixture);

      const result = await runRecorderRaw(['--replay'], {
        cwd: tmp,
        env: process.env,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('detect-pii/safe sample semanticStatus drifted');
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });

  it('refuses to replay fixtures that contain leaked Guardrails Hub tokens', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'openbox-guardrails-hub-replay-secret-'));
    try {
      writeTempCapabilitiesFixture(tmp);
      const fixture = recordedHubFixture();
      fixture.records[0].samples[0].detail = 'eyJhbGciOi.fake.sig';
      writeTempGuardrailsHubFixture(tmp, fixture);

      const result = await runRecorderRaw(['--replay'], {
        cwd: tmp,
        env: process.env,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Guardrails Hub fixture appears to contain a JWT/token');
    } finally {
      rmSync(tmp, { force: true, recursive: true });
    }
  });
});
