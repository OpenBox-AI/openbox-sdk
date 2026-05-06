// Profile view - always visible when an API key is set, regardless of
// build flavor. Mirrors mobile's Profile tab's Account card in spirit.
//
// Org API keys are NOT user-tied. The backend's validateApiKey
// (the backend api-key service) sets
// email = undefined and synthesizes sub = "api-key:<keyId>", so an
// org-key's /auth/profile response carries no human identity. We
// surface what's actually available for an org key:
//   - Org id
//   - Active environment
//   - Key id (parsed from the synthetic sub)
//   - Key prefix (first chars of the secret stored locally)
//   - Permission scope count (the key's own permissions[] array)
//
// Sign Out / Change Key / Open Dashboard live in the view's title bar.

import * as vscode from "vscode";
import type { DebugSnapshot } from "./debugInfoPanel";

type Row = "orgId" | "env" | "keyId" | "keyPrefix" | "permissions";

const ROW_ORDER: Row[] = ["orgId", "env", "keyId", "keyPrefix", "permissions"];

export class ProfileProvider implements vscode.TreeDataProvider<Row> {
  private _onDidChange = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private getSnapshot: () => DebugSnapshot) {}

  refresh() { this._onDidChange.fire(undefined); }

  getTreeItem(node: Row): vscode.TreeItem {
    const snap = this.getSnapshot();
    const row = (label: string, description: string, icon: string, tooltip?: string): vscode.TreeItem => {
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.description = description;
      item.iconPath = new vscode.ThemeIcon(icon);
      item.tooltip = tooltip ?? `${label}: ${description}`;
      return item;
    };
    switch (node) {
      case "orgId": return row("Org", snap.orgId || "-", "organization");
      case "env": return row("Environment", snap.env, "globe");
      case "keyId":
        return row("Key ID", snap.keyId || (snap.isApiKeyAuth ? "-" : "(JWT auth)"), "tag");
      case "keyPrefix": return row("API Key", snap.keyPrefix || "-", "key");
      case "permissions": {
        const perms = snap.apiKeyPermissions;
        if (!perms || perms.length === 0) {
          return row("Permissions", snap.isApiKeyAuth ? "(none)" : "(JWT auth)", "shield");
        }
        const description = perms.length <= 3 ? perms.join(", ") : `${perms.length} scopes`;
        const tooltip = `Permissions: ${perms.join(", ")}`;
        return row("Permissions", description, "shield", tooltip);
      }
    }
  }

  getChildren(): Row[] { return [...ROW_ORDER]; }
}
