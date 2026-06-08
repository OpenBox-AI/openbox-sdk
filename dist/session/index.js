// ts/src/session/resolver.ts
import { randomUUID } from "crypto";

// ts/src/session/store.ts
import fs from "fs";
import path from "path";
var SessionStore = class {
  dir;
  constructor(sessionDir) {
    this.dir = sessionDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }
  filePath(key) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }
  save(key, session) {
    fs.writeFileSync(this.filePath(key), JSON.stringify(session), { mode: 384, encoding: "utf-8" });
  }
  load(key) {
    const fp = this.filePath(key);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }
  delete(key) {
    const fp = this.filePath(key);
    try {
      fs.unlinkSync(fp);
    } catch {
    }
  }
  cleanup(maxAgeMs = 864e5) {
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(this.dir)) {
        const fp = path.join(this.dir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fp);
        }
      }
    } catch {
    }
  }
};

// ts/src/session/resolver.ts
var stores = /* @__PURE__ */ new WeakMap();
function getStore(cfg) {
  let s = stores.get(cfg);
  if (!s) {
    s = new SessionStore(cfg.sessionDir);
    stores.set(cfg, s);
  }
  return s;
}
function resolveSessionByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing && !existing.halted) {
    return { workflowId: existing.workflowId, runId: existing.runId };
  }
  const workflowId = randomUUID();
  const runId = randomUUID();
  store.save(key, { workflowId, runId });
  return { workflowId, runId };
}
function peekSessionByKey(key, cfg) {
  const existing = getStore(cfg).load(key);
  if (!existing) return null;
  return {
    workflowId: existing.workflowId,
    runId: existing.runId,
    halted: existing.halted ?? false
  };
}
function markHaltedByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing) store.save(key, { ...existing, halted: true });
}
function clearSessionByKey(key, cfg) {
  getStore(cfg).delete(key);
}
export {
  SessionStore,
  clearSessionByKey,
  markHaltedByKey,
  peekSessionByKey,
  resolveSessionByKey
};
