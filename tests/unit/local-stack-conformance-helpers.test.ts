import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backendCoreGapRemediationRefRefsForTesting,
  classifyLocalStackTestBlockForTesting,
  extractLocalStackCallsForTesting,
  extractLocalStackTestBlocksForTesting,
  localStackBlockHasScenarioEvidenceForTesting,
  localStackBlockIncludesEvidencePatternForTesting,
  localStackBlockIncludesScenarioMarkerForTesting,
  localStackTestBlockIncludesEvidencePatternForTesting,
  providerGuardTestRefMatchesBlockForTesting,
  unknownScenarioProofMarkerRefsForTesting,
} from '../helpers/local-stack-conformance';

describe('local-stack proof classification helpers', () => {
  it('keeps proof strength tied to executable assertions', () => {
    expect(
      classifyLocalStackTestBlockForTesting(`
        it('returns a persisted object', async () => {
          // CONFORMANCE_PROOF: this comment must not upgrade proof strength.
          const response = await client.get('/agent/value');
          expect(response.data).toEqual({ ok: true });
        });
      `).proofLevel,
    ).toBe('behavioral');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('checks a structured provider usage payload', async () => {
          const span = runAssistantOutputSpan(result, 'session')?.[0];
          expect(span).toMatchObject({
            input_tokens: 7,
            output_tokens: 8,
            total_tokens: 15,
            cost_usd: 0.03,
          });
        });
      `).proofLevel,
    ).toBe('behavioral');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('keeps scenario markers separate from proof strength', async () => {
          await client.get('/agent/metrics');
          expect(['SCENARIO_PROOF: backend-dashboard-metrics']).toEqual(
            expect.arrayContaining(['SCENARIO_PROOF: backend-dashboard-metrics']),
          );
          expect(status).toBeDefined();
        });
      `).proofLevel,
    ).toBe('smoke');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('does not treat data container presence as behavior', async () => {
          const response = await client.get('/agent/metrics');
          expect(response.status).toBe(200);
          expect(response.data).toBeDefined();
        });
      `).proofLevel,
    ).toBe('smoke');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('treats response data fields as behavior', async () => {
          const response = await client.get('/agent/metrics');
          expect(response.status).toBe(200);
          expect(response.data.agent.total_agents).toBeGreaterThanOrEqual(1);
        });
      `).proofLevel,
    ).toBe('behavioral');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('CONFORMANCE: title alone with status assertions is not proof', async () => {
          const response = await client.get('/agent/metrics');
          expect(response.status).toBe(200);
          expect(response.data).toBeDefined();
        });
      `).proofLevel,
    ).toBe('smoke');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('CONFORMANCE: title alone with behavior assertions is behavioral only', async () => {
          const response = await client.get('/agent/metrics');
          expect(response.status).toBe(200);
          expect(response.data.agent.total_agents).toBeGreaterThanOrEqual(1);
        });
      `).proofLevel,
    ).toBe('behavioral');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('CONFORMANCE: checks generated conformance fixture', async () => {
          const fixture = makeOpaVerdictMatrixConformanceCase();
          const operation = coreOperation(fixture.evaluateOperationId);
          expect(operation.verb).toBe('post');
        });
      `).proofLevel,
    ).toBe('conformance');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('NEGATIVE: admin route rejects API-key transport', async () => {
          const response = await client.get('/sso');
          expect(response.data.status).toBe(401);
          expect(response.data.message).toContain('requires JWT authentication');
        });
      `).proofLevel,
    ).toBe('conformance');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('NEGATIVE_BOUNDARY_PROOF: rejects invalid finite member', async () => {
          const response = await client.post('/guardrails/run-test', { guardrail_type: 'nope' });
          expect(response.data.status).toBe(422);
        });
      `).proofLevel,
    ).toBe('negative-path');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('does not treat conditional skips as behavior', async () => {
          const response = await client.get('/agent/sessions');
          if (response.data.data.length === 0) {
            console.log('No sessions found, skipping session detail tests');
            return;
          }
          expect(response.data.data[0].id).toBeDefined();
        });
      `).proofLevel,
    ).toBe('smoke');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('does not treat mixed status allowances as behavior', async () => {
          const response = await client.get('/user/roles');
          const body = response.data;
          expect([200, 403]).toContain(body.status);
          if (body.status === 200) {
            expect(Array.isArray(body.data)).toBe(true);
          }
        });
      `).proofLevel,
    ).toBe('smoke');

    expect(
      classifyLocalStackTestBlockForTesting(`
        it('treats failure-only status allowances as negative-path proof', async () => {
          const response = await client.get('/agent/deleted');
          const body = response.data;
          expect([403, 404]).toContain(body.status);
        });
      `).proofLevel,
    ).toBe('negative-path');
  });
});

describe('local-stack scenario evidence helpers', () => {
  it('keeps scenario proof metadata separate from asserted evidence', () => {
    expect(
      localStackBlockIncludesEvidencePatternForTesting(
        `
          it('keeps evidence separate from scenario markers', async () => {
            await client.get('/agent/metrics');
            expect([
              'SCENARIO_PROOF: backend-dashboard-metrics',
              'total_cost_usd',
            ]).toEqual(expect.arrayContaining([
              'SCENARIO_PROOF: backend-dashboard-metrics',
              'total_cost_usd',
            ]));
            expect(status).toBeDefined();
          });
        `,
        'total_cost_usd',
      ),
    ).toBe(false);

    expect(
      localStackBlockIncludesEvidencePatternForTesting(
        `
          it('asserts the real usage field', async () => {
            const response = await client.get('/agent/metrics');
            expect(['SCENARIO_PROOF: backend-dashboard-metrics']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: backend-dashboard-metrics']),
            );
            expect(response.data.total_cost_usd).toBeGreaterThanOrEqual(0);
          });
        `,
        'total_cost_usd',
      ),
    ).toBe(true);

    expect(
      localStackTestBlockIncludesEvidencePatternForTesting(
        'mentions total_cost_usd only in the test title',
        `
          it('mentions total_cost_usd only in the test title', async () => {
            const response = await client.get('/agent/metrics');
            expect(response.status).toBe(200);
          });
        `,
        'total_cost_usd',
      ),
    ).toBe(false);
  });

  it('requires non-marker assertions before counting scenario evidence', () => {
    expect(
      localStackBlockHasScenarioEvidenceForTesting(
        `
          it('marks a scenario without carrying its evidence', async () => {
            await client.get('/agent/metrics');
            expect(['SCENARIO_PROOF: backend-dashboard-metrics']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: backend-dashboard-metrics']),
            );
            expect(status).toBe(200);
          });
        `,
        ['total_cost_usd'],
      ),
    ).toBe(false);

    expect(
      localStackBlockHasScenarioEvidenceForTesting(
        `
          it('marks a scenario and asserts real evidence', async () => {
            await client.get('/agent/metrics');
            expect(['SCENARIO_PROOF: backend-dashboard-metrics']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: backend-dashboard-metrics']),
            );
            const response = { data: { total_cost_usd: 0 } };
            expect(response.data.total_cost_usd).toBeGreaterThanOrEqual(0);
          });
        `,
        ['total_cost_usd'],
      ),
    ).toBe(true);

    expect(
      localStackBlockHasScenarioEvidenceForTesting(
        `
          it('keeps generated conformance evidence tied to a scenario marker', async () => {
            expect(['SCENARIO_PROOF: opa-allow']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: opa-allow']),
            );
            const cases = makeEvaluateRegoConformanceCase({
              operation: { verb: 'post' },
            });
            expect(cases[0].operation.verb).toBe('post');
          });
        `,
        ['allow = true'],
      ),
    ).toBe(true);
  });

  it('matches scenario proof markers by exact scenario id', () => {
    expect(
      localStackBlockIncludesScenarioMarkerForTesting(
        `
          it('uses exact marker ids', async () => {
            expect(['SCENARIO_PROOF: trace-logs']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: trace-logs']),
            );
          });
        `,
        'SCENARIO_PROOF: trace-logs',
      ),
    ).toBe(true);

    expect(
      localStackBlockIncludesScenarioMarkerForTesting(
        `
          it('does not allow prefix marker matches', async () => {
            expect(['SCENARIO_PROOF: trace-logs-extra']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: trace-logs-extra']),
            );
          });
        `,
        'SCENARIO_PROOF: trace-logs',
      ),
    ).toBe(false);

    expect(
      localStackBlockIncludesScenarioMarkerForTesting(
        `
          it('does not allow suffix marker matches', async () => {
            expect(['SCENARIO_PROOF: pre-trace-logs']).toEqual(
              expect.arrayContaining(['SCENARIO_PROOF: pre-trace-logs']),
            );
          });
        `,
        'SCENARIO_PROOF: trace-logs',
      ),
    ).toBe(false);
  });

  it('surfaces executable scenario proof markers outside the generated matrix', () => {
    expect(
      unknownScenarioProofMarkerRefsForTesting(
        `
          it('contains one real and one stale scenario marker', async () => {
            // SCENARIO_PROOF: comment-only-unknown
            expect([
              'SCENARIO_PROOF: trace-logs',
              'SCENARIO_PROOF: stale-trace-logz',
            ]).toEqual(expect.arrayContaining(['SCENARIO_PROOF: trace-logs']));
          });
        `,
        ['trace-logs'],
      ),
    ).toEqual(['stale-trace-logz:__test__.ts#__test__']);
  });
});

describe('local-stack call extraction helpers', () => {
  it('extracts executable operation hits only', () => {
    const calls = extractLocalStackCallsForTesting(
      `
        it('keeps executable endpoint calls only', async () => {
          // await client.get('/api-key');
          /*
           * await client.delete('/sso');
           */
          const fakeCall = "client.post('/api-key')";
          const fakeTemplate = \`client.patch('/webhook/value')\`;
          const docsUrl = 'https://example.invalid/openbox';
          await client.get('/auth/profile');
          await client.get(\`/agent/\${agentId}/sessions\`);
          expect(fakeCall).toContain('/api-key');
          expect(fakeTemplate).toContain('/webhook');
          expect(docsUrl).toContain('https://');
        });
      `,
      'tests/e2e/comment-proof.test.ts',
    );

    expect(calls.map((call) => call.call)).toEqual([
      'client.get(/auth/profile)',
      'client.get(/agent/${value}/sessions)',
    ]);
  });

  it('extracts operation-backed template calls built from operationPath', () => {
    const calls = extractLocalStackCallsForTesting(
      `
        it('proves generated operation-backed query boundaries', async () => {
          const semanticGapOperation = backendOperation('AgentController_getAgentEvaluations');
          await client.get(
            \`\${operationPath(semanticGapOperation.path, params)}?page=-1\`,
          );
        });
      `,
      'tests/e2e/request-query-boundaries.test.ts',
    );

    expect(calls).toEqual([
      expect.objectContaining({
        operationId: 'AgentController_getAgentEvaluations',
        call: 'client.get(operationPath(semanticGapOperation.path))',
      }),
    ]);
  });

  it('ignores skipped describe scopes', () => {
    const blocks = extractLocalStackTestBlocksForTesting(`
      describe.skip('disabled local stack scope', () => {
        it('would otherwise look like conformance', async () => {
          await client.get('/api-key');
          expect(true).toBe(true);
        });
      });

      describe('enabled local stack scope', () => {
        it('executes real conformance', async () => {
          await client.get('/auth/profile');
          expect(true).toBe(true);
        });
      });
    `);

    expect(blocks.map((block) => block.name)).toEqual(['executes real conformance']);
  });

  it('extracts isolated e2e wrapper test blocks', () => {
    const blocks = extractLocalStackTestBlocksForTesting(`
      itIfIsolatedOpaUnavailable('CONFORMANCE: fails closed when OPA is unavailable', async () => {
        expect(['SCENARIO_PROOF: opa-unavailable-fail-closed']).toEqual(
          expect.arrayContaining(['SCENARIO_PROOF: opa-unavailable-fail-closed']),
        );
        await coreClient.post(evaluateOperation.path, event);
      });
    `);

    expect(blocks.map((block) => block.name)).toEqual([
      'CONFORMANCE: fails closed when OPA is unavailable',
    ]);
    expect(
      localStackBlockIncludesScenarioMarkerForTesting(
        blocks[0]?.source ?? '',
        'SCENARIO_PROOF: opa-unavailable-fail-closed',
      ),
    ).toBe(true);
  });

  it('only extracts generated SDK method calls from wrapper-client targets', () => {
    expect(
      extractLocalStackCallsForTesting(
        `
          it('uses the generated client', async () => {
            await client.createAgent({});
            await fakeClient.createAgent({});
          });
        `,
        'tests/e2e/openbox-client.test.ts',
      ).map((call) => call.call),
    ).toEqual(['client.createAgent()']);

    expect(
      extractLocalStackCallsForTesting(
        `
          it('has helper methods with generated names', async () => {
            await client.createAgent({});
            await helper.listAgents();
          });
        `,
        'tests/e2e/not-the-wrapper-client.test.ts',
      ),
    ).toEqual([]);
  });
});

