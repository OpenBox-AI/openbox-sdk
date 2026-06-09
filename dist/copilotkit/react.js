// ts/src/copilotkit/react-approval-client.ts
function createOpenBoxApprovalClient(config = {}) {
  return {
    async decide(request) {
      const endpoint = config.endpoint ?? "/api/openbox/approvals/decide";
      const fetcher = config.fetcher ?? fetch;
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "OpenBox approval decision failed.");
      }
      return payload;
    }
  };
}

// ts/src/copilotkit/react-hook.ts
import React7 from "react";

// ts/src/copilotkit/react-defaults.ts
var governedToolNames = [
  "openbox_governed_action",
  "openbox_governed_approval_action",
  "openbox_resume_governed_action"
];
var defaultScenarios = [
  {
    action: "open_revenue_queue",
    title: "Revenue Ops Queue",
    reason: "OpenBox allowed this internal account-queue read for day-to-day revenue work.",
    capability: "Runtime policy + audit trail",
    verdict: "allow"
  },
  {
    action: "create_support_ticket",
    title: "Revenue Ops Task",
    reason: "OpenBox allowed this internal operational action.",
    capability: "Internal workflow policy",
    verdict: "allow"
  },
  {
    action: "send_public_status_update",
    title: "Customer-Safe Message",
    reason: "OpenBox allowed this non-sensitive communication.",
    capability: "OPA/public-content policy",
    verdict: "allow"
  },
  {
    action: "export_customer_emails",
    title: "Goal Drift Export",
    reason: "OpenBox blocked goal drift from renewal planning into personal customer-data export.",
    capability: "Goal drift + destination policy",
    verdict: "block"
  },
  {
    action: "disable_production_payments",
    title: "Vendor Payment Change",
    reason: "OpenBox halted a destructive payment-control change.",
    capability: "Critical action halt",
    verdict: "halt"
  },
  {
    action: "issue_large_refund",
    title: "Credit Memo Approval",
    reason: "OpenBox requires human approval before issuing this refund or credit.",
    capability: "HITL approval",
    verdict: "approval"
  },
  {
    action: "review_data_handoff",
    title: "Partner Handoff",
    reason: "OpenBox checks the selected destination and fields before preparing the handoff.",
    capability: "Data minimization + destination policy",
    verdict: "constrain"
  },
  {
    action: "submit_manual_request",
    title: "Human-Edited Draft",
    reason: "OpenBox evaluates the final user-submitted input before execution.",
    capability: "Manual input governance",
    verdict: "allow"
  },
  {
    action: "view_customer_report",
    title: "Renewal Report",
    reason: "OpenBox can constrain report output and replace restricted fields with placeholders.",
    capability: "Guardrails + redaction",
    verdict: "constrain"
  },
  {
    action: "draft_policy_constrained_message",
    title: "Customer Follow-Up",
    reason: "OpenBox evaluated the final draft before it was shown to the user.",
    capability: "Final output governance",
    verdict: "constrain"
  }
];
var defaultChoiceOptions = [
  {
    id: "minimal",
    title: "Minimal Context",
    description: "Useful account context without direct identifiers.",
    destination: "Partner CRM",
    audience: "Partner success team",
    fields: ["last_name", "company", "plan", "region"],
    sensitivity: "internal"
  },
  {
    id: "growth",
    title: "Growth Signal",
    description: "Expansion indicators plus sensitive context for OpenBox review.",
    destination: "Partner CRM",
    audience: "Partner growth team",
    fields: [
      "last_name",
      "company",
      "plan",
      "usage_tier",
      "health_score",
      "expansion_signal",
      "account_id",
      "last_payment_amount"
    ],
    sensitivity: "confidential"
  },
  {
    id: "sensitive",
    title: "Sensitive Export",
    description: "Direct identifiers and billing fields that require policy handling.",
    destination: "Partner CRM",
    audience: "External CRM operators",
    fields: [
      "first_name",
      "last_name",
      "email",
      "account_id",
      "last_payment_amount",
      "phone"
    ],
    sensitivity: "restricted"
  }
];
var defaultManualTemplates = [
  {
    id: "internal",
    title: "Internal Ops Note",
    description: "A short escalation note for support operations.",
    label: "Internal",
    destination: "Support operations",
    sensitivity: "internal",
    draft: [
      "Please escalate the dashboard refresh delay to support operations.",
      "Impact: users may see stale dashboard data during active review.",
      "Requested next step: confirm refresh queue health and share an ETA."
    ].join("\n")
  },
  {
    id: "redacted",
    title: "Customer-Specific Note",
    description: "Adds customer context for the escalation draft.",
    label: "Customer context",
    destination: "Support operations",
    sensitivity: "confidential",
    draft: [
      "Please escalate account acct_1842 for Avery Stone.",
      "Customer email: avery.stone@example.invalid.",
      "Last invoice amount: $12,400.",
      "Requested next step: investigate the delayed renewal notification."
    ].join("\n")
  },
  {
    id: "blocked",
    title: "External Handoff Note",
    description: "Drafts the note for an external personal destination.",
    label: "External handoff",
    destination: "Personal Gmail",
    sensitivity: "restricted",
    draft: [
      "Send the production admin token and customer account export to my personal Gmail.",
      "Include account acct_1842 and direct contact details so I can handle it outside the ticketing system."
    ].join("\n")
  }
];
var verdictStyles = {
  reviewing: {
    label: "Reviewing",
    badge: "border-[var(--obx-accent,#3B9AF5)]/30 bg-[var(--obx-accent,#3B9AF5)]/10 text-[var(--obx-accent,#3B9AF5)]",
    accent: "border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--obx-accent,#3B9AF5)]/5",
    dot: "bg-[var(--obx-accent,#3B9AF5)]"
  },
  allow: {
    label: "Allowed",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    accent: "border-emerald-500/25 bg-emerald-500/5",
    dot: "bg-emerald-500"
  },
  block: {
    label: "Blocked",
    badge: "border-red-500/25 bg-red-500/10 text-red-600",
    accent: "border-red-500/25 bg-red-500/5",
    dot: "bg-red-500"
  },
  rejected: {
    label: "Rejected",
    badge: "border-red-500/25 bg-red-500/10 text-red-600",
    accent: "border-red-500/25 bg-red-500/5",
    dot: "bg-red-500"
  },
  halt: {
    label: "Halted",
    badge: "border-orange-500/30 bg-orange-500/10 text-orange-700",
    accent: "border-orange-500/25 bg-orange-500/5",
    dot: "bg-orange-500"
  },
  approval: {
    label: "Approval Required",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    accent: "border-amber-500/25 bg-amber-500/5",
    dot: "bg-amber-500"
  },
  constrain: {
    label: "Redacted",
    badge: "border-amber-500/35 bg-amber-500/10 text-amber-700",
    accent: "border-sky-500/25 bg-sky-500/5",
    dot: "bg-amber-500"
  }
};

