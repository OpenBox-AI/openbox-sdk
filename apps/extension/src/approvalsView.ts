import * as vscode from "vscode";
import type { Approval } from "./types";
import {
  formatLabel,
  summarizeInput,
  timeAgo,
  timeRemaining,
  statusOf,
} from "openbox-sdk/approvals";
import { sanitizeReason } from "./format";

// Tree nodes. Each approval is a collapsible parent with child rows
// for tier / reason / created / expiry, mimicking mobile's
// ApprovalCard layout within VS Code's one-line-per-item constraint.
// History view groups approvals under section headers (Approved /
// Rejected / Expired) - same data, three buckets - so the user sees
// status splits at a glance, equivalent to mobile's segmented picker
// without forcing a one-at-a-time toggle. Empty state is not a node;
// returning [] lets package.json's per-view viewsWelcome render.
type TreeNode =
  | { kind: "approval"; approval: Approval }
  | { kind: "load-more" }
  | { kind: "field"; approval: Approval; field: FieldKind }
  | { kind: "section"; status: SectionStatus };

type FieldKind = "tier" | "reason" | "created" | "expires" | "decided";
type SectionStatus = "approved" | "rejected" | "expired";

const SECTION_ORDER: SectionStatus[] = ["approved", "rejected", "expired"];

export class ApprovalsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private approvals: Approval[] = [];
  private hasMore = false;
  private loadMoreCommand?: string;
  private countdownTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private opts: { groupByStatus?: boolean; showLoadMore?: boolean } = {}) {}

  setLoadMoreCommand(cmd: string) {
    this.loadMoreCommand = cmd;
  }

  update(approvals: Approval[], hasMore: boolean = false) {
    this.approvals = approvals;
    this.hasMore = hasMore;
    this._onDidChange.fire(undefined);
    this.startCountdown();
  }

  // 1Hz tick mirrors mobile's global timeTick. Only runs when at least
  // one row carries an expiry timestamp; otherwise the tree is static
  // and a timer would just churn re-renders for nothing.
  private startCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (!this.approvals.some((a) => a.approval_expired_at)) return;
    this.countdownTimer = setInterval(() => this._onDidChange.fire(undefined), 1000);
  }

  dispose() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "load-more") {
      const item = new vscode.TreeItem("Load more…", vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("ellipsis");
      item.contextValue = "load-more";
      if (this.loadMoreCommand) {
        item.command = { command: this.loadMoreCommand, title: "Load more" };
      }
      return item;
    }

    if (node.kind === "section") return renderSection(node.status, this.approvalsForStatus(node.status).length);

    if (node.kind === "field") return renderField(node.approval, node.field);

    const a = node.approval;
    const action = a.action_type || a.activity_type || "";
    const summary = summarizeInput(action, a.input);
    const agent = approvalLabel(a, summary);

    // Collapsed by default so the list reads as a tight overview.
    // The chevron expands to show tier / reason / created / expiry as
    // mobile-card-style child rows; VS Code persists per-row state.
    const item = new vscode.TreeItem(agent, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `approval-${a.id}`;
    const isPending = (a.status || "").toLowerCase() === "pending" || (!a.status && a.verdict === 2 && !!a.approval_expired_at);
    item.contextValue = isPending ? "approval" : "approval-decided";
    item.iconPath = iconFor(a);

    // description = the dimmer label after the agent name. The
    // type-aware summary (`$ rm -rf /tmp` for Shell, prompt head for
    // LLM, file path for FileEdit) when input has something useful;
    // otherwise the formatted action_type so the row never reads as
    // just an agent name with no context.
    if (summary) {
      item.description = action ? `${formatLabel(action)} · ${truncate(summary, 80)}` : truncate(summary, 80);
    } else if (action) {
      item.description = formatLabel(action);
    }

    item.tooltip = buildTooltip(a, summary);
    item.command = {
      command: "openbox.openDetail",
      title: "Open approval",
      arguments: [a],
    };

    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Return [] (not a placeholder node) when empty so the per-view
      // viewsWelcome content takes over with the right per-view copy.
      if (this.approvals.length === 0) return [];

      // History groups by status; pending stays a flat list because
      // every row has the same status by definition. All three
      // sections render unconditionally (with count 0 when empty) so
      // the user knows the buckets exist even on a quiet day.
      if (this.opts.groupByStatus) {
        const sections: TreeNode[] = SECTION_ORDER.map((status) => ({ kind: "section", status }));
        if (this.shouldShowLoadMore()) sections.push({ kind: "load-more" });
        return sections;
      }

      const rows: TreeNode[] = this.approvals.map((a) => ({ kind: "approval" as const, approval: a }));
      if (this.shouldShowLoadMore()) rows.push({ kind: "load-more" });
      return rows;
    }
    if (element.kind === "section") {
      return this.approvalsForStatus(element.status).map((a) => ({ kind: "approval" as const, approval: a }));
    }
    if (element.kind === "approval") return childFields(element.approval);
    return [];
  }

  private approvalsForStatus(status: SectionStatus): Approval[] {
    return this.approvals.filter((a) => statusOf(a) === status);
  }

  private shouldShowLoadMore(): boolean {
    return this.hasMore && !!this.loadMoreCommand && this.opts.showLoadMore !== false;
  }
}

