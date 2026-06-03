// Adapter-agnostic logger factory. Each runtime adapter calls
// `createLogger('claude-code')` (or 'cursor', etc.) once and re-exports
// the returned `initLogger`/`log` from its own logger.ts so import
// paths stay stable.
import fs from 'node:fs';
import path from 'node:path';

export interface LoggerConfig {
  logFile: string | null;
}

export interface AdapterLogger {
  initLogger(cfg: LoggerConfig): void;
  log(hookEvent: string, data: Record<string, unknown>, response?: unknown): void;
}

export function createLogger(adapterName: string): AdapterLogger {
  let logPath: string | null = null;

  function summarize(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string' && v.length > 200) {
        out[k] = v.slice(0, 200) + `... (${v.length} chars)`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  return {
    initLogger(cfg: LoggerConfig) {
      logPath = cfg.logFile;
      if (logPath) fs.mkdirSync(path.dirname(logPath), { recursive: true });
    },
    log(hookEvent, data, response) {
      const entry = {
        ts: new Date().toISOString(),
        hook: hookEvent,
        input: summarize(data),
        response: response ?? null,
      };
      const line = JSON.stringify(entry);

      if (logPath) {
        try { fs.appendFileSync(logPath, line + '\n'); } catch { /* ignore */ }
      }

      console.error(`[openbox ${adapterName}] ${hookEvent} | ${JSON.stringify(entry.input)}`);
      if (response) {
        console.error(`[openbox ${adapterName}] -> ${JSON.stringify(response)}`);
      }
    },
  };
}
