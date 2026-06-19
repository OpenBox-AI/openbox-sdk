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
import type { components } from '../../ts/src/types/generated/backend';

type GeneratedCreateBehaviorRuleDto =
  components['schemas']['CreateBehaviorRuleDto'];
type GeneratedBehaviorRule = components['schemas']['BehaviorRule'];
type GeneratedCreateGuardrailDto =
  components['schemas']['CreateGuardrailDto'];
type GeneratedCreatePolicyDto = components['schemas']['CreatePolicyDto'];
type GeneratedUpdateGuardrailDto =
  components['schemas']['UpdateGuardrailDto'];

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
      const typed: GeneratedCreateGuardrailDto = dto;
      const update: GeneratedUpdateGuardrailDto = {
        guardrail_type: dto.guardrail_type,
        processing_stage: dto.processing_stage,
      };
      expect(dto.name).toMatch(/^test-guardrail-/);
      expect(dto.guardrail_type).toBe('1');
      expect(dto.processing_stage).toBe('1');
      expect(dto.trust_impact).toBeTruthy();
      expect(typed.guardrail_type).toBe('1');
      expect(update.processing_stage).toBe('1');
    });

    it('keeps legacy activity scoping absent and defaulted trust impact optional', () => {
      const minimal: GeneratedCreateGuardrailDto = {
        guardrail_type: '1',
        name: 'minimal-guardrail',
        processing_stage: '0',
      };

      expect(minimal).not.toHaveProperty('trust_impact');
      expect(minimal).not.toHaveProperty('activity_type');
      expect(minimal).not.toHaveProperty('fields_to_check');
    });
  });

  describe('makeCreatePolicyDto', () => {
    it('generates valid policy DTO with rego code', () => {
      const dto = makeCreatePolicyDto();
      expect(dto.name).toMatch(/^test-policy-/);
      expect(dto.rego_code).toContain('package openbox.policy');
      expect(dto.rego_code).toContain('decision');
    });

    it('generated create policy type keeps trust impact optional', () => {
      const dto: GeneratedCreatePolicyDto = {
        name: 'minimal-policy',
        rego_code: 'package openbox.policy',
        input: {},
      };

      expect(dto).not.toHaveProperty('trust_impact');
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

    it('generated behavior rule types support trigger and state predicates', () => {
      const dto: GeneratedCreateBehaviorRuleDto = {
        rule_name: 'state-predicate',
        priority: 50,
        trigger: 'http_post',
        trigger_match: [{ field: 'http_url', op: 'contains', value: 'api' }],
        states: [
          {
            semantic_type: 'file_read',
            match: [{ field: 'file_path', op: 'contains', value: '/private' }],
          },
          'mcp_tool_call',
        ],
        time_window: 60,
        verdict: 2,
        reject_message: 'approval required',
        approval_timeout: 300,
        trust_impact: 'none',
      };
      const rule: GeneratedBehaviorRule = {
        id: 'rule-1',
        rule_name: dto.rule_name,
        priority: dto.priority,
        trigger: dto.trigger,
        trigger_match: dto.trigger_match,
        states: dto.states,
        time_window: dto.time_window,
        verdict: dto.verdict,
        reject_message: dto.reject_message,
        approval_timeout: dto.approval_timeout,
        is_active: true,
      };

      expect(rule.trigger_match?.[0]?.field).toBe('http_url');
      expect(rule.states[0]).toMatchObject({ semantic_type: 'file_read' });
      expect(rule.states[1]).toBe('mcp_tool_call');
    });

    it('generated create behavior rule type keeps trust impact optional', () => {
      const dto: GeneratedCreateBehaviorRuleDto = {
        rule_name: 'minimal-rule',
        priority: 50,
        trigger: 'http_post',
        states: ['http_post'],
        time_window: 60,
        verdict: 0,
        reject_message: 'allow',
      };

      expect(dto).not.toHaveProperty('trust_impact');
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