function approvalLabel(a: Approval, summary: string | null): string {
  if (a.agent?.agent_name) return a.agent.agent_name;
  if (summary) return truncate(summary, 80);
  const action = a.action_type || a.activity_type;
  if (action) return formatLabel(action);
  return "Approval";
}

// Bucket each approval into one of the three section kinds.
// Precedence:
//   1. wire `status` if present ("approved" / "rejected" / "expired" /
//      "pending") - backend's explicit signal.
//   2. otherwise: decided_at + verdict - Allow/Constrain on a decided
//      row → approved; Block/Halt → rejected.
//   3. otherwise: undecided + approval_expired_at past → expired.
//      Mobile's fixtures encode expiry exactly this way (verdict=2 +
//      decided_at=null + approval_expired_at<now) and rely on the
//      consumer to derive the bucket. Without this branch every
//      expired-by-timeout row falls through to "pending" and
//      vanishes from the History view.
// statusOf is the canonical SDK helper from openbox-sdk/approvals.
// The extension hands it the same row shape the mobile app does, so
// the bucket assignment stays consistent across surfaces.

function renderSection(status: SectionStatus, count: number): vscode.TreeItem {
  const labels: Record<SectionStatus, string> = {
    approved: "Approved",
    rejected: "Rejected",
    expired: "Expired",
  };
  const icons: Record<SectionStatus, { name: string; color: string }> = {
    approved: { name: "pass", color: "testing.iconPassed" },
    rejected: { name: "error", color: "testing.iconFailed" },
    expired: { name: "circle-slash", color: "disabledForeground" },
  };
  const item = new vscode.TreeItem(labels[status], vscode.TreeItemCollapsibleState.Expanded);
  item.id = `section-${status}`;
  item.description = String(count);
  const icon = icons[status];
  item.iconPath = new vscode.ThemeIcon(icon.name, new vscode.ThemeColor(icon.color));
  item.contextValue = "section";
  return item;
}

// Per-approval child fields shown when the row is expanded. Order
// matches mobile's ApprovalCard footer: Tier → Reason → Created →
// Expires (pending) or Approved/Rejected/Expired (decided).
function childFields(a: Approval): TreeNode[] {
  const fields: FieldKind[] = [];
  if (a.metadata?.trust_tier != null) fields.push("tier");
  if (a.reason) fields.push("reason");
  if (a.created_at) fields.push("created");
  if (a.decided_at && (a.verdict === 0 || a.verdict === 1 || a.verdict === 3 || a.verdict === 4)) {
    fields.push("decided");
  } else if (a.approval_expired_at) {
    fields.push("expires");
  }
  return fields.map((field) => ({ kind: "field" as const, approval: a, field }));
}

