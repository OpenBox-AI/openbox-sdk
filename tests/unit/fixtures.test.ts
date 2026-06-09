import { describe, it, expect } from 'vitest';
import {
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeCreatePolicyDto,
  makeCreateBehaviorRuleDto,
  makeGovernanceEvent,
  makeUpdateAivssConfigDto,
  makeGoalAlignmentConfigDto,
} from '../helpers/fixtures';

describe('Test Fixtures', () => {
  describe('makeCreateAgentDto', () => {
    it('generates valid agent DTO with required fields', () => {
      const dto = makeCreateAgentDto(['team-1']);
      expect(dto.agent_name).toMatch(/^test-agent-/);
      expect(dto.icon).toBe('robot');
      expect(dto.team_ids).toEqual(['team-1']);
      expect(dto.aivss_config).toBeDefined();
      expect(dto.aivss_config.base_security.attack_vector).toBeGreaterThanOrEqual(1);
      expect(dto.aivss_config.ai_specific.model_robustness).toBeGreaterThanOrEqual(1);
      expect(dto.aivss_config.impact.confidentiality_impact).toBeGreaterThanOrEqual(1);
    });

    it('generates unique names', () => {
      const a = makeCreateAgentDto([]);
      const b = makeCreateAgentDto([]);
      expect(a.agent_name).not.toBe(b.agent_name);
    });

    it('accepts overrides', () => {
      const dto = makeCreateAgentDto([], { agent_name: 'custom' });
      expect(dto.agent_name).toBe('custom');
    });
  });

  describe('makeCreateGuardrailDto', () => {
    it('generates valid guardrail DTO', () => {
      const dto = makeCreateGuardrailDto();
      expect(dto.name).toMatch(/^test-guardrail-/);
      expect(dto.guardrail_type).toBe('1');
      expect(dto.processing_stage).toBe('1');
      expect(dto.trust_impact).toBeTruthy();
    });
  });

  describe('makeCreatePolicyDto', () => {
    it('generates valid policy DTO with rego code', () => {
      const dto = makeCreatePolicyDto();
      expect(dto.name).toMatch(/^test-policy-/);
      expect(dto.rego_code).toContain('package openbox.policy');
      expect(dto.rego_code).toContain('decision');
    });
  });

  describe('makeCreateBehaviorRuleDto', () => {
    it('generates valid behavior rule DTO', () => {
      const dto = makeCreateBehaviorRuleDto();
      expect(dto.rule_name).toMatch(/^test-rule-/);
      expect(dto.trigger).toBeTruthy();
      expect(dto.states).toBeInstanceOf(Array);
      expect(dto.states.length).toBeGreaterThan(0);
      expect(dto.time_window).toBeGreaterThan(0);
      expect(dto.verdict).toBeGreaterThanOrEqual(0);
      expect(dto.reject_message).toBeTruthy();
    });
  });

  describe('makeGovernanceEvent', () => {
    it('generates valid governance event', () => {
      const event = makeGovernanceEvent();
      expect(event.event_type).toBe('ActivityStarted');
      expect(event.workflow_id).toMatch(/^test-wf-/);
      expect(event.run_id).toMatch(/^test-run-/);
      expect(event.timestamp).toBeTruthy();
    });
  });

  describe('makeUpdateAivssConfigDto', () => {
    it('has all three config sections', () => {
      const dto = makeUpdateAivssConfigDto();
      expect(dto.aivss_config.base_security).toBeDefined();
      expect(dto.aivss_config.ai_specific).toBeDefined();
      expect(dto.aivss_config.impact).toBeDefined();
      expect(dto.reason).toBeTruthy();
    });
  });

  describe('makeGoalAlignmentConfigDto', () => {
    it('has valid config', () => {
      const dto = makeGoalAlignmentConfigDto();
      expect(dto.alignment_threshold).toBeGreaterThanOrEqual(0);
      expect(dto.alignment_threshold).toBeLessThanOrEqual(100);
      expect(dto.drift_detection_action).toBeTruthy();
    });
  });
});
