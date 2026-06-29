import { API_KEY_PATTERN } from '../env/generated/env-bindings.js';

export const DEFAULT_WORKFLOW_TYPE = 'CopilotKitGovernedAction';
export const DEFAULT_AGENT_WORKFLOW_TYPE = 'CopilotKitAgent';
export const DEFAULT_TASK_QUEUE = 'copilotkit';
// Canonical runtime-key format — single spec source (env/generated/env-bindings
// API_KEY_PATTERN, from the TypeSpec contract). Re-exported here so existing
// imports keep working; no hand-rolled regex.
export const OPENBOX_RUNTIME_KEY_PATTERN = API_KEY_PATTERN;
export const OPENBOX_BACKEND_API_KEY_PATTERN = /^obx_key_/;
export const OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY =
  '__openboxRuntimePromptGoverned';
export const MAX_RUNTIME_MESSAGES = 10;
// Governance-fidelity caps: Core's prompt/assistant gates must see enough of the
// real text for injection / jailbreak / goal-drift policies to fire. The earlier
// 400 / 1200 caps truncated long prompts so content past them was never
// evaluated (a governance blind-spot). Raised to cover realistic prompts while
// staying bounded; the canonical Python SDK sends the extracted prompt uncapped.
export const MAX_RUNTIME_SYSTEM_CHARS = 8_000;
export const MAX_RUNTIME_MESSAGE_CHARS = 24_000;
export const MAX_RUNTIME_TOOL_DESCRIPTION_CHARS = 500;
export const MAX_RUNTIME_TOOL_CALLS = 6;
export const MAX_RUNTIME_COLLECTION_ITEMS = 8;
export const MAX_RUNTIME_OBJECT_KEYS = 12;
export const OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION =
  'openbox.copilotkit.result.v1' as const;
