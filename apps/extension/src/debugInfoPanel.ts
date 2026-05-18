// Mirrors mobile's Profile → Debug card. Shows the same fields where
// they translate (env, API URL, version, platform, mock-auth state,
// notification-toast setting) plus extension-specific signals (last
// poll time, error count). No live tick subscription; the user
// triggers a refresh by re-running the command.

import * as vscode from "vscode";
import * as os from "os";
import type { EnvName } from "openbox-sdk/env";
import { resolveExtensionUrls } from "./envUrls";
import { dashboardBase } from "./dashboardUrl";

export interface DebugSnapshot {
  env: EnvName;
  // /auth/profile fields (UserProfile schema): sub, email, name,
  // preferred_username, email_verified, orgId. Anything not on this
  // list isn't reachable for an X-API-Key call without a backend
  // addition (e.g. /api-key/me). Backend ApiKey schema has more
  // (name, expires_at, last_used_at, ip_whitelist, permissions[], etc.)
  // but the extension only knows the secret string, not the key id,
  // and there's no "current key" endpoint to look it up.
  sub: string | undefined;
  email: string | undefined;
  name: string | undefined;
  preferredUsername: string | undefined;
  emailVerified: boolean | undefined;
  orgId: string | undefined;
  hasApiKey: boolean;
  // First chars of the key secret (safe - entropy is in the trailing
  // hex). Used as a stable visual identifier when the rich
  // listApiKeys metadata can't be fetched.
  keyPrefix: string | undefined;
  // X-API-Key only: backend returns sub = "api-key:<keyId>" so we
  // can extract the key id without hitting listApiKeys. Permissions
  // is the key's own scope array (read:agent, create:agent, etc),
  // which the backend reads off the apiKey record at auth time.
  keyId: string | undefined;
  apiKeyPermissions: string[] | undefined;
  isApiKeyAuth: boolean;
  // Token-store metadata for the org API key. updatedAt is when the
  // key was written; permissions / features come from the token store
  // if a flow hydrated them (the CLI's set-api-key + permission probe
  // does, the extension's Set API Key flow doesn't; it only knows
  // the secret).
  keyUpdatedAt: string | undefined;
  permissions: string[] | undefined;
  features: Record<string, boolean> | undefined;
  // Active API key metadata, resolved server-side via listApiKeys +
  // last_used_at heuristic. Undefined when listApiKeys 403s (key
  // lacks read:api_key) or when the org has no keys at all.
  activeKey: {
    id: string;
    name: string;
    description?: string;
    permissions?: string[];
    valid_from?: string | null;
    expires_at?: string | null;
    ip_whitelist?: string[] | null;
    is_active?: boolean;
    created_at?: string;
    last_used_at?: string | null;
  } | undefined;
  // Reason the active key fields are unavailable (when undefined).
  // Surfaces as a parenthetical hint on each debug row so the user
  // knows whether it's a permission gap, a network error, etc.
  activeKeyError: string | undefined;
  pendingCount: number;
  historyCount: number;
  lastPollAt: number | undefined;
  lastErrorAt: number | undefined;
  lastErrorMessage: string | undefined;
  errorCount: number;
}

const VIEW_TYPE = "openbox.debugInfo";

let current: vscode.WebviewPanel | undefined;