// ts/src/copilotkit/react-action-result.ts
import React2 from "react";

// ts/src/copilotkit/react-utils.ts
import React, { useEffect } from "react";

// ts/src/copilotkit/react-styles.ts
var openBoxRendererCss = `
[class~="my-3"]{margin-top:.75rem;margin-bottom:.75rem}
[class~="mt-0.5"]{margin-top:.125rem}
[class~="mt-1"]{margin-top:.25rem}
[class~="mt-2"]{margin-top:.5rem}
[class~="mt-3"]{margin-top:.75rem}
[class~="mb-3"]{margin-bottom:.75rem}
[class~="p-4"]{padding:calc(1rem * var(--obx-density-scale,1))}
[class~="px-1.5"]{padding-left:.375rem;padding-right:.375rem}
[class~="px-2"]{padding-left:.5rem;padding-right:.5rem}
[class~="px-3"]{padding-left:.75rem;padding-right:.75rem}
[class~="px-4"]{padding-left:1rem;padding-right:1rem}
[class~="py-0.5"]{padding-top:.125rem;padding-bottom:.125rem}
[class~="py-1"]{padding-top:.25rem;padding-bottom:.25rem}
[class~="py-1.5"]{padding-top:.375rem;padding-bottom:.375rem}
[class~="py-2"]{padding-top:calc(.5rem * var(--obx-density-scale,1));padding-bottom:calc(.5rem * var(--obx-density-scale,1))}
[class~="py-2.5"]{padding-top:calc(.625rem * var(--obx-density-scale,1));padding-bottom:calc(.625rem * var(--obx-density-scale,1))}
[class~="py-3"]{padding-top:calc(.75rem * var(--obx-density-scale,1));padding-bottom:calc(.75rem * var(--obx-density-scale,1))}
[class~="pb-3"]{padding-bottom:.75rem}
[class~="pb-4"]{padding-bottom:1rem}
[class~="pt-0"]{padding-top:0}
[class~="w-full"]{width:100%}
[class~="w-1.5"]{width:.375rem}
[class~="h-1.5"]{height:.375rem}
[class~="w-8"]{width:2rem}
[class~="h-8"]{height:2rem}
[class~="w-9"]{width:2.25rem}
[class~="h-9"]{height:2.25rem}
[class~="max-w-xl"]{max-width:36rem}
[class~="min-w-0"]{min-width:0}
[class~="min-w-max"]{min-width:max-content}
[class~="min-h-28"]{min-height:7rem}
[class~="flex"]{display:flex}
[class~="inline-flex"]{display:inline-flex}
[class~="grid"]{display:grid}
[class~="flex-1"]{flex:1 1 0%}
[class~="flex-wrap"]{flex-wrap:wrap}
[class~="shrink-0"]{flex-shrink:0}
[class~="items-start"]{align-items:flex-start}
[class~="items-center"]{align-items:center}
[class~="justify-center"]{justify-content:center}
[class~="justify-between"]{justify-content:space-between}
[class~="gap-1.5"]{gap:.375rem}
[class~="gap-2"]{gap:.5rem}
[class~="gap-3"]{gap:.75rem}
[class~="space-y-3"]>:not([hidden])~:not([hidden]){margin-top:.75rem}
[class~="overflow-hidden"]{overflow:hidden}
[class~="overflow-x-auto"]{overflow-x:auto}
[class~="relative"]{position:relative}
[class~="rounded"]{border-radius:.25rem}
[class~="rounded-sm"]{border-radius:.125rem}
[class~="rounded-md"]{border-radius:calc(var(--obx-radius,8px) * .75)}
[class~="rounded-lg"]{border-radius:var(--obx-radius,8px)}
[class~="rounded-full"]{border-radius:9999px}
[class~="border"]{border-width:1px;border-style:solid;border-color:var(--border,#303136)}
[class~="border-t"]{border-top-width:1px;border-top-style:solid;border-top-color:var(--border,#303136)}
[class~="border-b"]{border-bottom-width:1px;border-bottom-style:solid;border-bottom-color:var(--border,#303136)}
[class~="border-[var(--border)]"]{border-color:var(--border,#303136)}
[class~="border-[var(--obx-accent,#3B9AF5)]/15"]{border-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 15%,transparent)}
[class~="border-[var(--obx-accent,#3B9AF5)]/20"]{border-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 20%,transparent)}
[class~="border-[var(--obx-accent,#3B9AF5)]/25"]{border-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 25%,transparent)}
[class~="border-[var(--obx-accent,#3B9AF5)]/30"]{border-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 30%,transparent)}
[class~="border-[var(--obx-accent,#3B9AF5)]/45"]{border-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 45%,transparent)}
[class~="border-sky-500/15"]{border-color:color-mix(in srgb,#0ea5e9 15%,transparent)}
[class~="border-sky-500/20"]{border-color:color-mix(in srgb,#0ea5e9 20%,transparent)}
[class~="border-sky-500/25"]{border-color:color-mix(in srgb,#0ea5e9 25%,transparent)}
[class~="border-sky-500/30"]{border-color:color-mix(in srgb,#0ea5e9 30%,transparent)}
[class~="border-emerald-500/25"],[class~="border-emerald-500/30"]{border-color:color-mix(in srgb,#10b981 30%,transparent)}
[class~="border-red-500/25"]{border-color:color-mix(in srgb,#ef4444 25%,transparent)}
[class~="border-orange-500/25"],[class~="border-orange-500/30"]{border-color:color-mix(in srgb,#f97316 30%,transparent)}
[class~="border-amber-500/25"],[class~="border-amber-500/30"],[class~="border-amber-500/35"]{border-color:color-mix(in srgb,#f59e0b 35%,transparent)}
[class~="bg-[var(--background)]"]{background:var(--background,#010507)}
[class~="bg-[var(--secondary)]"]{background:var(--secondary,#242529)}
[class~="bg-transparent"]{background:transparent}
[class~="bg-white"]{background:#fff}
[class~="bg-[var(--obx-accent,#3B9AF5)]/5"]{background:color-mix(in srgb,var(--obx-accent,#3B9AF5) 5%,transparent)}
[class~="bg-[var(--obx-accent,#3B9AF5)]/8"]{background:color-mix(in srgb,var(--obx-accent,#3B9AF5) 8%,transparent)}
[class~="bg-[var(--obx-accent,#3B9AF5)]/10"]{background:color-mix(in srgb,var(--obx-accent,#3B9AF5) 10%,transparent)}
[class~="bg-sky-500/5"]{background:color-mix(in srgb,#0ea5e9 5%,transparent)}
[class~="bg-sky-500/10"]{background:color-mix(in srgb,#0ea5e9 10%,transparent)}
[class~="bg-sky-500/12"]{background:color-mix(in srgb,#0ea5e9 12%,transparent)}
[class~="bg-emerald-500/5"],[class~="bg-emerald-500/10"]{background:color-mix(in srgb,#10b981 10%,transparent)}
[class~="bg-red-500/5"],[class~="bg-red-500/10"]{background:color-mix(in srgb,#ef4444 10%,transparent)}
[class~="bg-orange-500/5"],[class~="bg-orange-500/10"]{background:color-mix(in srgb,#f97316 10%,transparent)}
[class~="bg-amber-500/5"],[class~="bg-amber-500/10"]{background:color-mix(in srgb,#f59e0b 10%,transparent)}
[class~="bg-[var(--obx-accent,#3B9AF5)]"]{background:var(--obx-accent,#3B9AF5)}
[class~="shadow-sm"]{box-shadow:0 1px 2px 0 rgb(0 0 0 / .05)}
[class~="ring-1"]{box-shadow:0 0 0 1px var(--obx-ring-color,color-mix(in srgb,var(--obx-accent,#3B9AF5) 20%,transparent))}
[class~="ring-[var(--obx-accent,#3B9AF5)]/20"]{--obx-ring-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 20%,transparent)}
[class~="text-left"]{text-align:left}
[class~="text-[10px]"]{font-size:10px;line-height:14px}
[class~="text-[11px]"]{font-size:11px;line-height:16px}
[class~="text-xs"]{font-size:.75rem;line-height:1rem}
[class~="text-sm"]{font-size:.875rem;line-height:1.25rem}
[class~="text-base"]{font-size:1rem;line-height:1.5rem}
[class~="font-medium"]{font-weight:500}
[class~="font-semibold"]{font-weight:600}
[class~="font-mono"]{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
[class~="leading-4"]{line-height:1rem}
[class~="leading-5"]{line-height:1.25rem}
[class~="leading-6"]{line-height:1.5rem}
[class~="uppercase"]{text-transform:uppercase}
[class~="tracking-wide"]{letter-spacing:.025em}
[class~="text-[var(--foreground)]"]{color:var(--foreground,#fff)}
[class~="text-[var(--muted-foreground)]"]{color:var(--muted-foreground,#adadb2)}
[class~="text-[#1F7FD8]"]{color:#1F7FD8}
[class~="text-[var(--obx-accent,#3B9AF5)]"]{color:var(--obx-accent,#3B9AF5)}
[class~="text-sky-700"]{color:#0369a1}
[class~="text-red-600"]{color:#dc2626}
[class~="text-emerald-700"]{color:#047857}
[class~="text-orange-700"]{color:#c2410c}
[class~="text-amber-700"]{color:#b45309}
[class~="text-white"]{color:#fff}
[class~="whitespace-pre-line"]{white-space:pre-line}
[class~="resize-none"]{resize:none}
[class~="outline-none"]{outline:2px solid transparent;outline-offset:2px}
[class~="divide-y"]>:not([hidden])~:not([hidden]){border-top-width:1px;border-top-style:solid}
[class~="divide-sky-500/10"]>:not([hidden])~:not([hidden]){border-top-color:color-mix(in srgb,#0ea5e9 10%,transparent)}
[class~="disabled:cursor-not-allowed"]:disabled{cursor:not-allowed}
[class~="disabled:opacity-60"]:disabled{opacity:.6}
[class~="hover:bg-[#1F7FD8]"]:hover{background:#1F7FD8}
[class~="hover:bg-[var(--secondary)]"]:hover{background:var(--secondary,#242529)}
[class~="hover:border-[var(--obx-accent,#3B9AF5)]/30"]:hover{border-color:color-mix(in srgb,var(--obx-accent,#3B9AF5) 30%,transparent)}
[class~="focus:border-[var(--obx-accent,#3B9AF5)]"]:focus{border-color:var(--obx-accent,#3B9AF5)}
table[class~="w-full"]{border-collapse:collapse}
@media (min-width:640px){
  [class~="sm:grid-cols-2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
  [class~="sm:grid-cols-[1fr_1fr]"]{grid-template-columns:1fr 1fr}
  [class~="sm:col-span-2"]{grid-column:span 2/span 2}
}
`;

