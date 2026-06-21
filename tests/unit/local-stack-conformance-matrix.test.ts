import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLocalStackConformanceMatrix,
  classifyLocalStackTestBlockForTesting,
  extractLocalStackCallsForTesting,
  extractLocalStackTestBlocksForTesting,
  localStackBlockHasScenarioEvidenceForTesting,
  localStackBlockIncludesScenarioMarkerForTesting,
  localStackBlockIncludesEvidencePatternForTesting,
  localStackTestBlockIncludesEvidencePatternForTesting,
  providerCapabilityDomainRefsForTesting,
  providerGuardTestRefMatchesBlockForTesting,
  unknownScenarioProofMarkerRefsForTesting,
  type LocalStackConformanceMatrix,
  type OperationCoverage,
} from '../helpers/local-stack-conformance';

function operation(
  matrix: LocalStackConformanceMatrix,
  operationId: string,
): OperationCoverage {
  const found = matrix.operations.find((entry) => entry.operation.operationId === operationId);
  expect(found, operationId).toBeDefined();
  return found!;
}

function objective(matrix: LocalStackConformanceMatrix, id: string) {
  const found = matrix.objectives.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

function outcome(matrix: LocalStackConformanceMatrix, id: string) {
  const found = matrix.outcomes.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

function scenario(matrix: LocalStackConformanceMatrix, id: string) {
  const found = matrix.scenarioPaths.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

const providerCapabilitiesFixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'codegen/fixtures/provider-capabilities.json'), 'utf8'),
) as {
  capabilityIds: string[];
  providerIds: string[];
  supportTiers: string[];
};

