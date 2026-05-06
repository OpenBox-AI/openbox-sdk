// Mirror of mobile's Profile → Debug card (the mobile app).
// Same field set where it translates: account info, env + API URL,
// auth state, build, runtime counters. Auto-ticks every 5s while
// visible so "Last poll" doesn't go stale; the explicit Reload action
// in the title bar forces an immediate re-render.
//
// Actions live in the view title bar (env switch, mock toggle, seed,
// reset, debug info, reload) - same pattern as Pending/History
// search/filter/refresh - so the tree itself stays read-only.

import * as vscode from "vscode";
import * as os from "os";
import type { EnvName } from "openbox-sdk/env";
import { resolveExtensionUrls } from "./envUrls";
import { dashboardBase } from "./dashboardUrl";
import type { DebugSnapshot } from "./debugInfoPanel";

// Org-level fields only. /auth/profile returns email + sub + name +
// preferred_username for the human who minted the key, but that's
// "key minter info" not "org key info" and reads misleading when the
// key is supposed to be org-scoped. Kept out of the sidebar tree.
type Row =
  | { kind: "orgId" }
  | { kind: "env" }
  | { kind: "apiUrl" }
  | { kind: "dashboard" }
  | { kind: "apiKey" }
  | { kind: "keyPrefix" }
  | { kind: "keyUpdated" }
  | { kind: "keyMetaUnavailable" }
  | { kind: "keyName" }
  | { kind: "keyDescription" }
  | { kind: "keyPermissions" }
  | { kind: "keyValidFrom" }
  | { kind: "keyExpiresAt" }
  | { kind: "keyIpWhitelist" }
  | { kind: "keyActive" }
  | { kind: "keyCreated" }
  | { kind: "keyLastUsed" }
  | { kind: "mockAuth" }
  | { kind: "notifications" }
  | { kind: "pending" }
  | { kind: "history" }
  | { kind: "lastPoll" }
  | { kind: "errors" }
  | { kind: "lastError" }
  | { kind: "version" }
  | { kind: "platform" }
  | { kind: "build" };

// Always-shown rows. Rich key-metadata rows are appended only when
// listApiKeys actually returned something; otherwise we render a
// single "key metadata unavailable" info row instead of N "(JWT-only)"
// rows.
const BASE_ORDER: Row["kind"][] = [
  "orgId",
  "env",
  "apiUrl",
  "dashboard",
  "apiKey",
  "keyPrefix",
  "keyUpdated",
];

const KEY_META_ORDER: Row["kind"][] = [
  "keyName",
  "keyDescription",
  "keyPermissions",
  "keyValidFrom",
  "keyExpiresAt",
  "keyIpWhitelist",
  "keyActive",
  "keyCreated",
  "keyLastUsed",
];

const TAIL_ORDER: Row["kind"][] = [
  "mockAuth",
  "notifications",
  "pending",
  "history",
  "lastPoll",
  "errors",
  "lastError",
  "version",
  "platform",
  "build",
];

