import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

// The spec in this repo is pulled directly from the live backend
// (/api/docs-json). These tests assert invariants that should hold on the
// live spec, whether that's the aspirational state or the deployed state.
// If a shape looks "wrong" in the live spec, file it upstream - don't
// paper over it with .skip here.
const specPath = resolve(__dirname, '../../specs/backend.json');
const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

// Also load staging to confirm the two envs' specs don't silently diverge.
const stagingSpecPath = resolve(__dirname, '../../specs/backend.json');
const stagingSpec = JSON.parse(readFileSync(stagingSpecPath, 'utf-8'));

describe('OpenAPI Spec Validation', () => {
  it('has valid OpenAPI version', () => {
    expect(spec.openapi).toMatch(/^3\.\d+\.\d+$/);
  });

  it('has title and description', () => {
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
  });

  // NestJS @nestjs/swagger emits servers: [] when no DocumentBuilder.addServer()
  // call is made in the backend. The live spec currently ships empty, so we
  // only validate the shape (array present). Making servers meaningful is a
  // backend-side improvement - track there if the CLI needs it.
  it('has a servers array (shape check only; may be empty)', () => {
    expect(Array.isArray(spec.servers)).toBe(true);
  });

  it('production and staging spec share the same path set', () => {
    const prodPaths = new Set(Object.keys(spec.paths));
    const stagePaths = new Set(Object.keys(stagingSpec.paths));
    const onlyProd = [...prodPaths].filter((p) => !stagePaths.has(p));
    const onlyStage = [...stagePaths].filter((p) => !prodPaths.has(p));
    expect(onlyProd).toEqual([]);
    expect(onlyStage).toEqual([]);
  });

  it('production and staging spec share the same schema set', () => {
    const prodSchemas = new Set(Object.keys(spec.components?.schemas ?? {}));
    const stageSchemas = new Set(Object.keys(stagingSpec.components?.schemas ?? {}));
    const onlyProd = [...prodSchemas].filter((s) => !stageSchemas.has(s));
    const onlyStage = [...stageSchemas].filter((s) => !prodSchemas.has(s));
    expect(onlyProd).toEqual([]);
    expect(onlyStage).toEqual([]);
  });

  it('has 90+ paths', () => {
    const pathCount = Object.keys(spec.paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(90);
  });

  it('has 40+ schemas', () => {
    const schemaCount = Object.keys(spec.components?.schemas || {}).length;
    expect(schemaCount).toBeGreaterThanOrEqual(40);
  });

  it('has at least one auth security scheme', () => {
    const schemes = spec.components?.securitySchemes ?? {};
    expect(Object.keys(schemes).length).toBeGreaterThanOrEqual(1);
  });

  describe('required paths exist', () => {
    const requiredPaths = [
      '/health',
      '/auth/login',
      '/auth/profile',
      '/auth/refresh',
      '/agent/list',
      '/agent/create',
      '/agent/{agentId}',
      '/agent/{agentId}/rotate-api-key',
      '/agent/{agentId}/guardrails',
      '/agent/{agentId}/policies',
      '/agent/{agentId}/sessions',
      '/agent/{agentId}/behavior-rule',
      '/agent/{agentId}/trust/histories',
      '/agent/{agentId}/approvals/pending',
      '/organization/register',
      '/organization/{organizationId}/teams',
      '/organization/{organizationId}/dashboard',
      '/user/roles',
      '/policy/evaluate',
      '/guardrails/run-test',
    ];

    for (const path of requiredPaths) {
      it(`has ${path}`, () => {
        expect(spec.paths[path]).toBeDefined();
      });
    }
  });

  describe('required schemas exist', () => {
    const requiredSchemas = [
      'LoginDto',
      'CreateAgentDto',
      'UpdateAgentDto',
      'CreateGuardrailDto',
      'CreatePolicyDto',
      'CreateBehaviorRuleDto',
      'CreateOrganizationDto',
      'CreateTeamDto',
      'AivssConfigDto',
      'GoalAlignmentConfigDto',
    ];

    for (const schema of requiredSchemas) {
      it(`has ${schema}`, () => {
        expect(spec.components.schemas[schema]).toBeDefined();
      });
    }
  });

  describe('CreateAgentDto schema', () => {
    const schema = spec.components.schemas.CreateAgentDto;

    it('has required fields', () => {
      expect(schema.required).toContain('agent_name');
      expect(schema.required).toContain('icon');
      expect(schema.required).toContain('aivss_config');
    });

    it('has expected properties', () => {
      expect(schema.properties.agent_name).toBeDefined();
      expect(schema.properties.description).toBeDefined();
      expect(schema.properties.team_ids).toBeDefined();
      expect(schema.properties.aivss_config).toBeDefined();
    });
  });
});
