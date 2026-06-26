import type { AgentIdentityConfig } from '../core-client/index.js';
import { EXIT, bailWith } from './exit-codes.js';
import { error } from './output.js';

export interface AgentIdentityOptions {
  agentDid?: string;
  agentPrivateKey?: string;
}

export function hasAgentIdentityOptions(opts: AgentIdentityOptions): boolean {
  return opts.agentDid !== undefined || opts.agentPrivateKey !== undefined;
}

export function parseAgentIdentityOptions(
  opts: AgentIdentityOptions,
): AgentIdentityConfig | undefined {
  if (!hasAgentIdentityOptions(opts)) return undefined;
  if (!opts.agentDid || !opts.agentPrivateKey) {
    error('--agent-did and --agent-private-key must be provided together');
    bailWith(EXIT.USAGE);
  }
  return {
    did: opts.agentDid,
    privateKey: opts.agentPrivateKey,
  };
}