export function showDebugInfoPanel(context: vscode.ExtensionContext, getSnapshot: () => DebugSnapshot) {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  if (current) {
    current.reveal(column);
    current.webview.html = render(current.webview, context, getSnapshot());
    return;
  }

  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "OpenBox · Debug", column, {
    enableScripts: true,
    localResourceRoots: [],
    retainContextWhenHidden: false,
  });
  current = panel;
  panel.onDidDispose(() => {
    if (current === panel) current = undefined;
  });

  panel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "refresh") panel.webview.html = render(panel.webview, context, getSnapshot());
  });

  panel.webview.html = render(panel.webview, context, getSnapshot());
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  const c: any = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return "-";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function render(webview: vscode.Webview, context: vscode.ExtensionContext, snap: DebugSnapshot): string {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${webview.cspSource}`,
    `script-src 'nonce-${n}'`,
  ].join("; ");

  const apiUrl = resolveExtensionUrls(snap.env).apiUrl || "(unset)";
  const dashboard = dashboardBase(snap.env) || "(unset)";
  const notifyOn = vscode.workspace.getConfiguration("openbox").get<boolean>("notifyOnNewApprovals", true);
  const extension = vscode.extensions.getExtension("OpenBox.openbox") || vscode.extensions.getExtension("openbox.openbox");
  const version = (extension?.packageJSON as any)?.version || "unknown";

  const ak = snap.activeKey;
  // /auth/profile UserProfile fields (email, sub, name,
  // preferred_username, email_verified) describe the human who
  // minted the key, not the key itself; hidden. Features (local
  // TokenEntry field) is dropped - the extension's Set API Key flow
  // doesn't populate it.
  const rows: { label: string; value: string }[] = [
    { label: "Org ID", value: snap.orgId || "-" },
    { label: "Environment", value: snap.env },
    { label: "API URL", value: apiUrl },
    { label: "Dashboard", value: dashboard },
    { label: "API key", value: snap.hasApiKey ? "set" : "unset" },
    { label: "Key prefix", value: snap.keyPrefix || "-" },
    { label: "Key updated (local)", value: snap.keyUpdatedAt ? `${snap.keyUpdatedAt} (${timeAgo(Date.parse(snap.keyUpdatedAt))})` : "-" },
  ];

  // Rich key metadata only when listApiKeys actually came back. /api-key
  // endpoints are JWT-only today (X-API-Key auth always 401s); when
  // that's the case, collapse the whole block to a single info row
  // instead of nine "(JWT-only)" lines.
  if (ak) {
    rows.push(
      { label: "Key id", value: ak.id },
      { label: "Key name", value: ak.name },
      { label: "Description", value: ak.description || "(none)" },
      { label: "Permissions", value: ak.permissions && ak.permissions.length > 0 ? ak.permissions.join(", ") : "(none)" },
      { label: "Valid from", value: ak.valid_from || "(immediate)" },
      { label: "Expires at", value: ak.expires_at || "(never)" },
      { label: "IP whitelist", value: ak.ip_whitelist && ak.ip_whitelist.length > 0 ? ak.ip_whitelist.join(", ") : "(any)" },
      { label: "Active", value: ak.is_active == null ? "-" : ak.is_active ? "yes" : "no" },
      { label: "Created at", value: ak.created_at || "-" },
      { label: "Last used at", value: ak.last_used_at || "(never)" },
    );
  } else if (snap.activeKeyError) {
    rows.push({ label: "Key metadata", value: `unreachable (${snap.activeKeyError})` });
  }

  rows.push(
    { label: "Notifications", value: notifyOn ? "on" : "off" },
    { label: "Pending count", value: String(snap.pendingCount) },
    { label: "History count", value: String(snap.historyCount) },
    { label: "Last poll", value: timeAgo(snap.lastPollAt) },
    { label: "Errors", value: String(snap.errorCount) },
    { label: "Last error", value: snap.lastErrorAt ? `${timeAgo(snap.lastErrorAt)}: ${snap.lastErrorMessage}` : "-" },
    { label: "Version", value: version },
    { label: "Platform", value: `${os.platform()} ${os.release()}` },
    { label: "Node", value: process.version },
  );

  return /* html */ `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>OpenBox · Debug</title>
<style>
  body {
    margin: 0;
    padding: 24px 32px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
  .card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
    border-radius: 8px;
    overflow: hidden;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
  }
  .row:last-child { border-bottom: none; }
  .lbl {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .val {
    font-size: 13px;
    text-align: right;
    font-family: var(--vscode-editor-font-family);
    word-break: break-all;
  }
  .toolbar { margin-top: 16px; display: flex; gap: 8px; }
  button {
    height: 30px;
    padding: 0 14px;
    border-radius: 5px;
    border: 1px solid transparent;
    cursor: pointer;
    font: inherit;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
  <h1>OpenBox · Debug</h1>
  <div class="card">
    ${rows.map((r) => `<div class="row"><span class="lbl">${escapeHtml(r.label)}</span><span class="val">${escapeHtml(r.value)}</span></div>`).join("")}
  </div>
  <div class="toolbar">
    <button id="refresh">Refresh</button>
  </div>
  <script nonce="${n}">
    const v = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => v.postMessage({ type: 'refresh' }));
  </script>
</body></html>`;
}