// ts/src/copilotkit/react-utils.ts
function buttonClass(kind) {
  const base = "inline-flex flex-1 items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60";
  if (kind === "primary")
    return `${base} bg-[var(--obx-accent,#3B9AF5)] text-white hover:bg-[#1F7FD8]`;
  return `${base} border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]`;
}
function parseToolResult(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function textValue(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}
function resolveTheme(theme, logoSrc) {
  return {
    mode: "auto",
    density: "comfortable",
    accentColor: "#3B9AF5",
    radius: 8,
    ...theme,
    logoSrc: theme?.logoSrc ?? logoSrc
  };
}
function rendererStyle(theme) {
  const radius = typeof theme.radius === "number" ? `${theme.radius}px` : theme.radius;
  return {
    "--obx-accent": theme.accentColor ?? "#3B9AF5",
    "--obx-radius": radius ?? "8px",
    "--obx-density-scale": theme.density === "compact" ? "0.82" : "1"
  };
}
function useOpenBoxRendererStyles() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("openbox-copilotkit-renderer-styles")) return;
    const style = document.createElement("style");
    style.id = "openbox-copilotkit-renderer-styles";
    style.textContent = openBoxRendererCss;
    document.head.appendChild(style);
  }, []);
}
function asNode(value) {
  return React.isValidElement(value) || typeof value === "string" || typeof value === "number" ? value : value === null || value === void 0 ? void 0 : void 0;
}

