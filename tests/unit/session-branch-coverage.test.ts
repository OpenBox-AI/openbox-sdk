import { describe, expect, it } from 'vitest';
import {
  inspectEvents,
  parseDuration,
} from '../../ts/src/cli/commands/session.js';

describe('session command branch coverage', () => {
  it('parses supported duration units and rejects malformed values', () => {
    expect(parseDuration('30ms')).toBe(30);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('1d')).toBe(86_400_000);
    expect(parseDuration('42')).toBe(42_000);
    expect(() => parseDuration('forever')).toThrow(/invalid duration/);
  });

  it('summarizes clean workflow protocol events', () => {
    const findings = inspectEvents([
      {
        event_type: 'WorkflowStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
      },
      {
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'a1',
        activity_type: 'PromptSubmission',
        activity_input: [{ prompt: 'hi' }],
        verdict: 'allow',
      },
      {
        event_type: 'ActivityCompleted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'a1',
        activity_type: 'PromptSubmission',
        activity_input: [{ prompt: 'hi' }],
        action: 'constrain',
      },
      {
        event_type: 'WorkflowCompleted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
      },
    ]);

    expect(findings.some((f) => f.level === 'fail')).toBe(false);
    expect(findings.map((f) => f.message).join('\n')).toContain('workflow_id consistent');
    expect(findings.map((f) => f.message).join('\n')).toContain('activity pair');
  });

  it('flags protocol drift and uses pluralized diagnostics', () => {
    const findings = inspectEvents([
      { event_type: 'WorkflowStarted', workflow_id: 'wf-1', run_id: 'run-1' },
      { event_type: 'WorkflowStarted', workflow_id: 'wf-2', run_id: 'run-2' },
      {
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'a1',
        activity_type: 'CustomThing',
        activity_input: { bad: true },
        verdict: 'deny',
      },
      {
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'a2',
        activity_type: 'CustomThing',
        activity_input: { bad: true },
      },
      {
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'a3',
        activity_type: 'CustomThing',
      },
      {
        event_type: 'ActivityStarted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'a4',
        activity_type: 'PromptSubmission',
      },
      {
        event_type: 'ActivityCompleted',
        workflow_id: 'wf-1',
        run_id: 'run-1',
        activity_id: 'orphan',
        activity_type: 'PromptSubmission',
        status: 'failed',
      },
      { event_type: 'MadeUpEvent', workflow_id: 'wf-1', run_id: 'run-1' },
    ]);
    const text = findings.map((f) => f.message).join('\n');

    expect(text).toContain('multiple workflow_ids');
    expect(text).toContain('multiple run_ids');
    expect(text).toContain('2 WorkflowStarted events');
    expect(text).toContain('ActivityStarted without matching ActivityCompleted');
    expect(text).toContain('ActivityCompleted without matching ActivityStarted');
    expect(text).toContain('no WorkflowCompleted or WorkflowFailed');
    expect(text).toContain('activity completed with status=failed');
    expect(text).toContain('non-canonical event_type');
    expect(text).toContain('custom:');
    expect(text).toContain('non-canonical verdict');
    expect(text).toContain('activity_input that is not an array');
  });

  it('handles empty sessions as explicit failures', () => {
    const text = inspectEvents([]).map((f) => f.message).join('\n');
    expect(text).toContain('no workflow_id');
    expect(text).toContain('no WorkflowStarted');
    expect(text).toContain('no WorkflowCompleted or WorkflowFailed');
  });
});
