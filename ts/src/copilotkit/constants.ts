export const DEFAULT_WORKFLOW_TYPE = 'CopilotKitGovernedAction';
export const DEFAULT_AGENT_WORKFLOW_TYPE = 'CopilotKitAgent';
export const DEFAULT_TASK_QUEUE = 'copilotkit';
// Canonical runtime-key format (matches env/generated/env-bindings API_KEY_PATTERN
// and the spec): obx_(live|test)_ + 48 lowercase-hex. Reconciled to the strict
// form so all key validators agree (the looser prefix-only check is dropped).
export const OPENBOX_RUNTIME_KEY_PATTERN = /^obx_(live|test)_[0-9a-f]{48}$/;
export const OPENBOX_BACKEND_API_KEY_PATTERN = /^obx_key_/;
export const OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY =
  '__openboxRuntimePromptGoverned';
export const MAX_RUNTIME_MESSAGES = 10;
export const MAX_RUNTIME_SYSTEM_CHARS = 400;
export const MAX_RUNTIME_MESSAGE_CHARS = 1_200;
export const MAX_RUNTIME_TOOL_DESCRIPTION_CHARS = 500;
export const MAX_RUNTIME_TOOL_CALLS = 6;
export const MAX_RUNTIME_COLLECTION_ITEMS = 8;
export const MAX_RUNTIME_OBJECT_KEYS = 12;
export const OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION =
  'openbox.copilotkit.result.v1' as const;