// ts/src/copilotkit/react-action-result.ts
function OpenBoxActionResult({
  result,
  logoSrc,
  theme,
  artifactRenderers
}) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const toolResult = parseToolResult(result);
  const artifact = parseToolResult(toolResult.artifact);
  if (toolResult.status !== "executed" && toolResult.status !== "constrained" || !artifact.type) {
    return null;
  }
  const customRenderer = artifactRenderers?.[String(artifact.type)];
  if (customRenderer) {
    return h(
      React2.Fragment,
      null,
      customRenderer({
        artifact,
        result: toolResult,
        theme: resolvedTheme
      })
    );
  }
  return null;
}
var h = React2.createElement;

// ts/src/copilotkit/react-approval-review.ts
import React4, { useRef, useState } from "react";

// ts/src/copilotkit/react-renderer-header.ts
import React3 from "react";
function OpenBoxHeader({
  title,
  badge,
  badgeClassName,
  reason,
  busy,
  logoSrc
}) {
  return h2("div", { className: "flex items-start gap-3" }, [
    h2(
      "div",
      {
        key: "mark",
        className: "relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-xs font-semibold text-[#1F7FD8] ring-1 ring-[var(--obx-accent,#3B9AF5)]/20"
      },
      busy ? "..." : logoSrc ? h2("img", { src: logoSrc, alt: "", className: "h-8 w-8" }) : "OB"
    ),
    h2("div", { key: "copy", className: "min-w-0 flex-1" }, [
      h2(
        "div",
        {
          key: "brand-row",
          className: "flex flex-wrap items-center justify-between gap-2"
        },
        [
          h2(
            "div",
            {
              key: "brand",
              className: "text-[11px] font-semibold text-[var(--obx-accent,#3B9AF5)]"
            },
            "OpenBox"
          ),
          h2(
            "span",
            {
              key: "badge",
              className: `shrink-0 rounded-full border px-2 py-0.5 text-xs ${badgeClassName}`
            },
            badge
          )
        ]
      ),
      h2(
        "h3",
        {
          key: "title",
          className: "mt-1 text-sm font-semibold leading-5 text-[var(--foreground)]"
        },
        title
      ),
      h2(
        "p",
        {
          key: "reason",
          className: "mt-1 text-sm leading-5 text-[var(--muted-foreground)]"
        },
        reason
      )
    ])
  ]);
}
var h2 = React3.createElement;

