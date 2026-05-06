// Profile view. Mirrors the mobile app's Profile / Account card:
// the user-facing identity rows only.
//
// Mobile signs in with JWT and surfaces Email + Org. The extension
// only ever uses X-API-Key auth, where the backend sets
// email = undefined and synthesises sub = "api-key:<keyId>" -
// there's no human identity to render. Showing an empty "Email: -"
// row would be noise, so the X-API-Key path renders Org alone (or
// nothing if the org-id never came back from /auth/profile).
//
// If a future build ever adds JWT auth on this surface,
// snap.isApiKeyAuth will flip false and the email row lights up
// automatically.
//
// Sign Out / Set API Key / Open Dashboard sit in the view's title
// bar (see package.json view/title menu).

import * as vscode from "vscode";
import type { DebugSnapshot } from "./debugInfoPanel";

type Row = "email" | "orgId";

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
      case "email": return row("Email", snap.email || snap.preferredUsername || "-", "account");
      case "orgId": return row("Org", snap.orgId || "-", "organization");
    }
  }

  getChildren(): Row[] {
    const snap = this.getSnapshot();
    const rows: Row[] = [];
    // X-API-Key sessions don't carry a human identity. Hide the
    // Email row entirely instead of showing a placeholder.
    if (!snap.isApiKeyAuth) rows.push("email");
    if (snap.orgId) rows.push("orgId");
    return rows;
  }
}
