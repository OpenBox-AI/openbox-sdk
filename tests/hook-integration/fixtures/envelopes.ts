// Synthetic CursorEnvelope fixtures, one per hook_event_name. Shape
// is the spec's `model CursorEnvelope` in
// specs/typespec/govern/adapters.tsp:326. We carry only the fields
// the per-event mapper actually reads (e.g. preToolUse needs
// tool_name + tool_input; beforeShellExecution needs command).
//
// Real Cursor envelopes carry many more fields than these (workspace
// path, model name, telemetry IDs); the hook handler ignores anything
// it doesn't map, so a minimal fixture is sufficient for the verdict
// path. We deliberately don't include conversation_id values that
// pretend to be real session IDs; the hook tolerates fresh ones.

export type EventName =
  | 'sessionStart'
  | 'beforeSubmitPrompt'
  | 'beforeReadFile'
  | 'beforeShellExecution'
  | 'beforeMCPExecution'
  | 'preToolUse'
  | 'afterAgentResponse'
  | 'afterAgentThought'
  | 'afterShellExecution'
  | 'afterFileEdit'
  | 'afterMCPExecution'
  | 'postToolUse'
  | 'postToolUseFailure'
  | 'stop';

const CONV = 'test-conv-1';
const GEN = 'test-gen-1';

export const ENVELOPES: Record<EventName, Record<string, unknown>> = {
  sessionStart: {
    hook_event_name: 'sessionStart',
    conversation_id: CONV,
  },
  beforeSubmitPrompt: {
    hook_event_name: 'beforeSubmitPrompt',
    conversation_id: CONV,
    generation_id: GEN,
    prompt: 'list the files in the current directory',
  },
  beforeReadFile: {
    hook_event_name: 'beforeReadFile',
    conversation_id: CONV,
    generation_id: GEN,
    file_path: '/tmp/openbox-hook-test.txt',
    content: 'fixture content; the hook does not need real bytes',
  },
  beforeShellExecution: {
    hook_event_name: 'beforeShellExecution',
    conversation_id: CONV,
    generation_id: GEN,
    command: 'echo "hook integration test"',
    cwd: '/tmp',
  },
  beforeMCPExecution: {
    hook_event_name: 'beforeMCPExecution',
    conversation_id: CONV,
    generation_id: GEN,
    tool_name: 'openbox.list_pending_approvals',
    tool_input: {},
  },
  preToolUse: {
    hook_event_name: 'preToolUse',
    conversation_id: CONV,
    generation_id: GEN,
    tool_name: 'Shell',
    tool_input: { command: 'echo from preToolUse', cwd: '/tmp' },
  },
  afterAgentResponse: {
    hook_event_name: 'afterAgentResponse',
    conversation_id: CONV,
    generation_id: GEN,
    response: 'I have completed the task.',
  },
  afterAgentThought: {
    hook_event_name: 'afterAgentThought',
    conversation_id: CONV,
    generation_id: GEN,
    thought: 'considering the next step',
  },
  afterShellExecution: {
    hook_event_name: 'afterShellExecution',
    conversation_id: CONV,
    generation_id: GEN,
    command: 'echo "hook integration test"',
  },
  afterFileEdit: {
    hook_event_name: 'afterFileEdit',
    conversation_id: CONV,
    generation_id: GEN,
    file_path: '/tmp/openbox-hook-test.txt',
  },
  afterMCPExecution: {
    hook_event_name: 'afterMCPExecution',
    conversation_id: CONV,
    generation_id: GEN,
    tool_name: 'openbox.get_profile',
    result_json: '{"orgId":"openbox.ai"}',
  },
  postToolUse: {
    hook_event_name: 'postToolUse',
    conversation_id: CONV,
    generation_id: GEN,
  },
  postToolUseFailure: {
    hook_event_name: 'postToolUseFailure',
    conversation_id: CONV,
    generation_id: GEN,
  },
  stop: {
    hook_event_name: 'stop',
    conversation_id: CONV,
  },
};

/** Verdict-shape grouping per the spec. Used by the test to know
 *  what to assert about the response. */
export const PERMISSION_EVENTS: ReadonlySet<EventName> = new Set([
  'beforeSubmitPrompt',
  'beforeReadFile',
  'beforeShellExecution',
  'beforeMCPExecution',
  'preToolUse',
]);

export const OBSERVE_EVENTS: ReadonlySet<EventName> = new Set([
  'afterAgentResponse',
  'afterAgentThought',
  'afterShellExecution',
  'afterFileEdit',
  'afterMCPExecution',
  'postToolUse',
  'postToolUseFailure',
]);

export const NONE_EVENTS: ReadonlySet<EventName> = new Set([
  'sessionStart',
  'stop',
]);