describe('backend/Core remediation reference helpers', () => {
  it('rejects refs outside canonical service-owned file refs', () => {
    expect(
      backendCoreGapRemediationRefRefsForTesting(
        [
          {
            gapId: 'missing-ref-gap',
            services: ['backend'],
            remediationRefs: [],
          },
          {
            gapId: 'invalid-ref-gap',
            services: ['backend'],
            remediationRefs: [
              'openbox-api:src/modules/agent/controller.ts:1',
              'openbox-backend:src/modules/agent/controller.ts',
            ],
          },
          {
            gapId: 'service-mismatch-gap',
            services: ['core'],
            remediationRefs: ['openbox-backend:src/modules/agent/controller.ts:277'],
          },
          {
            gapId: 'duplicate-ref-gap',
            services: ['backend'],
            remediationRefs: [
              'openbox-backend:src/modules/agent/controller.ts:277',
              'openbox-backend:src/modules/agent/controller.ts:277',
            ],
          },
        ],
        {
          backend: '/tmp/openbox-missing-backend',
          core: '/tmp/openbox-missing-core',
        },
      ),
    ).toEqual({
      missingBackendCoreGapRemediationRefRefs: ['missing-ref-gap'],
      invalidBackendCoreGapRemediationRefRefs: [
        'invalid-ref-gap:openbox-api:src/modules/agent/controller.ts:1',
        'invalid-ref-gap:openbox-backend:src/modules/agent/controller.ts',
      ],
      serviceMismatchBackendCoreGapRemediationRefRefs: [
        'service-mismatch-gap:openbox-backend:src/modules/agent/controller.ts:277',
      ],
      duplicateBackendCoreGapRemediationRefRefs: [
        'duplicate-ref-gap:openbox-backend:src/modules/agent/controller.ts:277',
      ],
      missingBackendCoreGapRemediationFileRefs: [],
      invalidBackendCoreGapRemediationLineRefs: [],
      remediationRepositoryStatuses: [
        {
          service: 'backend',
          repositoryRoot: '/tmp/openbox-missing-backend',
          status: 'missing',
        },
        {
          service: 'core',
          repositoryRoot: '/tmp/openbox-missing-core',
          status: 'missing',
        },
      ],
    });
  });

  it('validates refs against available local repositories', () => {
    const root = mkdtempSync(join(tmpdir(), 'openbox-remediation-refs-'));
    const backendRoot = join(root, 'openbox-backend');
    const coreRoot = join(root, 'openbox-core');
    mkdirSync(join(backendRoot, 'src/modules/agent'), { recursive: true });
    mkdirSync(join(coreRoot, 'internal/api'), { recursive: true });
    writeFileSync(
      join(backendRoot, 'src/modules/agent/controller.ts'),
      ['line 1', 'line 2', 'line 3'].join('\n'),
    );
    writeFileSync(
      join(coreRoot, 'internal/api/governance.go'),
      ['line 1', 'line 2'].join('\n'),
    );

    expect(
      backendCoreGapRemediationRefRefsForTesting(
        [
          {
            gapId: 'valid-gap',
            services: ['backend'],
            remediationRefs: ['openbox-backend:src/modules/agent/controller.ts:2'],
          },
          {
            gapId: 'missing-file-gap',
            services: ['backend'],
            remediationRefs: ['openbox-backend:src/modules/agent/missing.ts:1'],
          },
          {
            gapId: 'invalid-line-gap',
            services: ['core'],
            remediationRefs: ['openbox-core:internal/api/governance.go:3'],
          },
        ],
        {
          backend: backendRoot,
          core: coreRoot,
        },
      ),
    ).toMatchObject({
      missingBackendCoreGapRemediationRefRefs: [],
      invalidBackendCoreGapRemediationRefRefs: [],
      serviceMismatchBackendCoreGapRemediationRefRefs: [],
      duplicateBackendCoreGapRemediationRefRefs: [],
      missingBackendCoreGapRemediationFileRefs: [
        'missing-file-gap:openbox-backend:src/modules/agent/missing.ts:1',
      ],
      invalidBackendCoreGapRemediationLineRefs: [
        'invalid-line-gap:openbox-core:internal/api/governance.go:3',
      ],
      remediationRepositoryStatuses: [
        { service: 'backend', repositoryRoot: backendRoot, status: 'available' },
        { service: 'core', repositoryRoot: coreRoot, status: 'available' },
      ],
    });
  });
});