function timeAgo(ts: number | undefined): string {
  if (!ts) return "-";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export class DebugControlsProvider implements vscode.TreeDataProvider<Row> {
  private _onDidChange = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private getSnapshot: () => DebugSnapshot) {
    // 5s tick aligns with the pending poll cadence; History's 30s
    // cadence is the slowest moving signal, so a shorter tick still
    // reflects fresh state without overwork. Lives for the extension
    // host's lifetime (lightweight; one fire/sec).
    this.tickTimer = setInterval(() => this._onDidChange.fire(undefined), 5000);
  }

  refresh() { this._onDidChange.fire(undefined); }

  dispose() {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  getTreeItem(node: Row): vscode.TreeItem {
    const cfg = vscode.workspace.getConfiguration("openbox");
    const snap = this.getSnapshot();
    const env: EnvName = snap.env;
    const mock = cfg.get<boolean>("mockAuth", false);
    const notif = cfg.get<boolean>("notifyOnNewApprovals", true);
    const apiUrl = resolveExtensionUrls(env).apiUrl || "(unset)";
    const dashboard = dashboardBase(env) || "(unset)";
    const ext = vscode.extensions.getExtension("OpenBox.openbox") || vscode.extensions.getExtension("openbox.openbox");
    const version = (ext?.packageJSON as any)?.version || "unknown";

    const row = (label: string, description: string, icon: string): vscode.TreeItem => {
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.description = description;
      item.iconPath = new vscode.ThemeIcon(icon);
      // Tooltip echoes both label and value so long URLs (apiUrl,
      // dashboard) don't get truncated by the tree's narrow column.
      item.tooltip = `${label}: ${description}`;
      return item;
    };

    const ak = snap.activeKey;

    switch (node.kind) {
      case "orgId": return row("Org", snap.orgId || "-", "organization");
      case "env": return row("Environment", env, "globe");
      case "apiUrl": return row("API URL", apiUrl, "cloud");
      case "dashboard": return row("Dashboard", dashboard, "link-external");
      case "apiKey": return row("API Key", snap.hasApiKey ? "set" : "unset", snap.hasApiKey ? "key" : "warning");
      case "keyPrefix": return row("Key prefix", snap.keyPrefix || "-", "tag");
      case "keyUpdated": return row("Key updated", timeAgo(snap.keyUpdatedAt ? Date.parse(snap.keyUpdatedAt) : undefined), "clock");
      case "keyMetaUnavailable": {
        // /api-key endpoints are JWT-only on the backend; X-API-Key
        // auth always 401s here regardless of granted scopes. So this
        // info row replaces the rich key-metadata block whenever the
        // backend doesn't open up the endpoint to X-API-Key auth.
        return row("Key metadata", `unreachable (${snap.activeKeyError})`, "info");
      }
      case "keyName": return row("Key name", ak?.name || "-", "tag");
      case "keyDescription": return row("Description", ak?.description || "(none)", "note");
      case "keyPermissions": {
        const perms = ak?.permissions;
        const description = perms && perms.length > 0
          ? perms.length <= 3 ? perms.join(", ") : `${perms.length} permissions`
          : "(none)";
        return row("Permissions", description, "shield");
      }
      case "keyValidFrom": return row("Valid from", ak?.valid_from || "(immediate)", "calendar");
      case "keyExpiresAt": return row("Expires at", ak?.expires_at || "(never)", "clock");
      case "keyIpWhitelist": {
        const ips = ak?.ip_whitelist;
        return row("IP whitelist", ips && ips.length > 0 ? ips.join(", ") : "(any)", "shield");
      }
      case "keyActive": return row("Active", ak?.is_active == null ? "-" : ak.is_active ? "yes" : "no", ak?.is_active ? "pass-filled" : "circle-slash");
      case "keyCreated": return row("Key created", ak?.created_at ? timeAgo(Date.parse(ak.created_at)) : "-", "history");
      case "keyLastUsed": return row("Key last used", ak?.last_used_at ? timeAgo(Date.parse(ak.last_used_at)) : "-", "watch");
      case "mockAuth": return row("Mock Auth", mock ? "on" : "off", mock ? "beaker" : "circle-outline");
      case "notifications": return row("Notifications", notif ? "on" : "off", notif ? "bell" : "bell-slash");
      case "pending": return row("Pending", String(snap.pendingCount), "inbox");
      case "history": return row("History", String(snap.historyCount), "history");
      case "lastPoll": return row("Last poll", timeAgo(snap.lastPollAt), "sync");
      case "errors": return row("Errors", String(snap.errorCount), snap.errorCount > 0 ? "error" : "check");
      case "lastError": {
        const description = snap.lastErrorAt
          ? `${timeAgo(snap.lastErrorAt)}: ${snap.lastErrorMessage || "unknown"}`
          : "-";
        return row("Last error", description, "warning");
      }
      case "version": return row("Version", version, "tag");
      case "platform": return row("Platform", `${os.platform()} ${os.release()}`, "device-desktop");
      case "build": return row("Build", "debug", "tools");
    }
  }

  getChildren(element?: Row): Row[] {
    if (element) return [];
    const snap = this.getSnapshot();
    const order: Row["kind"][] = [...BASE_ORDER];
    if (snap.activeKey) order.push(...KEY_META_ORDER);
    else if (snap.activeKeyError) order.push("keyMetaUnavailable");
    order.push(...TAIL_ORDER);
    return order.map((kind) => ({ kind } as Row));
  }
}
