import { b as OpenBoxClient } from '../client-C43Hkmge.js';
import '../responses-C2s9PwZF.js';
import '../env-bindings-CCaolEHB.js';

interface ConsumerClientOptions {
    /** Explicit endpoint overrides for endpoint-first/self-hosted consumers. */
    apiUrl?: string;
    coreUrl?: string;
    authUrl?: string;
    platformUrl?: string;
    /**
     * Returns the X-API-Key. May be sync or async. Return
     * undefined / empty string to signal "no key configured"; the
     * factory throws a uniform error in that case.
     */
    getApiKey: () => Promise<string | undefined> | string | undefined;
    /**
     * Value sent in the `X-Openbox-Client` header so the backend can
     * attribute traffic to a specific consumer (e.g. "apps/extension",
     * "apps/mobile"). Defaults to "@openbox-ai/openbox-sdk/client-factory" so an
     * unattributed call still shows up clearly in audit logs.
     */
    clientName?: string;
    /**
     * Override the per-request timeout (ms). Falls back to the SDK's
     * default when omitted; caller should rarely need to set this
     * unless governing operations that block on long approval windows.
     */
    timeoutMs?: number;
}
interface ConsumerClientContext {
    client: OpenBoxClient;
    /** Resolved API base URL; handy for "Signed in to <apiBase>"
     *  affordances without re-resolving the env. */
    apiBase: string;
}
/**
 * Build an `OpenBoxClient` for one consumer + explicit URL target. Throws a uniform
 * error when no API key is available so the caller can render the
 * same "set your API key" prompt regardless of which token source
 * they plugged in.
 */
declare function createConsumerClient(opts: ConsumerClientOptions): Promise<ConsumerClientContext>;

export { type ConsumerClientContext, type ConsumerClientOptions, createConsumerClient };
