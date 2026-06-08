import { g as TokenStore } from '../env-bindings--BxVwc6f.js';

interface AgentKeyRecord {
    agentId: string;
    agentName?: string;
    runtimeKey: string;
    /** ISO-8601 timestamp the key was captured. */
    recordedAt: string;
}
/** Persist the runtime key for an agent. Last-write-wins on agentId. */
declare function recordAgentKey(agentId: string, runtimeKey: string, agentName?: string): void;
/** Look up a previously-recorded runtime key. */
declare function recallAgentKey(agentId: string): AgentKeyRecord | null;
/** Path lookup for callers that want to surface the location to users. */
declare function agentKeysPath(): string;

declare function getTokenPath(): string;
declare function readTokenStore(): TokenStore;
declare function loadApiKey(): string | undefined;
declare function saveApiKey(apiKey: string): void;
declare function clearApiKey(): boolean;
declare function hasApiKey(): boolean;

export { type AgentKeyRecord, agentKeysPath, clearApiKey, getTokenPath, hasApiKey, loadApiKey, readTokenStore, recallAgentKey, recordAgentKey, saveApiKey };
