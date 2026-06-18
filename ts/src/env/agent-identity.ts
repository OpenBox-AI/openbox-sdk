import type { AgentIdentityConfig } from '../core-client/index.js';

export interface AgentIdentitySource {
  OPENBOX_AGENT_DID?: string;
  OPENBOX_AGENT_PRIVATE_KEY?: string;
}

/**
 * Resolve the optional signed agent identity used by Core when an
 * agent has signing_required=true. Both values must be present; a
 * half-configured identity would silently downgrade signed agents
 * back into 401s.
 */
export function resolveAgentIdentity(
  source: AgentIdentitySource = process.env,
): AgentIdentityConfig | undefined {
  const did = source.OPENBOX_AGENT_DID;
  const privateKey = source.OPENBOX_AGENT_PRIVATE_KEY;
  if (!did && !privateKey) return undefined;
  if (!did || !privateKey) {
    throw new Error(
      'OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY.',
    );
  }
  return { did, privateKey };
}