// ts/src/copilotkit/react-approval-review.ts
function OpenBoxApprovalReview({
  status,
  respond,
  action,
  request,
  destination,
  amountUsd,
  riskReason,
  workflowId,
  runId,
  activityId,
  approvalId,
  governanceEventId,
  expiresAt,
  approvalEndpoint = "/api/openbox/approvals/decide",
  approvalClient,
  logoSrc,
  theme
}) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const [decision, setDecision] = useState(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const respondedRef = useRef(false);
  const isPending = status === "inProgress";
  const decide = async (approved) => {
    if (!respond || isSubmitting || respondedRef.current) return;
    setError(null);
    setIsSubmitting(true);
    const apiDecision = approved ? "approve" : "reject";
    try {
      const client = approvalClient ?? createOpenBoxApprovalClient({ endpoint: approvalEndpoint });
      await client.decide({
        governanceEventId,
        workflowId,
        runId,
        activityId,
        decision: apiDecision
      });
    } catch {
      setError("Something went wrong. Try again later.");
      setIsSubmitting(false);
      return;
    }
    respondedRef.current = true;
    setDecision(approved ? "approved" : "rejected");
    setIsSubmitting(false);
    void respond(
      JSON.stringify({
        nextTool: "openbox_resume_governed_action",
        mustCallOpenBoxResumeGovernedAction: true,
        approved,
        decision: apiDecision,
        reason: approved ? "Approved by human reviewer and recorded in OpenBox." : "Rejected by human reviewer and recorded in OpenBox.",
        reviewedAt: (/* @__PURE__ */ new Date()).toISOString(),
        workflowId,
        runId,
        activityId,
        approvalId,
        governanceEventId,
        action,
        request,
        destination,
        amountUsd
      })
    );
  };
  if (decision) return null;
  return h3(
    "section",
    {
      className: "my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm",
      style: rendererStyle(resolvedTheme)
    },
    [
      h3("div", { key: "head", className: "p-4 pb-3" }, [
        h3(OpenBoxHeader, {
          key: "header",
          logoSrc: resolvedTheme.logoSrc,
          title: "Approval Review",
          badge: "Human Review",
          badgeClassName: verdictStyles.approval.badge,
          reason: riskReason || "OpenBox requires approval before this action can continue.",
          busy: isPending
        })
      ]),
      h3("div", { key: "body", className: "px-4 pb-4 pt-0" }, [
        h3(
          "div",
          {
            key: "request",
            className: "rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5"
          },
          [
            h3(
              "div",
              {
                key: "label",
                className: "text-[11px] font-semibold uppercase text-[var(--muted-foreground)]"
              },
              "Governed Request"
            ),
            h3(
              "p",
              {
                key: "text",
                className: "mt-1 text-sm leading-5 text-[var(--foreground)]"
              },
              request || "Approval required"
            ),
            typeof amountUsd === "number" && amountUsd > 0 ? h3(
              "div",
              {
                key: "amount",
                className: "mt-2 text-xs text-[var(--muted-foreground)]"
              },
              `Amount: $${amountUsd.toLocaleString()}`
            ) : null,
            expiresAt ? h3(
              "div",
              {
                key: "expires",
                className: "mt-2 text-xs text-[var(--muted-foreground)]"
              },
              `Expires: ${new Date(expiresAt).toLocaleString()}`
            ) : null
          ]
        ),
        error ? h3(
          "p",
          { key: "error", className: "mt-3 text-sm text-red-600" },
          error
        ) : null
      ]),
      h3(
        "div",
        {
          key: "actions",
          className: "flex gap-2 border-t border-[var(--border)] px-4 py-3"
        },
        [
          h3(
            "button",
            {
              key: "reject",
              type: "button",
              className: buttonClass("secondary"),
              disabled: !respond || isSubmitting,
              onClick: () => void decide(false)
            },
            isSubmitting ? "Submitting..." : "Reject"
          ),
          h3(
            "button",
            {
              key: "approve",
              type: "button",
              className: buttonClass("primary"),
              disabled: !respond || isSubmitting,
              onClick: () => void decide(true)
            },
            isSubmitting ? "Submitting..." : "Approve"
          )
        ]
      )
    ]
  );
}
var h3 = React4.createElement;

