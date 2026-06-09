/** Minimal config contract every adapter shares. */
interface SharedSessionConfig {
    sessionDir: string;
}
declare function resolveSessionByKey(key: string, cfg: SharedSessionConfig): {
    workflowId: string;
    runId: string;
};
declare function peekSessionByKey(key: string, cfg: SharedSessionConfig): {
    workflowId: string;
    runId: string;
    halted: boolean;
} | null;
declare function markHaltedByKey(key: string, cfg: SharedSessionConfig): void;
declare function clearSessionByKey(key: string, cfg: SharedSessionConfig): void;

declare class SessionStore {
    private dir;
    constructor(sessionDir: string);
    private filePath;
    save(key: string, session: Record<string, unknown>): void;
    load(key: string): Record<string, unknown> | null;
    delete(key: string): void;
    cleanup(maxAgeMs?: number): void;
}

export { SessionStore, type SharedSessionConfig, clearSessionByKey, markHaltedByKey, peekSessionByKey, resolveSessionByKey };
