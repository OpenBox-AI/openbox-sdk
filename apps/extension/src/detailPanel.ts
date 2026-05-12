// Webview detail panel for an approval. Mirrors mobile's
// app/approval/[id].tsx; shows hero (agent), action_type pill, action
// summary, reason, team/owner, created/expiry, Approve/Reject buttons.
//
// CSP+nonce + default-src 'none' so a hostile agent_name / reason can't
// load remote content or inline-execute. Theme via var(--vscode-*) so
// light / dark / high-contrast all just work.

import * as vscode from "vscode";
import type { OpenBoxClient } from "openbox-sdk/client";
import type { Approval, Agent, Member } from "./types";
import { formatLabel, summarizeInput, timeAgo, timeRemaining } from "openbox-sdk/approvals";
import { sanitizeReason } from "./format";

type DecideAction = "approve" | "reject";

interface PanelDeps {
  client: OpenBoxClient;
  orgId: string;
  env: string;
  onDecided: (id: string) => void;
}

const VIEW_TYPE = "openbox.approvalDetail";

export class ApprovalDetailPanel {
  private static current: ApprovalDetailPanel | undefined;

  // Closes any open detail panel. Used on sign out / env switch /
  // boot reset so the user doesn't get left looking at a stale
  // approval after their auth state changed.
  static disposeCurrent() {
    if (ApprovalDetailPanel.current) {
      ApprovalDetailPanel.current.dispose();
    }
  }

  static show(approval: Approval, context: vscode.ExtensionContext, deps: PanelDeps) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ApprovalDetailPanel.current) {
      ApprovalDetailPanel.current.deps = deps;
      ApprovalDetailPanel.current.panel.reveal(column);
      ApprovalDetailPanel.current.setApproval(approval);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "OpenBox Approval",
      column,
      {
        enableScripts: true,
        // localResourceRoots intentionally empty; the panel ships no
        // assets, all styling comes from theme vars and inline CSS.
        // Tightens the security envelope to "html + nonce'd inline
        // script, nothing else."
        localResourceRoots: [],
        retainContextWhenHidden: false,
      },
    );

    ApprovalDetailPanel.current = new ApprovalDetailPanel(panel, context, deps, approval);
  }

  private readonly disposables: vscode.Disposable[] = [];
  private approval: Approval;
  private agent: Agent | null = null;
  private ownerName: string | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private deps: PanelDeps,
    initial: Approval,
  ) {
    this.approval = initial;

    panel.onDidDispose(() => this.dispose(), null, this.disposables);

    panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.setApproval(initial);
    this.loadAgentAndOwner();
  }

  setApproval(approval: Approval) {
    const isFirstRender = !this.panel.webview.html;
    this.approval = approval;
    // Don't null out agent/ownerName synchronously. Keep the previous
    // panel content visible while loadAgentAndOwner runs; replace
    // once the new data lands. Two-render strategy was causing a
    // double-flash on every card click; null render then populated
    // render. Single render now: either the initial (when the panel
    // is first shown) or a single replacement when fresh data
    // arrives.
    this.panel.title = `OpenBox · ${approval.agent?.agent_name || approval.agent_id || "Approval"}`;
    if (isFirstRender) {
      // First time: paint immediately with what we have (no enrichment
      // yet). loadAgentAndOwner will refresh below.
      this.agent = null;
      this.ownerName = null;
      this.render();
    } else {
      // Stale agent/ownerName left in place; visually cleaner. The
      // load below will overwrite both before the user can interact.
    }
    this.startCountdown();
    this.loadAgentAndOwner();
  }

  private startCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (!this.approval.approval_expired_at) return;
    this.countdownTimer = setInterval(() => {
      // Cheap: re-post the same payload, the webview re-renders the
      // countdown row only. Re-rendering the whole document each tick
      // is fine at 1Hz and keeps the webview side dumb.
      this.panel.webview.postMessage({ type: "tick", remaining: timeRemaining(this.approval.approval_expired_at) });
    }, 1000);
    this.disposables.push({ dispose: () => this.countdownTimer && clearInterval(this.countdownTimer) });
  }

  // Best-effort enrichment; agent details + owner name aren't part of
  // the approvals payload. Failures stay silent so the panel renders
  // even when the user's role lacks read:user / read:agent.
  private async loadAgentAndOwner() {
    const { client, orgId } = this.deps;
    const agentId = this.approval.agent_id;
    if (!agentId) return;
    try {
      // The spec's Agent model is missing owner_id; the backend
      // returns it via the index-signature passthrough, so cast at
      // this site until the spec is filled in.
      const fetched = (await client.getAgent(agentId)) as
        | (Agent & { owner_id?: string })
        | null;
      if (!fetched || this.approval.agent_id !== agentId) return;
      this.agent = fetched;
      if (fetched.owner_id) {
        try {
          const res = (await client.listMembers(orgId, { perPage: 200 })) as {
            members?: Member[];
            data?: Member[] | { members?: Member[] };
          };
          const members =
            (Array.isArray(res?.members) && res.members) ||
            (Array.isArray(res?.data) && res.data) ||
            (res?.data && !Array.isArray(res.data) && Array.isArray(res.data.members) && res.data.members) ||
            [];
          const m = members.find((x) => x.id === fetched.owner_id);
          this.ownerName = m ? memberDisplay(m) : fetched.owner_id;
        } catch {
          this.ownerName = fetched.owner_id;
        }
      }
      this.render();
    } catch {
      /* silent; panel stays usable without team/owner */
    }
  }

  private async handleMessage(msg: any) {
    if (msg?.type === "decide") {
      const action = msg.action as DecideAction;
      if (action !== "approve" && action !== "reject") return;

      if (action === "reject") {
        const choice = await vscode.window.showWarningMessage(
          "Reject this approval?",
          { modal: true, detail: "This will block the action." },
          "Reject",
        );
        if (choice !== "Reject") return;
      }

      const agentId = this.approval.agent_id || "";
      try {
        await this.deps.client.decideApproval(agentId, this.approval.id, { action });
        vscode.window.showInformationMessage(
          action === "approve" ? `Approved (${this.deps.env})` : `Rejected (${this.deps.env})`,
        );
        this.deps.onDecided(this.approval.id);
        this.panel.dispose();
      } catch (err: any) {
        vscode.window.showErrorMessage(`${action === "approve" ? "Approve" : "Reject"} failed: ${err.message}`);
      }
    }
  }

  private render() {
    this.panel.webview.html = renderHtml(this.panel.webview, this.approval, this.agent, this.ownerName, this.deps.env);
  }

  private dispose() {
    if (ApprovalDetailPanel.current === this) ApprovalDetailPanel.current = undefined;
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try { d?.dispose(); } catch { /* ignore */ }
    }
    this.panel.dispose();
  }
}