function renderField(a: Approval, field: FieldKind): vscode.TreeItem {
  const item = new vscode.TreeItem("", vscode.TreeItemCollapsibleState.None);
  item.id = `approval-${a.id}-${field}`;

  switch (field) {
    case "tier": {
      const tier = a.metadata?.trust_tier!;
      item.label = `Tier ${tier}`;
      item.iconPath = new vscode.ThemeIcon("verified", tierThemeColor(tier));
      break;
    }
    case "reason": {
      const clean = sanitizeReason(a.reason);
      item.label = truncate(clean, 200);
      item.iconPath = new vscode.ThemeIcon("comment");
      item.tooltip = clean;
      break;
    }
    case "created": {
      item.label = `Created ${timeAgo(a.created_at)}`;
      item.iconPath = new vscode.ThemeIcon("clock");
      break;
    }
    case "expires": {
      const remaining = timeRemaining(a.approval_expired_at);
      item.label = remaining === "expired" ? "Expired" : `Expires in ${remaining}`;
      item.iconPath = new vscode.ThemeIcon(remaining === "expired" ? "circle-slash" : "watch");
      break;
    }
    case "decided": {
      const isApproved = a.verdict === 0 || a.verdict === 1;
      const word = isApproved ? "Approved" : "Rejected";
      item.label = `${word} ${timeAgo(a.decided_at)}`;
      item.iconPath = new vscode.ThemeIcon(
        isApproved ? "pass" : "error",
        new vscode.ThemeColor(isApproved ? "testing.iconPassed" : "testing.iconFailed"),
      );
      break;
    }
  }

  return item;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Icon per status + tier for pending rows. VS Code ThemeColor tokens
// adapt to the user's theme; the tier mapping mirrors mobile's
// brand.tierColor (4+: green, 3: blue, 2: orange, 1: red) so a tier-1
// pending row jumps out the same way it does on iOS.
function iconFor(a: Approval): vscode.ThemeIcon {
  const status = (a.status || "").toLowerCase();
  if (status === "approved" || a.verdict === 0 || a.verdict === 1)
    return new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
  if (status === "rejected" || a.verdict === 3 || a.verdict === 4)
    return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
  if (status === "expired") return new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground"));
  return new vscode.ThemeIcon("shield", tierThemeColor(a.metadata?.trust_tier));
}

function tierThemeColor(tier: number | undefined): vscode.ThemeColor | undefined {
  if (tier == null) return undefined;
  if (tier >= 4) return new vscode.ThemeColor("testing.iconPassed");
  if (tier === 3) return new vscode.ThemeColor("charts.blue");
  if (tier === 2) return new vscode.ThemeColor("charts.orange");
  return new vscode.ThemeColor("testing.iconFailed");
}

// Markdown tooltip: title + key/value rows + a fenced code block for
// the input payload. VS Code renders this with theme-correct styling
// for free, beating a hand-rolled ASCII tooltip on every axis.
function buildTooltip(a: Approval, summary: string | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.supportThemeIcons = true;

  const agent = approvalLabel(a, summary);
  const action = a.action_type || a.activity_type;

  md.appendMarkdown(`**${escapeMd(agent)}**\n\n`);
  if (action) md.appendMarkdown(`$(symbol-event) ${escapeMd(formatLabel(action))}\n\n`);

  const tier = a.metadata?.trust_tier;
  if (tier != null) md.appendMarkdown(`$(verified) Trust Tier ${tier}\n\n`);

  // Outcome word for decided rows. Pending rows omit it - the shield
  // icon + the Expires-in child row already convey the state. Raw
  // verdict labels (Allow/Constrain/Block/Halt) aren't shown anywhere
  // user-facing; they're backend enum values, not UX copy.
  const status = (a.status || "").toLowerCase();
  if (status === "approved" || a.verdict === 0 || a.verdict === 1) {
    md.appendMarkdown(`$(pass) Approved\n\n`);
  } else if (status === "rejected" || a.verdict === 3 || a.verdict === 4) {
    md.appendMarkdown(`$(error) Rejected\n\n`);
  } else if (status === "expired") {
    md.appendMarkdown(`$(circle-slash) Expired\n\n`);
  }

  if (a.reason) md.appendMarkdown(`> ${escapeMd(sanitizeReason(a.reason))}\n\n`);

  if (summary) {
    const lang = action === "ShellExecution" || action === "ShellOutput" ? "bash" : "";
    md.appendMarkdown(`\`\`\`${lang}\n${summary}\n\`\`\`\n`);
  }

  if (a.created_at) md.appendMarkdown(`\n$(clock) Requested ${timeAgo(a.created_at)}`);
  if (a.approval_expired_at) md.appendMarkdown(`  ·  $(watch) Expires in ${timeRemaining(a.approval_expired_at)}`);

  return md;
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}\[\]()#+\-.!|]/g, (c) => `\\${c}`);
}