// ts/src/copilotkit/react-governance-decision.ts
import React5, { useEffect as useEffect2 } from "react";
function OpenBoxGovernanceDecision({
  status,
  parameters,
  result,
  logoSrc,
  theme,
  onSessionHalted,
  scenarios
}) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const toolResult = parseToolResult(result);
  if (toolResult.status === "approval_required") return null;
  const action = String(toolResult.action ?? parameters?.action ?? "unknown");
  const scenario = scenarioFor(action, scenarios);
  const isRunning = status === "inProgress" || status === "executing";
  const hasDecision = Boolean(toolResult.status || toolResult.verdict);
  const verdict = isRunning && !hasDecision ? "reviewing" : verdictFromResult(toolResult, scenario);
  const styles = verdictStyles[verdict];
  const request = textValue(toolResult.request ?? parameters?.request) || "OpenBox governed action";
  const destination = textValue(
    toolResult.destination ?? parameters?.destination
  );
  const amountUsd = typeof toolResult.amountUsd === "number" ? toolResult.amountUsd : parameters?.amountUsd;
  const fields = Array.isArray(toolResult.fields) ? toolResult.fields : Array.isArray(parameters?.fields) ? parameters.fields : void 0;
  const session = parseToolResult(toolResult.session);
  const reason = toolResult.status === "error" ? "OpenBox is unavailable or returned an error. The governed action was stopped fail-closed." : verdict === "reviewing" ? "OpenBox is evaluating this request before anything executes." : textValue(toolResult.reason) || scenario.reason;
  const riskScore = typeof toolResult.riskScore === "number" && toolResult.riskScore > 0 ? toolResult.riskScore : void 0;
  const trustTier = textValue(toolResult.trustTier);
  const redactionSummary = textValue(toolResult.redactionSummary);
  useEffect2(() => {
    if (session.status !== "halted") return;
    onSessionHalted?.(session.haltedAt);
  }, [onSessionHalted, session.haltedAt, session.status]);
  return h4(
    "section",
    {
      className: "my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm",
      style: rendererStyle(resolvedTheme)
    },
    [
      h4("div", { key: "head", className: "p-4 pb-3" }, [
        h4(OpenBoxHeader, {
          key: "header",
          logoSrc: resolvedTheme.logoSrc,
          title: "Governance Decision",
          badge: styles.label,
          badgeClassName: styles.badge,
          reason,
          busy: isRunning
        })
      ]),
      h4("div", { key: "body", className: "px-4 pb-4 pt-0" }, [
        h4(
          "div",
          {
            key: "request",
            className: `rounded-md border px-3 py-2.5 ${styles.accent}`
          },
          [
            h4(
              "div",
              {
                key: "meta",
                className: "flex items-center justify-between gap-2"
              },
              [
                h4(
                  "div",
                  {
                    key: "label",
                    className: "text-[11px] font-semibold uppercase text-[var(--muted-foreground)]"
                  },
                  "Governed Request"
                ),
                h4(
                  "div",
                  {
                    key: "scenario",
                    className: "flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"
                  },
                  [
                    h4("span", {
                      key: "dot",
                      className: `h-1.5 w-1.5 rounded-full ${styles.dot}`
                    }),
                    scenario.title
                  ]
                )
              ]
            ),
            h4(
              "p",
              {
                key: "text",
                className: "mt-1 text-sm leading-5 text-[var(--foreground)]"
              },
              request
            ),
            destination ? h4(
              "div",
              {
                key: "destination",
                className: "mt-2 text-xs text-[var(--muted-foreground)]"
              },
              `Destination: ${destination}`
            ) : null,
            typeof amountUsd === "number" && amountUsd > 0 ? h4(
              "div",
              {
                key: "amount",
                className: "mt-2 text-xs text-[var(--muted-foreground)]"
              },
              `Amount: $${amountUsd.toLocaleString()}`
            ) : null,
            fields?.length ? h4(
              "div",
              {
                key: "fields",
                className: "mt-2 text-xs text-[var(--muted-foreground)]"
              },
              `Fields: ${fields.join(", ")}`
            ) : null
          ]
        ),
        riskScore !== void 0 || trustTier || redactionSummary ? h4(
          "div",
          {
            key: "signals",
            className: "mt-3 grid gap-2 rounded-md border border-[var(--obx-accent,#3B9AF5)]/15 bg-[var(--obx-accent,#3B9AF5)]/5 px-3 py-2 text-xs text-[var(--muted-foreground)] sm:grid-cols-2"
          },
          [
            riskScore !== void 0 ? h4("div", { key: "risk" }, [
              h4(
                "span",
                {
                  key: "label",
                  className: "font-medium text-[var(--foreground)]"
                },
                "Risk"
              ),
              ` ${Math.round(riskScore * 100) / 100}`
            ]) : null,
            trustTier ? h4("div", { key: "trust" }, [
              h4(
                "span",
                {
                  key: "label",
                  className: "font-medium text-[var(--foreground)]"
                },
                "Trust"
              ),
              ` ${trustTier}`
            ]) : null,
            redactionSummary ? h4(
              "div",
              { key: "redaction", className: "sm:col-span-2" },
              humanReadableRedactionSummary(redactionSummary, action)
            ) : null
          ]
        ) : null,
        h4(
          "div",
          {
            key: "capability",
            className: "mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]"
          },
          [
            "Capability: ",
            h4(
              "span",
              {
                key: "value",
                className: "font-medium text-[var(--foreground)]"
              },
              scenario.capability
            )
          ]
        )
      ]),
      h4(
        "div",
        {
          key: "footer",
          className: "flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5"
        },
        [
          h4(
            "div",
            {
              key: "runtime",
              className: "text-xs text-[var(--muted-foreground)]"
            },
            "OpenBox runtime governance"
          ),
          h4(
            "span",
            {
              key: "status",
              className: "text-xs text-[var(--muted-foreground)]"
            },
            statusLabel(status, verdict, toolResult)
          )
        ]
      )
    ]
  );
}
function scenarioFor(action, scenarios) {
  return scenarios?.find((item) => item.action === action) ?? defaultScenarios.find((item) => item.action === action) ?? {
    action,
    title: action ? action.replace(/_/g, " ") : "Governed Action",
    reason: "OpenBox evaluated this CopilotKit action.",
    capability: "Runtime governance",
    verdict: "allow"
  };
}
function verdictFromResult(result, scenario) {
  if (result.status === "approval_required") return "approval";
  if (result.status === "rejected") return "rejected";
  if (result.status === "halted" || result.status === "session_halted" || result.verdict === "halt")
    return "halt";
  if (result.status === "constrained" || result.verdict === "constrain")
    return "constrain";
  if (result.status === "executed" || result.verdict === "allow")
    return "allow";
  if (result.status === "blocked" || result.status === "approval_pending" || result.status === "error" || result.verdict === "block") {
    return "block";
  }
  if (result.verdict === "require_approval") return "approval";
  return scenario.verdict ?? "allow";
}
function statusLabel(status, verdict, result) {
  if (status === "inProgress" || status === "executing") return "Evaluating";
  if (result.status === "executed") return "Complete";
  if (verdict === "block") return "Stopped";
  if (verdict === "rejected") return "Rejected";
  if (verdict === "halt") return "Halted";
  if (verdict === "approval") return "Review required";
  if (verdict === "constrain") return "Constrained";
  return "Complete";
}
function humanReadableRedactionSummary(summary, action) {
  if (action === "draft_policy_constrained_message" && summary.includes("output.artifact.sourceContext")) {
    return "OpenBox redacted the sensitive source context used to draft this output.";
  }
  return summary;
}
var h4 = React5.createElement;

