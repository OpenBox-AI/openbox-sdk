// ts/src/logging/logger.ts
import fs from "fs";
import path from "path";
function createLogger(adapterName) {
  let logPath = null;
  function summarize(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.length > 200) {
        out[k] = v.slice(0, 200) + `... (${v.length} chars)`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return {
    initLogger(cfg) {
      logPath = cfg.logFile;
      if (logPath) fs.mkdirSync(path.dirname(logPath), { recursive: true });
    },
    log(hookEvent, data, response) {
      const entry = {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        hook: hookEvent,
        input: summarize(data),
        response: response ?? null
      };
      const line = JSON.stringify(entry);
      if (logPath) {
        try {
          fs.appendFileSync(logPath, line + "\n");
        } catch {
        }
      }
      console.error(`[openbox ${adapterName}] ${hookEvent} | ${JSON.stringify(entry.input)}`);
      if (response) {
        console.error(`[openbox ${adapterName}] -> ${JSON.stringify(response)}`);
      }
    }
  };
}

// ts/src/logging/hook-log.ts
import * as fs2 from "fs";
import * as path2 from "path";

// ts/src/env/os-paths.ts
import { homedir } from "os";
import { join } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "openbox");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, "openbox");
  }
  return join(homedir(), ".openbox");
}

// ts/src/logging/hook-log.ts
function logDir() {
  return path2.join(openboxDataRoot(), "log");
}
var MAX_BYTES = 5 * 1024 * 1024;
function ensureDir(dir) {
  if (!fs2.existsSync(dir)) fs2.mkdirSync(dir, { recursive: true, mode: 448 });
}
function rotateIfNeeded(file) {
  try {
    const st = fs2.statSync(file);
    if (st.size < MAX_BYTES) return;
  } catch {
    return;
  }
  try {
    fs2.renameSync(file, `${file}.1`);
  } catch {
  }
}
function makeHookLog(host) {
  const initialDir = logDir();
  const initialFile = path2.join(initialDir, `${host}-hook.jsonl`);
  return {
    path: initialFile,
    record(line) {
      try {
        const dir = logDir();
        const file = path2.join(dir, `${host}-hook.jsonl`);
        ensureDir(dir);
        rotateIfNeeded(file);
        fs2.appendFileSync(file, JSON.stringify(line) + "\n", { mode: 384 });
      } catch {
      }
    }
  };
}
function tailHookLog(file, onLine, options = {}) {
  const intervalMs = options.intervalMs ?? 1e3;
  let cursor = 0;
  try {
    cursor = fs2.statSync(file).size;
  } catch {
    cursor = 0;
  }
  const tick = () => {
    let size = 0;
    try {
      size = fs2.statSync(file).size;
    } catch {
      return;
    }
    if (size === cursor) return;
    if (size < cursor) {
      cursor = 0;
      options.onRotated?.();
    }
    let chunk;
    try {
      const fd = fs2.openSync(file, "r");
      const len = size - cursor;
      chunk = Buffer.alloc(len);
      fs2.readSync(fd, chunk, 0, len, cursor);
      fs2.closeSync(fd);
    } catch {
      return;
    }
    cursor = size;
    const text = chunk.toString("utf-8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let parsed = {};
      try {
        parsed = JSON.parse(line);
      } catch {
      }
      onLine(parsed, line);
    }
  };
  const timer = setInterval(tick, intervalMs);
  return {
    stop() {
      clearInterval(timer);
    }
  };
}
export {
  createLogger,
  makeHookLog,
  tailHookLog
};
