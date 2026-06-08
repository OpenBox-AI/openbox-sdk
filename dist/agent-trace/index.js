// ts/src/agent-trace/index.ts
import * as fs from "fs";
import * as path from "path";
import { randomUUID, createHash } from "crypto";

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

// ts/src/agent-trace/index.ts
var SPEC_VERSION = "0.1.0";
var LOG_DIR = path.join(openboxDataRoot(), "log");
var LOG_FILE = path.join(LOG_DIR, "agent-trace.jsonl");
function hashContent(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}
function buildRecord(args) {
  const rel = args.workspaceRoot && args.filePath.startsWith(args.workspaceRoot) ? path.relative(args.workspaceRoot, args.filePath) || args.filePath : args.filePath;
  const contributor = args.modelId ? { type: args.contributorType, model_id: args.modelId } : { type: args.contributorType };
  const range = {
    start_line: args.startLine,
    end_line: args.endLine,
    content_hash: hashContent(args.content)
  };
  const conversation = {
    contributor,
    ranges: [range],
    ...args.conversationUrl ? { url: args.conversationUrl } : {}
  };
  return {
    version: SPEC_VERSION,
    id: randomUUID(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...args.tool ? { tool: args.tool } : {},
    ...args.vcs ? { vcs: args.vcs } : {},
    files: [{ path: rel, conversations: [conversation] }],
    ...args.metadata ? { metadata: args.metadata } : {}
  };
}
function writeTraceRecord(record, opts = {}) {
  const file = opts.logFile ?? LOG_FILE;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 448 });
    fs.appendFileSync(file, JSON.stringify(record) + "\n", { mode: 384 });
  } catch {
  }
}
function readTraceLog(opts = {}) {
  const file = opts.logFile ?? LOG_FILE;
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf-8");
  const out = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return out;
}
var TRACE_LOG_PATH = LOG_FILE;
var TRACE_SPEC_VERSION = SPEC_VERSION;
export {
  TRACE_LOG_PATH,
  TRACE_SPEC_VERSION,
  buildRecord,
  hashContent,
  readTraceLog,
  writeTraceRecord
};