describe('local-stack conformance matrix', () => {
  const matrix = buildLocalStackConformanceMatrix();
  const providerDomains = {
    capabilityIds: providerCapabilitiesFixture.capabilityIds,
    providerIds: providerCapabilitiesFixture.providerIds,
    supportTiers: providerCapabilitiesFixture.supportTiers,
  };

  it('is derived from generated TypeSpec fixtures and current e2e files', () => {
    expect(matrix.generatedBy).toBe('tests/helpers/local-stack-conformance.ts');
    expect(matrix.sources).toEqual(
      expect.arrayContaining([
        'specs/typespec/backend/main.tsp',
        'specs/typespec/core/main.tsp',
        'specs/typespec/govern/capabilities.tsp',
        'tests/e2e/**/*.test.ts',
        'tests/unit/request-preflight-conformance.test.ts',
        'python/tests/test_request_preflight.py',
        'python/openbox_sdk/generated/request_preflight.py',
        'tests/helpers/finite-domain-conformance.ts',
        'tests/helpers/boundary-conformance.ts',
      ]),
    );
    expect(matrix.summary.totalOperations).toBe(143);
    expect(matrix.summary.operationsWithBehavioralOrBetterHits).toBe(143);
    expect(matrix.summary.operationsWithoutE2eHits).toBe(0);
    expect(matrix.summary.smokeOnlyOperations).toBe(0);
    expect(matrix.summary.knownSemanticGaps).toBe(5);
    expect(matrix.summary.sdkSemanticGapClosures).toEqual({
      total: 10,
      proven: 10,
      missing: 0,
    });
    expect(matrix.scenarioMatrix.id).toBe('backend-core-governance-full-matrix');
    expect(matrix.scenarioMatrix.status).toBe('proven');
    expect(matrix.scenarioMatrix.duplicateOperationIdRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateServiceOperationIdRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateOperationRouteRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateOperationPathPatternRefs).toEqual([]);
    expect(matrix.scenarioMatrix.operationRouteResolutionMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.ambiguousOperationRouteTieRefs).toEqual([]);
    expect(matrix.unknownHits).toEqual([]);
  });

  it('distinguishes endpoint smoke from behavioral local-stack proof', () => {
    expect(operation(matrix, 'AppController_getHello').proofLevel).toBe('behavioral');
    expect(operation(matrix, 'AgentController_createAgent').proofLevel).toBe('conformance');
    expect(operation(matrix, 'PolicyController_evaluate').proofLevel).toBe('conformance');

    expect(operation(matrix, 'GuardrailController_runTest').proofLevel).toBe('conformance');
  });

  it('does not promote proof strength from comment-only markers', () => {
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

  it('does not treat scenario proof metadata as scenario evidence', () => {
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

  it('does not count marker-only scenario blocks as scenario evidence', () => {
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

  it('surfaces executable scenario proof markers that do not exist in the generated matrix', () => {
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

  it('fails generated capability provider and tier references outside canonical domains', () => {
    const refs = providerCapabilityDomainRefsForTesting({
      contract: {
        ...matrix.scenarioMatrix,
        requiredCapabilities: [
          ...matrix.scenarioMatrix.requiredCapabilities,
          'capability-domain-drift',
        ],
        requiredSharedProviderGuardProofCapabilities: [
          ...matrix.scenarioMatrix.requiredSharedProviderGuardProofCapabilities,
          'shared-provider-guard-domain-drift',
        ],
        requiredOutcomeSpecs: [
          ...matrix.scenarioMatrix.requiredOutcomeSpecs,
          {
            ...matrix.scenarioMatrix.requiredOutcomeSpecs[0],
            id: 'domain-drift-outcome-spec',
            providerGuardCapabilities: ['outcome-provider-guard-domain-drift'],
            exceptionCapabilities: ['outcome-exception-domain-drift'],
          },
        ],
      },
      scenarioPaths: [
        ...matrix.scenarioPaths,
        { id: 'domain-drift-scenario', capability: 'scenario-capability-domain-drift' },
      ],
      outcomes: [
        ...matrix.outcomes,
        {
          id: 'domain-drift-outcome',
          providerGuardCapabilities: ['outcome-capability-domain-drift'],
          exceptionCapabilities: ['outcome-exception-domain-drift'],
        },
      ],
      providerGuards: [
        ...matrix.providerGuards,
        {
          capability: 'provider-guard-capability-domain-drift',
          providers: ['provider-domain-drift'],
          guardProviderTiers: [
            { provider: 'guard-tier-provider-domain-drift', tier: 'guard-tier-domain-drift' },
          ],
          matrixProviderTiers: [
            { provider: 'matrix-provider-domain-drift', tier: 'matrix-tier-domain-drift' },
          ],
        },
      ],
      providerDomains,
    });

    expect(refs).toEqual({
      unknownScenarioCapabilityRefs: [
        'domain-drift-scenario:scenario-capability-domain-drift',
      ],
      unknownOutcomeCapabilityRefs: [
        'domain-drift-outcome:exceptionCapabilities:outcome-exception-domain-drift',
        'domain-drift-outcome:providerGuardCapabilities:outcome-capability-domain-drift',
      ],
      unknownScenarioMatrixCapabilityRefs: [
        'requiredCapabilities:capability-domain-drift',
        'requiredOutcomeSpecs:domain-drift-outcome-spec:exceptionCapabilities:outcome-exception-domain-drift',
        'requiredOutcomeSpecs:domain-drift-outcome-spec:providerGuardCapabilities:outcome-provider-guard-domain-drift',
        'requiredSharedProviderGuardProofCapabilities:shared-provider-guard-domain-drift',
      ],
      unknownProviderGuardCapabilityRefs: ['provider-guard-capability-domain-drift'],
      unknownProviderGuardProviderRefs: [
        'provider-guard-capability-domain-drift:guard:provider-domain-drift',
        'provider-guard-capability-domain-drift:guardTier:guard-tier-provider-domain-drift',
        'provider-guard-capability-domain-drift:matrix:matrix-provider-domain-drift',
      ],
      unknownProviderGuardTierRefs: [
        'provider-guard-capability-domain-drift:guard:guard-tier-provider-domain-drift:guard-tier-domain-drift',
        'provider-guard-capability-domain-drift:matrix:matrix-provider-domain-drift:matrix-tier-domain-drift',
      ],
    });
  });

  it('does not extract operation hits from commented-out calls', () => {
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

  it('resolves overlapping generated routes to the most specific operation', () => {
    expect(operation(matrix, 'AgentController_getAgentsMetrics').operation.path).toBe(
      '/agent/metrics',
    );
    expect(operation(matrix, 'AgentController_getAgent').operation.pathPattern).toBe('/agent/{x}');
    expect(matrix.scenarioMatrix.operationRouteResolutionMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.ambiguousOperationRouteTieRefs).toEqual([]);
  });

  it('does not extract test blocks from skipped describe scopes', () => {
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

  it('ties local-stack scenario evidence to blocks that hit required operations', () => {
    for (const scenarioPath of matrix.scenarioPaths) {
      if (!scenarioPath.localStackRequired || scenarioPath.operationIds.length === 0) continue;
      const operationHitBlockKeys = new Set(
        matrix.operations
          .filter((entry) => scenarioPath.operationIds.includes(entry.operation.operationId))
          .flatMap((entry) => entry.hits.map((hit) => `${hit.file}\0${hit.testName}`)),
      );

      expect(scenarioPath.proofBlockKeys.length, scenarioPath.id).toBeGreaterThan(0);
      expect(scenarioPath.missingScenarioProofMarker, scenarioPath.id).toBe(false);
      expect(scenarioPath.scenarioProofMarker, scenarioPath.id).toBe(
        `SCENARIO_PROOF: ${scenarioPath.id}`,
      );
      expect(scenarioPath.scenarioProofMarkerBlockKeys.length, scenarioPath.id).toBeGreaterThan(0);
      expect(
        scenarioPath.markerOnlyProofBlockKeys.every((blockKey) =>
          scenarioPath.scenarioProofMarkerBlockKeys.includes(blockKey),
        ),
        scenarioPath.id,
      ).toBe(true);
      expect(
        scenarioPath.proofBlockKeys.every((blockKey) =>
          scenarioPath.scenarioProofMarkerBlockKeys.includes(blockKey),
        ),
        scenarioPath.id,
      ).toBe(true);
      expect(
        scenarioPath.proofBlockKeys.every((blockKey) =>
          !scenarioPath.markerOnlyProofBlockKeys.includes(blockKey),
        ),
        scenarioPath.id,
      ).toBe(true);
      expect(
        scenarioPath.proofBlockKeys.every((blockKey) => operationHitBlockKeys.has(blockKey)),
        scenarioPath.id,
      ).toBe(true);
      expect(scenarioPath.operationProofs.map((entry) => entry.operationId).sort(), scenarioPath.id).toEqual(
        [...scenarioPath.operationIds].sort(),
      );
      expect(scenarioPath.duplicateScenarioOperationIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.duplicateScenarioAxisIds, scenarioPath.id).toEqual([]);
      expect(
        (scenarioPath.operationEvidencePatterns ?? []).map((entry) => entry.operationId).sort(),
        scenarioPath.id,
      ).toEqual([...scenarioPath.operationIds].sort());
      expect(new Set((scenarioPath.operationEvidencePatterns ?? []).map((entry) => entry.operationId)).size, scenarioPath.id).toBe(
        scenarioPath.operationIds.length,
      );
      expect(scenarioPath.missingOperationEvidencePatternIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.unknownOperationEvidencePatternIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.duplicateOperationEvidencePatternIds, scenarioPath.id).toEqual([]);
      for (const evidence of scenarioPath.evidencePatternBlockKeys) {
        expect(evidence.blockKeys.length, `${scenarioPath.id}:${evidence.pattern}`).toBeGreaterThan(0);
        expect(
          evidence.blockKeys.every((blockKey) => scenarioPath.proofBlockKeys.includes(blockKey)),
          `${scenarioPath.id}:${evidence.pattern}`,
        ).toBe(true);
      }
      expect(scenarioPath.missingAssertedEvidence, scenarioPath.id).toBe(false);
      expect([...scenarioPath.assertedEvidencePatterns].sort(), scenarioPath.id).toEqual(
        [...scenarioPath.evidencePatterns].sort(),
      );
      expect(scenarioPath.weakEvidencePatterns, scenarioPath.id).toEqual([]);
      for (const evidence of scenarioPath.assertedEvidencePatternBlockKeys) {
        expect(
          evidence.blockKeys.every((blockKey) => scenarioPath.proofBlockKeys.includes(blockKey)),
          `${scenarioPath.id}:${evidence.pattern}`,
        ).toBe(true);
      }
      for (const operationProof of scenarioPath.operationProofs) {
        expect(operationProof.missingProofBlock, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.underProven, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.missingEvidence, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.missingAssertedEvidence, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.proofBlockKeys.length, `${scenarioPath.id}:${operationProof.operationId}`).toBeGreaterThan(0);
        expect(
          operationProof.proofBlockKeys.every((blockKey) => scenarioPath.proofBlockKeys.includes(blockKey)),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        expect(
          operationProof.proofBlockKeys.every((blockKey) => operationHitBlockKeys.has(blockKey)),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        expect(
          operationProof.requiredEvidencePatterns.length > 0,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        expect(
          operationProof.missingEvidencePatterns,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([]);
        expect(
          operationProof.matchedEvidencePatterns.sort(),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([...operationProof.requiredEvidencePatterns].sort());
        expect(
          [...operationProof.assertedEvidencePatterns].sort(),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([...operationProof.requiredEvidencePatterns].sort());
        expect(
          operationProof.weakEvidencePatterns,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([]);
        expect(
          operationProof.generatedConformanceBlockKeys.every((blockKey) =>
            operationProof.proofBlockKeys.includes(blockKey),
          ),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        for (const evidence of operationProof.evidencePatternBlockKeys) {
          expect(
            evidence.blockKeys.length,
            `${scenarioPath.id}:${operationProof.operationId}:${evidence.pattern}`,
          ).toBeGreaterThan(0);
          expect(
            evidence.blockKeys.every((blockKey) => operationProof.proofBlockKeys.includes(blockKey)),
            `${scenarioPath.id}:${operationProof.operationId}:${evidence.pattern}`,
          ).toBe(true);
        }
        for (const evidence of operationProof.assertedEvidencePatternBlockKeys) {
          expect(
            evidence.blockKeys.every((blockKey) => operationProof.proofBlockKeys.includes(blockKey)),
            `${scenarioPath.id}:${operationProof.operationId}:${evidence.pattern}`,
          ).toBe(true);
        }
      }
      for (const operationId of scenarioPath.operationIds) {
        const operationCoverage = operation(matrix, operationId);
        expect(
          operationCoverage.hits.some((hit) => {
            const proofOrder = {
              none: 0,
              smoke: 1,
              'negative-path': 2,
              behavioral: 3,
              conformance: 4,
            } as const;
            return (
              scenarioPath.proofBlockKeys.includes(`${hit.file}\0${hit.testName}`) &&
              proofOrder[hit.proofLevel] >= proofOrder[scenarioPath.requiredProofLevel]
            );
          }),
          `${scenarioPath.id}:${operationId}`,
        ).toBe(true);
      }
      expect(scenarioPath.proofOperationIds, scenarioPath.id).toEqual(
        [...scenarioPath.operationIds].sort(),
      );
      expect(scenarioPath.missingProofOperationIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.missingOperationEvidenceIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.missingAssertedOperationEvidenceIds, scenarioPath.id).toEqual([]);
    }
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

  it('proves every core governance operation with behavioral or conformance evidence', () => {
    const core = objective(matrix, 'core-governance');
    expect(core.operationCount).toBe(4);
    expect(core.missingOperationIds).toEqual([]);
    expect(core.proofCounts.conformance).toBeGreaterThan(0);
    expect(core.behavioralOrBetterOperationIds).toEqual(
      expect.arrayContaining(['validateApiKey', 'evaluateGovernance', 'pollApproval']),
    );
  });

  it('proves every requested governance objective operation beyond endpoint smoke', () => {
    const guardrails = objective(matrix, 'backend-guardrails');
    const policies = objective(matrix, 'backend-policies');
    const approvals = objective(matrix, 'backend-approvals-hitl');

    expect(guardrails.operationCount).toBeGreaterThan(0);
    expect(guardrails.smokeOnlyOperationIds).not.toContain('GuardrailController_runTest');
    expect(guardrails.proofCounts.conformance).toBeGreaterThan(0);

    expect(policies.operationCount).toBeGreaterThan(0);
    expect(policies.proofCounts.conformance).toBeGreaterThan(0);
    expect(policies.smokeOnlyOperationIds).toEqual([]);

    expect(approvals.operationCount).toBeGreaterThan(0);
    expect(approvals.proofCounts.conformance).toBeGreaterThan(0);
    expect(approvals.behavioralOrBetterOperationIds).toEqual(
      expect.arrayContaining([
        'AgentController_decideApproval',
        'AgentController_getApprovalHistory',
        'AgentController_getPendingApprovals',
        'OrganizationController_getApprovals',
      ]),
    );
  });

  it('surfaces known finite and boundary semantic gaps in the matrix summary', () => {
    expect(matrix.semanticGaps).toEqual([
      expect.objectContaining({
        id: 'approval-status-invalid-query-not-rejected',
        source: 'finite-domain-ledger',
        domainKeys: ['approvalStatuses'],
        operationIds: [
          'AgentController_getApprovalHistory',
          'AgentController_getPendingApprovals',
          'OrganizationController_getApprovals',
        ],
        proofFile: 'tests/e2e/approvals.test.ts',
        observedBehavior: expect.stringContaining('accepts out-of-domain approval status'),
        requiredBehavior: expect.stringContaining('should reject out-of-domain values'),
      }),
      expect.objectContaining({
        id: 'backend-agent-evaluations-query-boundaries-not-rejected',
        source: 'boundary-ledger',
        domainKeys: [],
        operationIds: ['AgentController_getAgentEvaluations'],
        proofFile: 'tests/e2e/request-query-boundaries.test.ts',
        observedBehavior: expect.stringContaining('accepts AgentController_getAgentEvaluations'),
        requiredBehavior: expect.stringContaining('query.page'),
      }),
      expect.objectContaining({
        id: 'core-governance-attempt-min-not-rejected',
        source: 'boundary-ledger',
        domainKeys: ['coreNumericFields'],
        operationIds: ['evaluateGovernance'],
        proofFile: 'tests/e2e/core-governance.test.ts',
        observedBehavior: expect.stringContaining('accepts GovernanceEventPayload.attempt=0'),
        requiredBehavior: expect.stringContaining('@minValue(1)'),
      }),
      expect.objectContaining({
        id: 'core-governance-cost-type-not-rejected',
        source: 'boundary-ledger',
        domainKeys: [],
        operationIds: ['evaluateGovernance'],
        proofFile: 'tests/e2e/core-governance.test.ts',
        observedBehavior: expect.stringContaining('accepts GovernanceEventPayload.cost_usd'),
        requiredBehavior: expect.stringContaining('type=number format=double'),
      }),
      expect.objectContaining({
        id: 'core-governance-timestamp-format-not-rejected',
        source: 'boundary-ledger',
        domainKeys: [],
        operationIds: ['evaluateGovernance'],
        proofFile: 'tests/e2e/core-governance.test.ts',
        observedBehavior: expect.stringContaining('accepts GovernanceEventPayload.timestamp'),
        requiredBehavior: expect.stringContaining('format=date-time'),
      }),
    ]);
  });

  it('proves every raw semantic gap has TypeScript and Python SDK preflight closure evidence', () => {
    expect(matrix.sdkSemanticGapClosures).toHaveLength(matrix.semanticGaps.length * 2);
    expect(matrix.sdkSemanticGapClosures.every((entry) => entry.status === 'proven')).toBe(true);
    expect(matrix.sdkSemanticGapClosures.flatMap((entry) => entry.missingOperationIds)).toEqual([]);
    expect(matrix.sdkSemanticGapClosures.flatMap((entry) => entry.missingEvidencePatterns)).toEqual([]);

    for (const gap of matrix.semanticGaps) {
      expect(matrix.sdkSemanticGapClosures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            semanticGapId: gap.id,
            sdkTarget: 'typescript',
            operationIds: gap.operationIds,
            proofFiles: expect.arrayContaining([
              'tests/helpers/request-constraint-conformance.ts',
              'tests/unit/request-constraint-conformance.test.ts',
              'tests/unit/request-preflight-conformance.test.ts',
            ]),
          }),
          expect.objectContaining({
            semanticGapId: gap.id,
            sdkTarget: 'python',
            operationIds: gap.operationIds,
            proofFiles: expect.arrayContaining([
              'python/openbox_sdk/generated/request_preflight.py',
              'python/tests/test_request_preflight.py',
            ]),
          }),
        ]),
      );
    }
  });

  it('ties every raw semantic gap proof to its affected generated operations', () => {
    for (const gap of matrix.semanticGaps) {
      const proofOperationIds = matrix.operations
        .filter((entry) => gap.operationIds.includes(entry.operation.operationId))
        .filter((entry) =>
          entry.hits.some((hit) =>
            hit.file === gap.proofFile && hit.testName.includes(gap.evidencePattern),
          ),
        )
        .map((entry) => entry.operation.operationId)
        .sort();

      expect(gap.evidencePattern.length, gap.id).toBeGreaterThan(0);
      expect(gap.operationIds.length, gap.id).toBeGreaterThan(0);
      expect(proofOperationIds, gap.id).toEqual(gap.operationIds);
    }
  });

  it('links provider parity areas to their generated guard-test evidence', () => {
    expect(matrix.providerGuards.map((entry) => entry.capability).sort()).toEqual([
      'approvals-hitl',
      'guardrails',
      'opa-rules',
      'tracing',
      'usage-cost',
    ]);

    for (const guard of matrix.providerGuards) {
      expect(guard.guardCount, guard.capability).toBeGreaterThan(0);
      expect(guard.providers.length, guard.capability).toBeGreaterThan(0);
      expect(guard.providers, guard.capability).toEqual(guard.matrixProviders);
      expect(
        guard.matrixProviderTiers.map((entry) => entry.provider),
        guard.capability,
      ).toEqual(guard.matrixProviders);
      expect(guard.missingProviderCapabilityGuardProviders, guard.capability).toEqual([]);
      expect(guard.unexpectedProviderCapabilityGuardProviders, guard.capability).toEqual([]);
      expect(guard.providerTierMismatchRefs, guard.capability).toEqual([]);
      expect(guard.duplicateProviderCapabilityGuardProviderRefs, guard.capability).toEqual([]);
      expect(guard.guardCount, guard.capability).toBe(guard.providers.length);
      expect(guard.guardTestRefs.length, guard.capability).toBe(guard.guardCount);
      expect(guard.guardTests.length, guard.capability).toBeGreaterThan(0);
      expect(guard.missingGuardTestRefs, guard.capability).toEqual([]);
      expect(guard.guardProofBlockKeys.length, guard.capability).toBe(guard.guardTests.length);
      expect(
        guard.guardProofBlockKeys.every((key) => key.includes('\0')),
        guard.capability,
      ).toBe(true);
      expect(guard.guardTests.every((guardTest) => /^tests\/.+\.test\.ts#.+/.test(guardTest))).toBe(
        true,
      );
      expect(
        guard.guardTestRefs.every((ref) =>
          guard.providers.includes(ref.provider) && guard.guardTests.includes(ref.guardTest),
        ),
        guard.capability,
      ).toBe(true);
      if (guard.capability === 'opa-rules') {
        expect(guard.sharedGuardTestRefs, guard.capability).toEqual([
          {
            guardTest:
              'tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources',
            providers: guard.providers,
          },
        ]);
      } else {
        expect(guard.sharedGuardTestRefs, guard.capability).toEqual([]);
      }
      for (const ref of guard.guardTestRefs) {
        const [file, title] = ref.guardTest.split('#');
        expect(
          guard.guardProofBlockKeys.some(
            (key) => key.startsWith(`${file}\0`) && key.includes(title),
          ),
          `${guard.capability}:${ref.guardTest}`,
        ).toBe(true);
      }
      expect(
        guard.proofFiles.every((file) =>
          file.startsWith('tests/unit/') || file.startsWith('tests/contract/'),
        ),
      ).toBe(true);
    }
  });

  it('resolves provider guard refs only to exact behavioral test titles', () => {
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

  it('tracks canonical capability outcomes and generated exceptions', () => {
    expect(matrix.outcomes.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'core-governance-verdicts',
        'core-approval-polling',
        'backend-policy-evaluation',
        'backend-guardrail-enforcement',
        'backend-approvals-hitl',
        'backend-organization-member-admin',
        'backend-tracing-observability',
        'backend-usage-cost-trust',
        'provider-adapter-guardrails',
        'provider-adapter-usage-cost',
        'provider-adapter-opa-rules',
      ]),
    );

    const policies = outcome(matrix, 'backend-policy-evaluation');
    expect(policies.status).toBe('proven');
    expect(policies.source).toBe('local-stack-e2e');
    expect(policies.operationIds).toContain('PolicyController_evaluate');
    expect(policies.semanticGapIds).toEqual([]);

    const coreVerdicts = outcome(matrix, 'core-governance-verdicts');
    expect(coreVerdicts.status).toBe('incomplete');
    expect(coreVerdicts.semanticGapIds).toEqual([
      'core-governance-attempt-min-not-rejected',
      'core-governance-cost-type-not-rejected',
      'core-governance-timestamp-format-not-rejected',
    ]);

    const coreApproval = outcome(matrix, 'core-approval-polling');
    expect(coreApproval.status).toBe('proven');
    expect(coreApproval.underProvenOperationIds).toEqual([]);
    expect(coreApproval.proofCounts.conformance).toBe(1);
    expect(coreApproval.semanticGapIds).toEqual([]);

    const guardrails = outcome(matrix, 'backend-guardrail-enforcement');
    expect(guardrails.status).toBe('proven');
    expect(guardrails.underProvenOperationIds).toEqual([]);

    const approvals = outcome(matrix, 'backend-approvals-hitl');
    expect(approvals.status).toBe('incomplete');
    expect(approvals.underProvenOperationIds).toEqual([]);
    expect(approvals.proofCounts.conformance).toBe(4);
    expect(approvals.semanticGapIds).toEqual([
      'approval-status-invalid-query-not-rejected',
    ]);

    const memberAdmin = outcome(matrix, 'backend-organization-member-admin');
    expect(memberAdmin.status).toBe('proven');
    expect(memberAdmin.underProvenOperationIds).toEqual([]);
    expect(memberAdmin.proofCounts.conformance).toBe(8);
    expect(memberAdmin.semanticGapIds).toEqual([]);

    const usage = outcome(matrix, 'backend-usage-cost-trust');
    expect(usage.status).toBe('proven');
    expect(usage.underProvenOperationIds).toEqual([]);
    expect(usage.proofCounts.conformance).toBe(5);
    expect(usage.proofCounts.behavioral).toBe(1);
    expect(usage.semanticGapIds).toEqual([]);

    const providerUsage = outcome(matrix, 'provider-adapter-usage-cost');
    expect(providerUsage.source).toBe('provider-guard-fixture');
    expect(providerUsage.status).toBe('proven');
    expect(providerUsage.missingProviderGuardCapabilities).toEqual([]);
    expect(providerUsage.missingProviderGuardTestRefs).toEqual([]);
    expect(providerUsage.exceptionIds).toEqual(
      expect.arrayContaining([
        'codex:usage-cost:observe-only',
        'cursor:usage-cost:observe-only',
      ]),
    );

    for (const providerOutcomeId of [
      'provider-adapter-guardrails',
      'provider-adapter-approvals-hitl',
      'provider-adapter-tracing',
      'provider-adapter-usage-cost',
      'provider-adapter-opa-rules',
    ]) {
      const providerOutcome = outcome(matrix, providerOutcomeId);
      const guardProofBlockKeys = providerOutcome.providerGuardCapabilities.flatMap((capability) => {
        const guard = matrix.providerGuards.find((entry) => entry.capability === capability);
        expect(guard, `${providerOutcomeId}:${capability}`).toBeDefined();
        return guard!.guardProofBlockKeys;
      }).sort();

      expect(providerOutcome.source, providerOutcomeId).toBe('provider-guard-fixture');
      expect(providerOutcome.status, providerOutcomeId).toBe('proven');
      expect(providerOutcome.missingProviderGuardCapabilities, providerOutcomeId).toEqual([]);
      expect(providerOutcome.missingProviderGuardTestRefs, providerOutcomeId).toEqual([]);
      expect(providerOutcome.providerGuardProofBlockKeys, providerOutcomeId).toEqual(
        [...new Set(guardProofBlockKeys)].sort(),
      );
      expect(providerOutcome.providerGuardProofBlockKeys.length, providerOutcomeId)
        .toBeGreaterThan(0);
    }

    expect(matrix.exceptions.length).toBeGreaterThan(0);
    expect(matrix.exceptions.every((entry) =>
      ['observe-only', 'out-of-scope', 'diagnose-only'].includes(entry.tier),
    )).toBe(true);

    const outcomeGapIds = new Set(matrix.outcomes.flatMap((entry) => entry.semanticGapIds));
    expect([...outcomeGapIds].sort()).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(matrix.scenarioMatrix.requiredOutcomeSpecs.map((entry) => entry.id)).toEqual(
      matrix.scenarioMatrix.requiredOutcomeIds,
    );
    expect(matrix.scenarioMatrix.outcomeSpecMismatchRefs).toEqual([]);

    for (const spec of matrix.scenarioMatrix.requiredOutcomeSpecs) {
      const coveredOutcome = outcome(matrix, spec.id);
      expect(coveredOutcome.label, spec.id).toBe(spec.label);
      expect(coveredOutcome.source, spec.id).toBe(spec.source);
      expect(coveredOutcome.minimumProofLevel, spec.id).toBe(spec.minimumProofLevel);
      expect(coveredOutcome.operationIds, spec.id).toEqual(spec.operationIds);
      expect(coveredOutcome.providerGuardCapabilities, spec.id).toEqual(
        spec.providerGuardCapabilities,
      );
      expect(coveredOutcome.exceptionCapabilities, spec.id).toEqual(spec.exceptionCapabilities);
    }
  });

  it('tracks every required local-stack scenario path from the generated spec', () => {
    const actualCapabilities = [...new Set(matrix.scenarioPaths.map((entry) => entry.capability))].sort();
    const actualCategories = [...new Set(matrix.scenarioPaths.map((entry) => entry.category))].sort();
    const actualAxes = [...new Set(matrix.scenarioPaths.flatMap((entry) => entry.axes))].sort();
    const actualLocalStackAxes = [
      ...new Set(
        matrix.scenarioPaths
          .filter((entry) => entry.localStackRequired)
          .flatMap((entry) => entry.axes),
      ),
    ].sort();
    const provenLocalStackAxes = [
      ...new Set(
        matrix.scenarioPaths
          .filter((entry) => entry.localStackRequired && entry.status === 'proven')
          .flatMap((entry) => entry.axes),
      ),
    ].sort();
    const actualLocalStackScenarioIds = matrix.scenarioPaths
      .filter((entry) => entry.localStackRequired)
      .map((entry) => entry.id)
      .sort();
    const actualProviderOwnedScenarioIds = matrix.scenarioPaths
      .filter((entry) => !entry.localStackRequired)
      .map((entry) => entry.id)
      .sort();

    expect(matrix.scenarioPaths.length).toBe(
      matrix.scenarioMatrix.localStackScenarioIds.length +
        matrix.scenarioMatrix.providerOwnedScenarioIds.length,
    );
    expect(new Set(matrix.scenarioPaths.map((entry) => entry.id)).size).toBe(
      matrix.scenarioPaths.length,
    );
    expect(actualCapabilities).toEqual([...matrix.scenarioMatrix.requiredCapabilities].sort());
    expect(actualCategories).toEqual([...matrix.scenarioMatrix.requiredCategories].sort());
    expect(actualAxes).toEqual([...matrix.scenarioMatrix.requiredAxes].sort());
    expect(matrix.scenarioMatrix.requiredLocalStackAxes).toEqual(
      matrix.scenarioMatrix.requiredAxes,
    );
    expect(actualLocalStackAxes).toEqual([...matrix.scenarioMatrix.requiredLocalStackAxes].sort());
    expect(provenLocalStackAxes).toEqual([...matrix.scenarioMatrix.requiredLocalStackAxes].sort());
    expect(matrix.scenarioMatrix.requiredCategoryAxes).toEqual([
      { category: 'approvals-hitl', axes: ['failure', 'happy', 'matrix', 'order', 'tool'] },
      { category: 'behavioral', axes: ['dbquery', 'failure', 'goal', 'happy', 'matrix', 'order', 'tool'] },
      { category: 'goal-drift', axes: ['failure', 'goal', 'happy'] },
      { category: 'guardrails', axes: ['dbquery', 'failure', 'guardrails', 'happy', 'order'] },
      { category: 'opa', axes: ['dbquery', 'failure', 'happy', 'matrix', 'opa', 'tool'] },
      { category: 'tracing', axes: ['dbquery', 'failure', 'happy', 'matrix', 'order', 'tool'] },
      { category: 'usage-cost', axes: ['cost', 'dbquery', 'happy', 'matrix', 'usage'] },
      { category: 'workflow', axes: ['failure', 'happy', 'order'] },
    ]);
    expect(actualLocalStackScenarioIds).toEqual(
      [...matrix.scenarioMatrix.localStackScenarioIds].sort(),
    );
    expect(actualProviderOwnedScenarioIds).toEqual(
      [...matrix.scenarioMatrix.providerOwnedScenarioIds].sort(),
    );
    expect(matrix.scenarioPaths.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'opa-allow',
        'opa-require-approval',
        'opa-block',
        'opa-halt',
        'opa-decision-aliases',
        'opa-constrain',
        'opa-unavailable-fail-closed',
        'approval-pending',
        'approval-approved',
        'approval-rejected',
        'approval-expired-timeout',
        'approval-dashboard-metrics-history',
        'guardrail-allow',
        'guardrail-block',
        'guardrail-redact',
        'guardrail-service-unavailable-fail-closed',
        'behavior-order-goal-before-action',
        'behavior-db-query',
        'behavior-tool-call',
        'behavior-http',
        'behavior-file-read',
        'behavior-file-write',
        'behavior-shell',
        'behavior-llm',
        'behavior-mcp',
        'behavior-rule-lifecycle-current',
        'behavior-rule-metrics-violations',
        'behavior-rule-rollback-history',
        'policy-lifecycle-evaluations-metrics',
        'guardrail-lifecycle-order-metrics',
        'usage-core-wire-boundary',
        'usage-token-counts',
        'usage-cost-usd',
        'trust-aivss-ledger',
        'goal-alignment-checked',
        'goal-drift-detected',
        'goal-drift-fallback',
        'trace-session',
        'trace-logs',
        'trace-reasoning',
        'trace-source-attribution',
        'observability-ledger-dashboard',
        'violation-false-positive',
        'workflow-session-lifecycle',
        'workflow-session-terminate',
        'backend-dashboard-metrics',
      ]),
    );
    expect(
      matrix.scenarioPaths.every((entry) =>
        (entry.localStackRequired ? entry.operationIds.length > 0 : entry.operationIds.length >= 0) &&
        entry.evidencePatterns.length > 0 &&
        entry.requiredBehavior.length > 30,
      ),
    ).toBe(true);

    expect(matrix.scenarioMatrix).toMatchObject({
      status: 'proven',
      requiredSharedProviderGuardProofCapabilities: ['opa-rules'],
      requiredSdkSemanticGapClosureTargets: ['typescript', 'python'],
      duplicateOperationIdRefs: [],
      duplicateServiceOperationIdRefs: [],
      duplicateOperationRouteRefs: [],
      duplicateOperationPathPatternRefs: [],
      operationRouteResolutionMismatchRefs: [],
      ambiguousOperationRouteTieRefs: [],
      missingCapabilities: [],
      unexpectedCapabilities: [],
      missingCategories: [],
      unexpectedCategories: [],
      missingAxes: [],
      unexpectedAxes: [],
      unknownScenarioCapabilityRefs: [],
      unknownOutcomeCapabilityRefs: [],
      unknownScenarioMatrixCapabilityRefs: [],
      unknownProviderGuardCapabilityRefs: [],
      unknownProviderGuardProviderRefs: [],
      unknownProviderGuardTierRefs: [],
      missingLocalStackAxes: [],
      incompleteLocalStackAxes: [],
      outcomeSpecMismatchRefs: [],
      missingProviderCapabilityGuardProviderRefs: [],
      unexpectedProviderCapabilityGuardProviderRefs: [],
      providerGuardTierMismatchRefs: [],
      duplicateProviderCapabilityGuardProviderRefs: [],
      sharedProviderGuardProofCapabilities: ['opa-rules'],
      missingSharedProviderGuardProofCapabilities: [],
      unexpectedSharedProviderGuardProofCapabilities: [],
      missingCategoryAxisRefs: [],
      incompleteCategoryAxisRefs: [],
      missingLocalStackScenarioIds: [],
      unexpectedLocalStackScenarioIds: [],
      missingProviderOwnedScenarioIds: [],
      unexpectedProviderOwnedScenarioIds: [],
      unknownScenarioProofMarkerRefs: [],
      duplicateScenarioPathRefs: [],
      duplicateOutcomeRefs: [],
      duplicateScenarioMatrixContractRefs: [],
      duplicateScenarioOperationRefs: [],
      duplicateScenarioAxisRefs: [],
      missingOperationEvidencePatternRefs: [],
      unknownOperationEvidencePatternRefs: [],
      duplicateOperationEvidencePatternRefs: [],
      incompleteScenarioIds: [],
      missingOutcomeIds: [],
      incompleteOutcomeIds: [],
      rawSemanticGapOutcomeIds: [
        'backend-approvals-hitl',
        'backend-tracing-observability',
        'core-governance-verdicts',
      ],
      rawSemanticGapOutcomeRefs: [
        {
          outcomeId: 'backend-approvals-hitl',
          semanticGapIds: ['approval-status-invalid-query-not-rejected'],
        },
        {
          outcomeId: 'backend-tracing-observability',
          semanticGapIds: ['backend-agent-evaluations-query-boundaries-not-rejected'],
        },
        {
          outcomeId: 'core-governance-verdicts',
          semanticGapIds: [
            'core-governance-attempt-min-not-rejected',
            'core-governance-cost-type-not-rejected',
            'core-governance-timestamp-format-not-rejected',
          ],
        },
      ],
      unclosedSemanticGapIds: [],
    });
    expect(
      matrix.scenarioMatrix.categoryAxisCoverage.map((entry) => ({
        category: entry.category,
        requiredAxes: entry.requiredAxes,
        missingAxes: entry.missingAxes,
        incompleteAxes: entry.incompleteAxes,
      })),
    ).toEqual(
      matrix.scenarioMatrix.requiredCategoryAxes.map((entry) => ({
        category: entry.category,
        requiredAxes: [...entry.axes].sort(),
        missingAxes: [],
        incompleteAxes: [],
      })),
    );
    expect(matrix.scenarioMatrix.rawSemanticGapPolicy).toContain(
      'generated TypeScript and Python request-preflight closure evidence',
    );
    expect(matrix.scenarioMatrix.backendCoreGapStatusPolicy).toContain(
      'backendCoreGapStatus must remain known-gaps',
    );
    expect(matrix.scenarioMatrix.backendCoreGapRemediationPolicy).toContain(
      'generated request constraint remediation target',
    );
    expect(matrix.scenarioMatrix.localStackAxisPolicy).toContain(
      'provider-owned fixture evidence cannot satisfy',
    );
    expect(matrix.scenarioMatrix.providerGuardSharedProofPolicy).toContain(
      'backend-owned capabilities',
    );
    expect(matrix.scenarioMatrix.status).toBe('proven');
    expect(matrix.scenarioMatrix.backendCoreGapStatus).toBe('known-gaps');
    expect(matrix.scenarioMatrix.knownBackendCoreGapIds).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(matrix.scenarioMatrix.semanticGapIds).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(
      matrix.scenarioMatrix.rawSemanticGapOutcomeRefs.flatMap((entry) => entry.semanticGapIds).sort(),
    ).toEqual(matrix.scenarioMatrix.semanticGapIds);
  });

  it('maps every backend/Core raw gap to generated remediation targets', () => {
    expect(matrix.backendCoreGapRemediationTargets.map((entry) => entry.gapId)).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(matrix.scenarioMatrix.backendCoreGapRemediationTargetIds).toEqual(
      matrix.scenarioMatrix.semanticGapIds,
    );
    expect(matrix.scenarioMatrix.missingBackendCoreGapRemediationTargetIds).toEqual([]);
    expect(matrix.scenarioMatrix.unexpectedBackendCoreGapRemediationTargetIds).toEqual([]);

    for (const target of matrix.backendCoreGapRemediationTargets) {
      const gap = matrix.semanticGaps.find((entry) => entry.id === target.gapId);
      expect(gap, target.gapId).toBeDefined();
      expect(target.operationIds, target.gapId).toEqual(gap!.operationIds);
      expect(target.rawProofFile, target.gapId).toBe(gap!.proofFile);
      expect(target.rawEvidencePattern, target.gapId).toBe(gap!.evidencePattern);
      expect(target.observedBehavior, target.gapId).toBe(gap!.observedBehavior);
      expect(target.requiredBehavior, target.gapId).toBe(gap!.requiredBehavior);
      expect(target.requiredRawRejection, target.gapId).toContain('4xx validation response');
      expect(target.requestConstraintKeys.length, target.gapId).toBeGreaterThan(0);
      expect(target.sdkClosureTargets, target.gapId).toEqual(['typescript', 'python']);
    }

    const byGap = new Map(
      matrix.backendCoreGapRemediationTargets.map((entry) => [entry.gapId, entry]),
    );
    expect(byGap.get('approval-status-invalid-query-not-rejected')).toMatchObject({
      services: ['backend'],
      requestLocations: ['query.status'],
      constraintKinds: ['enum'],
      requestConstraintKeys: [
        'backend:AgentController_getApprovalHistory:query.status:enum',
        'backend:AgentController_getPendingApprovals:query.status:enum',
        'backend:OrganizationController_getApprovals:query.status:enum',
      ],
    });
    expect(byGap.get('backend-agent-evaluations-query-boundaries-not-rejected')).toMatchObject({
      services: ['backend'],
      requestLocations: ['query.page', 'query.pattern', 'query.perPage'],
      constraintKinds: ['maxLength', 'minimum'],
      requestConstraintKeys: [
        'backend:AgentController_getAgentEvaluations:query.page:minimum',
        'backend:AgentController_getAgentEvaluations:query.pattern:maxLength',
        'backend:AgentController_getAgentEvaluations:query.perPage:minimum',
      ],
    });
    expect(byGap.get('core-governance-attempt-min-not-rejected')).toMatchObject({
      services: ['core'],
      requestLocations: ['body.attempt'],
      constraintKinds: ['minimum'],
      requestConstraintKeys: ['core:evaluateGovernance:body.attempt:minimum'],
    });
    expect(byGap.get('core-governance-cost-type-not-rejected')).toMatchObject({
      services: ['core'],
      requestLocations: ['body.cost_usd'],
      constraintKinds: ['format', 'type'],
      requestConstraintKeys: [
        'core:evaluateGovernance:body.cost_usd:format',
        'core:evaluateGovernance:body.cost_usd:type',
      ],
    });
    expect(byGap.get('core-governance-timestamp-format-not-rejected')).toMatchObject({
      services: ['core'],
      requestLocations: ['body.timestamp'],
      constraintKinds: ['format'],
      requestConstraintKeys: ['core:evaluateGovernance:body.timestamp:format'],
    });
  });

  it('does not conflate SDK-closed conformance with backend/Core gap-free status', () => {
    expect(matrix.scenarioMatrix.status).toBe('proven');
    expect(matrix.summary.sdkSemanticGapClosures).toEqual({
      total: matrix.semanticGaps.length * 2,
      proven: matrix.semanticGaps.length * 2,
      missing: 0,
    });
    expect(matrix.summary.knownSemanticGaps).toBeGreaterThan(0);
    expect(matrix.scenarioMatrix.backendCoreGapStatus).toBe('known-gaps');
    expect(matrix.scenarioMatrix.knownBackendCoreGapIds).toEqual([
      'approval-status-invalid-query-not-rejected',
      'backend-agent-evaluations-query-boundaries-not-rejected',
      'core-governance-attempt-min-not-rejected',
      'core-governance-cost-type-not-rejected',
      'core-governance-timestamp-format-not-rejected',
    ]);
  });

  it('separates proven scenario paths from required-but-open gaps', () => {
    expect(scenario(matrix, 'opa-allow').status).toBe('proven');
    expect(scenario(matrix, 'opa-require-approval').status).toBe('proven');
    expect(scenario(matrix, 'approval-pending').status).toBe('proven');
    expect(scenario(matrix, 'approval-approved').status).toBe('proven');
    expect(scenario(matrix, 'approval-rejected').status).toBe('proven');
    expect(scenario(matrix, 'behavior-tool-call').status).toBe('proven');
    expect(scenario(matrix, 'opa-block').status).toBe('proven');
    expect(scenario(matrix, 'opa-halt').status).toBe('proven');
    expect(scenario(matrix, 'opa-decision-aliases').status).toBe('proven');
    expect(scenario(matrix, 'opa-unavailable-fail-closed').status).toBe('proven');
    expect(scenario(matrix, 'behavior-db-query').status).toBe('proven');
    expect(scenario(matrix, 'behavior-http').status).toBe('proven');
    expect(scenario(matrix, 'behavior-file-read').status).toBe('proven');
    expect(scenario(matrix, 'behavior-file-write').status).toBe('proven');
    expect(scenario(matrix, 'behavior-shell').status).toBe('proven');
    expect(scenario(matrix, 'behavior-llm').status).toBe('proven');
    expect(scenario(matrix, 'behavior-mcp').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-allow').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-block').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-redact').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-service-unavailable-fail-closed').status).toBe('proven');
    expect(scenario(matrix, 'behavior-order-goal-before-action').status).toBe('proven');
    expect(scenario(matrix, 'goal-alignment-checked').status).toBe('proven');
    expect(scenario(matrix, 'goal-drift-detected').status).toBe('proven');
    expect(scenario(matrix, 'goal-drift-fallback').status).toBe('proven');
    expect(scenario(matrix, 'approval-expired-timeout').status).toBe('proven');
    expect(scenario(matrix, 'approval-dashboard-metrics-history').status).toBe('proven');
    expect(scenario(matrix, 'behavior-rule-lifecycle-current').status).toBe('proven');
    expect(scenario(matrix, 'behavior-rule-metrics-violations').status).toBe('proven');
    expect(scenario(matrix, 'behavior-rule-rollback-history').status).toBe('proven');
    expect(scenario(matrix, 'policy-lifecycle-evaluations-metrics').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-lifecycle-order-metrics').status).toBe('proven');
    expect(scenario(matrix, 'workflow-session-lifecycle').status).toBe('proven');
    expect(scenario(matrix, 'workflow-session-terminate').status).toBe('proven');
    expect(scenario(matrix, 'observability-ledger-dashboard').status).toBe('proven');
    expect(scenario(matrix, 'violation-false-positive').status).toBe('proven');
    expect(scenario(matrix, 'backend-dashboard-metrics').status).toBe('proven');
    expect(scenario(matrix, 'trust-aivss-ledger').status).toBe('proven');
    expect(scenario(matrix, 'opa-constrain').status).toBe('proven');
    expect(scenario(matrix, 'usage-core-wire-boundary').status).toBe('proven');

    const constrainBoundary = scenario(matrix, 'opa-constrain');
    expect(constrainBoundary.localStackRequired).toBe(true);
    expect(constrainBoundary.status).toBe('proven');
    expect(constrainBoundary.proofSource).toBe('local-stack-e2e');
    expect(constrainBoundary.underProvenOperationIds).toEqual([]);

    const providerOwnedScenarioIds = matrix.scenarioMatrix.providerOwnedScenarioIds;
    expect(providerOwnedScenarioIds).toEqual(['usage-token-counts', 'usage-cost-usd', 'usage-zero-values']);

    for (const id of providerOwnedScenarioIds) {
      const providerOwned = scenario(matrix, id);
      const providerGuard = matrix.providerGuards.find((entry) => entry.capability === providerOwned.capability);
      expect(providerGuard, id).toBeDefined();
      expect(providerGuard!.guardTestRefs.length, id).toBeGreaterThan(0);
      expect(providerOwned.localStackRequired, id).toBe(false);
      expect(providerOwned.status, id).toBe('proven');
      expect(providerOwned.proofSource, id).toBe('provider-guard-fixture');
      expect(providerOwned.proofLevel, id).toBe(providerOwned.requiredProofLevel);
      expect(providerOwned.providerGuardTestRefs, id).toEqual(providerGuard!.guardTestRefs);
      expect(providerOwned.missingProviderGuardTestRefs, id).toEqual([]);
      expect(providerOwned.providerGuardProofBlockKeys.length, id).toBe(
        providerOwned.providerGuardTestRefs.length,
      );
      expect(
        providerOwned.providerGuardProofBlockKeys.every((key) => key.includes('\0')),
        id,
      ).toBe(true);
      for (const ref of providerOwned.providerGuardTestRefs) {
        const [file, title] = ref.guardTest.split('#');
        expect(
          providerOwned.providerGuardProofBlockKeys.some(
            (key) => key.startsWith(`${file}\0`) && key.includes(title),
          ),
          `${id}:${ref.guardTest}`,
        ).toBe(true);
      }
      expect(providerOwned.proofFiles, id).toEqual(
        expect.arrayContaining(providerGuard!.proofFiles),
      );
      expect(providerOwned.matchedEvidencePatterns, id).toEqual(
        [...providerOwned.evidencePatterns].sort(),
      );
      expect(providerOwned.proofTestNames.length, id).toBeGreaterThan(0);
    }

    expect(matrix.scenarioPaths.filter((entry) => entry.status !== 'proven')).toEqual([]);
  });
});