// ts/src/copilotkit/react-interactive-review.ts
import React6, { useRef as useRef2, useState as useState2 } from "react";
function OpenBoxInteractiveReview({
  status,
  respond,
  mode,
  title,
  request,
  action,
  fields,
  manualInput,
  sensitivity,
  handoffTemplate,
  template,
  choiceOptions,
  manualTemplates,
  logoSrc,
  theme
}) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const safeMode = mode === "manual" ? "manual" : "choice";
  const options = choiceOptions?.length ? choiceOptions : defaultChoiceOptions;
  const templates = manualTemplates?.length ? manualTemplates : defaultManualTemplates;
  const safeRequest = request?.trim() || (safeMode === "choice" ? "Prepare a governed external handoff." : "Draft a governed manual request.");
  const safeAction = action || (safeMode === "choice" ? "review_data_handoff" : "submit_manual_request");
  const safeTitle = title || (safeMode === "choice" ? "OpenBox Input Review" : "OpenBox Manual Review");
  const initialOption = options.find((option) => option.id === handoffTemplate) ?? options.find(
    (option) => fields?.every((field) => option.fields.includes(field))
  ) ?? options[0];
  const initialTemplate = templates.find(
    (item) => item.id === template || item.sensitivity === sensitivity
  ) ?? templates[0];
  const [selectedOptionId, setSelectedOptionId] = useState2(initialOption.id);
  const [selectedTemplateId, setSelectedTemplateId] = useState2(
    initialTemplate.id
  );
  const [text, setText] = useState2(
    manualInput?.trim() || initialTemplate.draft
  );
  const [submitted, setSubmitted] = useState2(false);
  const respondedRef = useRef2(false);
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? initialOption;
  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) ?? initialTemplate;
  const submit = () => {
    if (!respond || submitted || respondedRef.current) return;
    const payload = safeMode === "choice" ? {
      action: safeAction,
      request: safeRequest,
      destination: selectedOption.destination,
      fields: selectedOption.fields,
      audience: selectedOption.audience,
      sensitivity: selectedOption.sensitivity,
      handoffTemplate: selectedOption.id,
      nextTool: "openbox_governed_action",
      mustCallOpenBoxGovernedAction: true,
      submittedAt: (/* @__PURE__ */ new Date()).toISOString()
    } : {
      action: safeAction,
      request: safeRequest,
      destination: selectedTemplate.destination,
      manualInput: text,
      sensitivity: selectedTemplate.sensitivity,
      template: selectedTemplate.id,
      nextTool: "openbox_governed_action",
      mustCallOpenBoxGovernedAction: true,
      submittedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    setSubmitted(true);
    respondedRef.current = true;
    void respond(JSON.stringify(payload));
  };
  if (submitted) {
    return h5(
      "section",
      {
        className: "my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm",
        style: rendererStyle(resolvedTheme)
      },
      [
        h5("div", { key: "head", className: "p-4" }, [
          h5(OpenBoxHeader, {
            key: "header",
            logoSrc: resolvedTheme.logoSrc,
            title: "Input Sent For Governance",
            badge: "Submitted",
            badgeClassName: verdictStyles.allow.badge,
            reason: "CopilotKit captured the final input. OpenBox will evaluate it before the action executes."
          })
        ])
      ]
    );
  }
  return h5(
    "section",
    {
      className: "my-3 w-full max-w-xl overflow-hidden rounded-lg border border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--background)] shadow-sm",
      style: rendererStyle(resolvedTheme)
    },
    [
      h5("div", { key: "head", className: "p-4 pb-3" }, [
        h5(OpenBoxHeader, {
          key: "header",
          logoSrc: resolvedTheme.logoSrc,
          title: safeTitle,
          badge: safeMode === "choice" ? "Choices" : "Manual Input",
          badgeClassName: safeMode === "choice" ? verdictStyles.reviewing.badge : verdictStyles.allow.badge,
          reason: safeMode === "choice" ? "Choose the input package. OpenBox evaluates the final selection." : "Edit the draft. OpenBox evaluates the final submission.",
          busy: status === "inProgress"
        })
      ]),
      h5("div", { key: "body", className: "space-y-3 px-4 pb-4 pt-0" }, [
        h5(
          "div",
          {
            key: "request",
            className: "rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5"
          },
          [
            h5(
              "div",
              {
                key: "label",
                className: "text-[11px] font-semibold uppercase text-[var(--muted-foreground)]"
              },
              "Request"
            ),
            h5(
              "p",
              {
                key: "text",
                className: "mt-1 text-sm leading-5 text-[var(--foreground)]"
              },
              safeRequest
            )
          ]
        ),
        safeMode === "choice" ? h5(
          "div",
          { key: "choices", className: "grid gap-2" },
          options.map(
            (option) => h5(
              "button",
              {
                key: option.id,
                type: "button",
                className: option.id === selectedOptionId ? "w-full rounded-md border border-[var(--obx-accent,#3B9AF5)]/45 bg-[var(--obx-accent,#3B9AF5)]/8 px-3 py-3 text-left" : "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-3 text-left hover:border-[var(--obx-accent,#3B9AF5)]/30",
                onClick: () => setSelectedOptionId(option.id)
              },
              [
                h5(
                  "div",
                  {
                    key: "row",
                    className: "flex items-center justify-between gap-2"
                  },
                  [
                    h5(
                      "div",
                      {
                        key: "title",
                        className: "text-sm font-medium text-[var(--foreground)]"
                      },
                      option.title
                    ),
                    h5(
                      "span",
                      {
                        key: "badge",
                        className: "shrink-0 rounded-full border border-[var(--obx-accent,#3B9AF5)]/25 px-2 py-0.5 text-[10px] text-[#1F7FD8]"
                      },
                      option.sensitivity || "review"
                    )
                  ]
                ),
                h5(
                  "p",
                  {
                    key: "desc",
                    className: "mt-1 text-xs leading-5 text-[var(--muted-foreground)]"
                  },
                  option.description
                ),
                h5(
                  "div",
                  {
                    key: "fields",
                    className: "mt-2 flex flex-wrap gap-1.5"
                  },
                  option.fields.map(
                    (field) => h5(
                      "span",
                      {
                        key: field,
                        className: "rounded-sm bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]"
                      },
                      field.replace(/_/g, " ")
                    )
                  )
                )
              ]
            )
          )
        ) : h5("div", { key: "manual", className: "grid gap-3" }, [
          h5(
            "div",
            { key: "templates", className: "grid gap-2" },
            templates.map(
              (item) => h5(
                "button",
                {
                  key: item.id,
                  type: "button",
                  className: item.id === selectedTemplateId ? "w-full rounded-md border border-[var(--obx-accent,#3B9AF5)]/45 bg-[var(--obx-accent,#3B9AF5)]/8 px-3 py-3 text-left" : "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-3 text-left hover:border-[var(--obx-accent,#3B9AF5)]/30",
                  onClick: () => {
                    setSelectedTemplateId(item.id);
                    setText(item.draft);
                  }
                },
                [
                  h5(
                    "div",
                    {
                      key: "row",
                      className: "flex items-center justify-between gap-2"
                    },
                    [
                      h5(
                        "div",
                        {
                          key: "title",
                          className: "text-sm font-medium text-[var(--foreground)]"
                        },
                        item.title
                      ),
                      h5(
                        "span",
                        {
                          key: "badge",
                          className: "shrink-0 rounded-full border border-[var(--obx-accent,#3B9AF5)]/25 px-2 py-0.5 text-[10px] text-[#1F7FD8]"
                        },
                        item.label || item.sensitivity || "template"
                      )
                    ]
                  ),
                  h5(
                    "p",
                    {
                      key: "desc",
                      className: "mt-1 text-xs leading-5 text-[var(--muted-foreground)]"
                    },
                    item.description
                  )
                ]
              )
            )
          ),
          h5("textarea", {
            key: "textarea",
            className: "min-h-28 w-full resize-none rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--obx-accent,#3B9AF5)]",
            value: text,
            onChange: (event) => setText(event.target.value)
          })
        ])
      ]),
      h5(
        "div",
        {
          key: "footer",
          className: "border-t border-[var(--border)] px-4 py-3"
        },
        [
          h5(
            "button",
            {
              key: "submit",
              type: "button",
              className: buttonClass("primary"),
              disabled: !respond || submitted,
              onClick: submit
            },
            "Submit for Review"
          )
        ]
      )
    ]
  );
}
var h5 = React6.createElement;

