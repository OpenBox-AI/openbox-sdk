import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeCodeConfig } from './config.js';

let logPath: string | null = null;

export function initLogger(cfg: ClaudeCodeConfig) {
  logPath = cfg.logFile;
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  }
}

export function log(hookEvent: string, data: Record<string, unknown>, response?: unknown) {
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

  console.error(`[openbox claude-code] ${hookEvent} | ${JSON.stringify(entry.input)}`);
  if (response) {
    console.error(`[openbox claude-code] -> ${JSON.stringify(response)}`);
  }
}

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
