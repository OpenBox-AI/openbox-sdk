interface LoggerConfig {
    logFile: string | null;
}
interface AdapterLogger {
    initLogger(cfg: LoggerConfig): void;
    log(hookEvent: string, data: Record<string, unknown>, response?: unknown): void;
}
declare function createLogger(adapterName: string): AdapterLogger;

interface HookLogLine {
    ts: string;
    event: string;
    verdict_kind?: 'permission' | 'observe' | 'none' | 'fallback';
    took_ms?: number;
    error?: string;
}
interface HookLogger {
    record(line: HookLogLine): void;
    readonly path: string;
}
/**
 * Creates a host-scoped hook-log writer. The `host` argument is
 * the adapter name and appears in the filename
 * (`<host>-hook.jsonl`). Use a stable, filesystem-safe slug such
 * as `cursor` or `claude-code`.
 */
declare function makeHookLog(host: string): HookLogger;
interface TailHandle {
    stop(): void;
}
interface TailOptions {
    /** Poll interval in milliseconds. Defaults to 1000. */
    intervalMs?: number;
    /** Invoked on the next tick after the file is renamed by
     *  rotation, so the consumer can emit a separator line. */
    onRotated?: () => void;
}
/**
 * Tails a `<host>-hook.jsonl` file, invoking `onLine` once per
 * new JSONL entry. Seeks to the current end of file on start so
 * consumers do not replay history. Polling-based (1 second by
 * default) because `fs.watch` behaves inconsistently across
 * macOS, Linux, and Windows; the channel is for human glance and
 * does not need millisecond resolution.
 *
 * `onLine` receives both the parsed object and the raw text, so
 * malformed entries can still render with whatever the consumer
 * decides to do with the raw line.
 */
declare function tailHookLog(file: string, onLine: (line: HookLogLine, raw: string) => void, options?: TailOptions): TailHandle;

export { type AdapterLogger, type HookLogLine, type HookLogger, type LoggerConfig, type TailHandle, type TailOptions, createLogger, makeHookLog, tailHookLog };