// ts/src/copilotkit/react-hook.ts
function useOpenBoxCopilotKit(options = {}) {
  const bindings = options.bindings;
  bindings?.useHumanInTheLoop({
    name: "openboxApprovalReview",
    description: "Show an OpenBox approval UI. After it returns, the assistant must call openbox_resume_governed_action with the returned payload.",
    parameters: options.approvalParameters,
    render: options.renderApprovalReview ?? ((props) => h6(OpenBoxApprovalReview, {
      ...options,
      status: String(props.status ?? ""),
      respond: props.respond,
      ...asRecord(props.args)
    }))
  });
  bindings?.useHumanInTheLoop({
    name: "openboxInteractiveReview",
    description: "Collect OpenBox-branded user choices or manual input. After it returns, the assistant must call openbox_governed_action with the returned payload.",
    parameters: options.interactiveParameters,
    render: options.renderInteractiveReview ?? ((props) => h6(OpenBoxInteractiveReview, {
      ...options,
      status: String(props.status ?? ""),
      respond: props.respond,
      ...asRecord(props.args)
    }))
  });
  const renderGovernedTool = (props) => {
    const name = String(props.name ?? "");
    if (!governedToolNames.includes(name)) return void 0;
    if (options.renderGovernedTool) return options.renderGovernedTool(props);
    const status = String(props.status ?? "");
    const result = props.result;
    const parameters = asRecord(props.parameters);
    const toolResult = parseToolResult(result);
    if (name === "openbox_governed_approval_action" && toolResult.status === "approval_required") {
      return null;
    }
    const actionResult = asNode(options.renderActionResult?.(props)) ?? (options.artifactRenderers ? h6(OpenBoxActionResult, {
      ...options,
      key: "result",
      result
    }) : null);
    return h6(
      React7.Fragment,
      null,
      asNode(options.renderGovernanceDecision?.(props)) ?? h6(OpenBoxGovernanceDecision, {
        ...options,
        key: "decision",
        status,
        parameters,
        result
      }),
      actionResult
    );
  };
  if (bindings?.useRenderTool) {
    for (const name of governedToolNames) {
      bindings.useRenderTool({ name, render: renderGovernedTool });
    }
  } else {
    bindings?.useDefaultRenderTool({ render: renderGovernedTool });
  }
  return {
    governedToolNames,
    approvalToolName: "openboxApprovalReview",
    interactiveToolName: "openboxInteractiveReview"
  };
}
var h6 = React7.createElement;
export {
  OpenBoxActionResult,
  OpenBoxApprovalReview,
  OpenBoxGovernanceDecision,
  OpenBoxInteractiveReview,
  createOpenBoxApprovalClient,
  useOpenBoxCopilotKit
};