function memberDisplay(m: Member): string {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
  return full || m.username || m.email || m.id;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nonce(): string {
  // Per VS Code webview docs: must be unguessable and unique per
  // response. crypto.getRandomValues isn't on Node's globalThis until
  // 19+; fall back to Math.random when missing (extension host always
  // has it on supported VS Code versions, but the fallback is harmless).
  const bytes = new Uint8Array(16);
  const c: any = (globalThis as any).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// Tier color matches mobile's brand.tierColor (#30D158 / #0a84ff /
// #FF9F0A / #FF453A). Both the pill text AND a 15%-alpha fill use the
// same color so the tier reads at a glance, not just from the text
// against a transparent background. Mirrors mobile's tierBg() rule.
function tierColor(tier: number | undefined): string {
  if (tier == null) return "var(--vscode-descriptionForeground)";
  if (tier >= 4) return "#30D158";
  if (tier === 3) return "#0a84ff";
  if (tier === 2) return "#FF9F0A";
  return "#FF453A";
}

function tierBg(tier: number | undefined): string {
  if (tier == null) return "transparent";
  const c = tierColor(tier);
  if (!c.startsWith("#")) return "transparent";
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},0.15)`;
}

function renderHtml(
  webview: vscode.Webview,
  a: Approval,
  agent: Agent | null,
  ownerName: string | null,
  env: string,
): string {
  const n = nonce();
  const action = a.action_type || a.activity_type;
  const summary = summarizeInput(action, a.input);
  const tier = a.metadata?.trust_tier;
  const isPending = a.verdict === 2 && !!a.approval_expired_at;
  const remaining = timeRemaining(a.approval_expired_at);
  const expired = remaining === "expired";
  const showActions = isPending && !expired;

  const csp = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${webview.cspSource}`,
    `script-src 'nonce-${n}'`,
    "img-src data:",
  ].join("; ");

  // Spec's Agent model exposes team_ids[] but backend also returns
  // teams[] populated via JOIN; cast through the wider runtime shape.
  const agentTeams = (agent as (Agent & { teams?: { name: string }[] }) | null)?.teams;
  const teams = agentTeams && agentTeams.length > 0
    ? agentTeams.map((t) => t.name).join(", ")
    : agent
      ? "Unassigned"
      : null;

  // Decided / Expires-in row mirrors mobile's logic exactly.
  let timingRow = "";
  if ((a.verdict === 0 || a.verdict === 1) && a.decided_at) {
    timingRow = `<div class="row"><span class="lbl">Approved</span><span class="val">${escapeHtml(timeAgo(a.decided_at))}</span></div>`;
  } else if ((a.verdict === 3 || a.verdict === 4) && a.decided_at) {
    timingRow = `<div class="row"><span class="lbl">Rejected</span><span class="val">${escapeHtml(timeAgo(a.decided_at))}</span></div>`;
  } else if (a.verdict === 2 && expired) {
    timingRow = `<div class="row"><span class="lbl">Expired</span><span class="val">${escapeHtml(timeAgo(a.approval_expired_at))}</span></div>`;
  } else if (a.verdict === 2 && remaining) {
    timingRow = `<div class="row" id="expiry-row"><span class="lbl">Expires in</span><span class="val" id="expiry-val">${escapeHtml(remaining)}</span></div>`;
  }

  const lang = action === "ShellExecution" || action === "ShellOutput" ? "" : ""; // styling-only; no syntax highlight in webview

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>OpenBox Approval</title>
<style>
  :root {
    color-scheme: var(--vscode-editor-color-scheme);
  }
  body {
    margin: 0;
    padding: 24px 28px 32px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  /* Constrain the panel content to a readable column on wide screens.
     Without this, the card + reason + action blocks stretch edge-to-
     edge in any side-panel resize, which reads worse than a centered
     column with breathing room on either side. 720px matches mobile's
     ApprovalCard target reading width. */
  .container {
    max-width: 720px;
    margin: 0 auto;
  }
  .hero { text-align: center; padding: 16px 0 24px; }
  .agent {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.4px;
    color: var(--vscode-foreground);
    word-break: break-word;
  }
  .pills { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 12px; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  /* Tier pill: filled background at 15% alpha + bold same-color text,
     mirroring mobile's tierBg/tierColor combo so the tier reads at a
     glance instead of just being a hairline outline. */
  .pill.tier { font-weight: 700; }

  .card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
    border-radius: 8px;
    overflow: hidden;
    background: var(--vscode-editorWidget-background, transparent);
  }
  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
  }
  .row:last-child { border-bottom: none; }
  .row.col { flex-direction: column; align-items: stretch; gap: 6px; }
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
    color: var(--vscode-foreground);
    word-break: break-word;
  }
  .row.col .val { text-align: left; }

  pre {
    margin: 0;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size, 13px);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }

  .reason {
    font-size: 13px;
    color: var(--vscode-foreground);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Stack Approve over Reject (mobile's actionsRow alignItems:center
     column). Approve is the proper primary button; Reject is a plain
     text link styled red - the destructive action stays available
     but visually subtle so the eye lands on Approve first. */
  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 24px;
  }
  button.primary {
    width: 320px;
    max-width: 100%;
    height: 44px;
    border-radius: 8px;
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
    font-size: 15px;
    font-weight: 600;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.primary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  button.subtle {
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-errorForeground, #f85149);
    padding: 6px 12px;
  }
  button.subtle:hover { text-decoration: underline; }
  button.subtle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 4px; }
  button.subtle:disabled { opacity: 0.5; cursor: not-allowed; }

  h2 { margin: 24px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.6px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
</style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <div class="agent">${escapeHtml(a.agent?.agent_name || a.agent_id || "Unknown Agent")}</div>
      <div class="pills">
        ${tier != null ? `<span class="pill tier" style="color: ${tierColor(tier)}; background: ${tierBg(tier)}">Tier ${tier}</span>` : ""}
        ${action ? `<span class="pill">${escapeHtml(formatLabel(action))}</span>` : ""}
      </div>
    </div>

    <div class="card">
      ${summary ? `<div class="row col"><span class="lbl">Action</span><pre>${escapeHtml(summary)}</pre></div>` : ""}
      ${a.reason ? `<div class="row col"><span class="lbl">Reason</span><div class="reason val">${escapeHtml(sanitizeReason(a.reason))}</div></div>` : ""}
      ${teams ? `<div class="row"><span class="lbl">Team</span><span class="val">${escapeHtml(teams)}</span></div>` : ""}
      ${ownerName ? `<div class="row"><span class="lbl">Owner</span><span class="val">${escapeHtml(ownerName)}</span></div>` : ""}
      ${a.created_at ? `<div class="row"><span class="lbl">Created</span><span class="val">${escapeHtml(timeAgo(a.created_at))}</span></div>` : ""}
      ${/* Outcome row mirrors mobile: the row label IS the status word
          (Approved / Rejected / Expired / Expires in). No separate
          "Verdict" row - that maps to backend enum values (Allow /
          Constrain / Block / Halt) that don't read friendly. */ ""}
      ${timingRow}
    </div>

    ${showActions
      ? `<div class="actions">
          <button id="approve" class="primary">Approve</button>
          <button id="reject" class="subtle">Reject</button>
        </div>`
      : ""}
  </div>

  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const approve = document.getElementById('approve');
    const reject = document.getElementById('reject');
    if (approve) approve.addEventListener('click', () => {
      approve.disabled = true; if (reject) reject.disabled = true;
      vscode.postMessage({ type: 'decide', action: 'approve' });
    });
    if (reject) reject.addEventListener('click', () => {
      vscode.postMessage({ type: 'decide', action: 'reject' });
    });
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg && msg.type === 'tick') {
        const el = document.getElementById('expiry-val');
        if (el) el.textContent = msg.remaining;
      }
    });
  </script>
</body>
</html>`;
}