describe('provider guard reference helpers', () => {
  it('matches only exact behavioral test titles', () => {
    const behavioralBlock = {
      file: 'tests/unit/provider.test.ts',
      name: 'maps approval-required verdicts to fail-closed behavior plus extra coverage',
      source: `
        it('maps approval-required verdicts to fail-closed behavior plus extra coverage', async () => {
          const response = await runProviderGuard();
          expect(response.data.verdict).toBe('require_approval');
        });
      `,
    };

    expect(
      providerGuardTestRefMatchesBlockForTesting(
        'tests/unit/provider.test.ts#maps approval-required verdicts to fail-closed behavior',
        behavioralBlock,
      ),
    ).toBe(false);
    expect(
      providerGuardTestRefMatchesBlockForTesting(
        'tests/unit/provider.test.ts#maps approval-required verdicts to fail-closed behavior plus extra coverage',
        behavioralBlock,
      ),
    ).toBe(true);

    expect(
      providerGuardTestRefMatchesBlockForTesting(
        'tests/unit/provider.test.ts#status only provider guard',
        {
          file: 'tests/unit/provider.test.ts',
          name: 'status only provider guard',
          source: `
            it('status only provider guard', async () => {
              const response = await runProviderGuard();
              expect(response.status).toBe(200);
            });
          `,
        },
      ),
    ).toBe(false);
  });
});
