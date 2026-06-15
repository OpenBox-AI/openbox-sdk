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

// ts/src/copilotkit/react-custom-message-renderer.ts
import React7 from "react";

// ts/src/copilotkit/react-defaults.ts
var governedToolNames = [
  "openbox_governed_action",
  "openbox_governed_approval_action",
  "openbox_resume_governed_action"
];
var defaultScenarios = [
  {
    action: "open_operations_queue",
    title: "Operations Queue",
    reason: "OpenBox allowed this governed operations queue review.",
    capability: "Runtime policy, guardrails, behavior rules, audit trail",
    verdict: "allow"
  },
  {
    action: "create_support_ticket",
    title: "Operations Task",
    reason: "OpenBox allowed this internal operational action.",
    capability: "Internal workflow policy",
    verdict: "allow"
  },
  {
    action: "send_public_status_update",
    title: "Public Status Update",
    reason: "OpenBox allowed this low-sensitivity communication.",
    capability: "Public-content policy",
    verdict: "allow"
  },
  {
    action: "export_governance_identifiers",
    title: "Send Exception IDs",
    reason: "OpenBox blocked drift from governed work into a personal internal-identifier export.",
    capability: "Goal drift, destination policy",
    verdict: "block"
  },
  {
    action: "disable_production_payments",
    title: "Vendor Bank Update",
    reason: "OpenBox halted a critical production payment-control change.",
    capability: "Critical action halt",
    verdict: "halt"
  },
  {
    action: "issue_large_refund",
    title: "Service Credit Approval",
    reason: "OpenBox requires human approval before issuing this credit memo.",
    capability: "Human-in-the-loop approval",
    verdict: "approval"
  },
  {
    action: "review_data_handoff",
    title: "Vendor Review Handoff",
    reason: "OpenBox checks the selected destination and fields before preparing the handoff.",
    capability: "Data minimization, destination policy, redaction",
    verdict: "constrain"
  },
  {
    action: "submit_manual_request",
    title: "Manual Escalation Draft",
    reason: "OpenBox evaluates the final user-submitted input before execution.",
    capability: "Manual input governance",
    verdict: "allow"
  },
  {
    action: "view_governance_report",
    title: "Exception Report",
    reason: "OpenBox can constrain governed output and replace restricted fields with safe references.",
    capability: "Guardrails + redaction",
    verdict: "constrain"
  },
  {
    action: "draft_policy_constrained_message",
    title: "Customer Update Draft",
    reason: "OpenBox checks the generated draft before it is released to a customer channel.",
    capability: "Final output governance, guardrails, redaction",
    verdict: "constrain"
  }
];
var defaultChoiceOptions = [
  {
    id: "minimal",
    title: "Minimal Context",
    description: "Incident summary and timing only.",
    destination: "External review workspace",
    audience: "External reviewer",
    fields: ["summary", "service_tier", "timeline", "owner_note"],
    sensitivity: "internal"
  },
  {
    id: "growth",
    title: "Operational Context",
    description: "Adds service impact and owner notes for review.",
    destination: "External review workspace",
    audience: "External reviewer",
    fields: [
      "summary",
      "service_tier",
      "timeline",
      "owner_note",
      "impact"
    ],
    sensitivity: "confidential"
  },
  {
    id: "sensitive",
    title: "Full Internal Context",
    description: "Includes raw internal context that may be blocked or redacted.",
    destination: "External review workspace",
    audience: "External reviewer",
    fields: [
      "summary",
      "service_tier",
      "timeline",
      "owner_note",
      "source_value",
      "internal_context"
    ],
    sensitivity: "restricted"
  }
];
var verdictStyles = {
  reviewing: {
    label: "Reviewing",
    badge: "obx-status--reviewing",
    accent: "border-[var(--obx-accent,#3B9AF5)]/20 bg-[var(--obx-accent,#3B9AF5)]/5",
    dot: "bg-[var(--obx-accent,#3B9AF5)]"
  },
  allow: {
    label: "Allowed",
    badge: "obx-status--allow",
    accent: "border-emerald-500/25 bg-emerald-500/5",
    dot: "bg-emerald-500"
  },
  block: {
    label: "Blocked",
    badge: "obx-status--block",
    accent: "border-red-500/25 bg-red-500/5",
    dot: "bg-red-500"
  },
  rejected: {
    label: "Rejected",
    badge: "obx-status--rejected",
    accent: "border-red-500/25 bg-red-500/5",
    dot: "bg-red-500"
  },
  halt: {
    label: "Halted",
    badge: "obx-status--halt",
    accent: "border-orange-500/25 bg-orange-500/5",
    dot: "bg-orange-500"
  },
  approval: {
    label: "Approval Required",
    badge: "obx-status--approval",
    accent: "border-amber-500/25 bg-amber-500/5",
    dot: "bg-amber-500"
  },
  constrain: {
    label: "Redacted",
    badge: "obx-status--constrain",
    accent: "border-sky-500/25 bg-sky-500/5",
    dot: "bg-amber-500"
  },
  // Infrastructure failure, NOT a governance decision: OpenBox could not be
  // reached, so the action was not executed (failed closed). This must never
  // present itself as a "Blocked" policy verdict.
  error: {
    label: "Governance Unavailable",
    badge: "obx-status--error",
    accent: "border-[var(--border)] bg-[var(--secondary)]",
    dot: "bg-[var(--muted-foreground)]"
  }
};

// ts/src/copilotkit/react-action-result.ts
import React2 from "react";

// ts/src/copilotkit/react-utils.ts
import React, { useEffect } from "react";

// ts/src/copilotkit/react-styles.ts
var openBoxRendererCss = `
.obx-governance-card{
  --obx-verdict:var(--obx-accent,#3f6f9c);
  --obx-row-border:color-mix(in srgb,var(--border,#d9dce3) 72%,transparent);
  --obx-muted:var(--muted-foreground,#59616f);
  --obx-surface:var(--background,#fff);
  position:relative;
  display:block;
  width:100%;
  max-width:38rem;
  margin:.75rem 0;
  overflow:hidden;
  color:var(--foreground,#010507);
  background:var(--obx-surface);
  border:1px solid color-mix(in srgb,var(--obx-verdict) 72%,var(--border,#d9dce3));
  border-radius:8px;
  box-shadow:0 1px 2px rgb(15 23 42 / .06);
}
.obx-governance-card--allow{--obx-verdict:#2f7d5a}
.obx-governance-card--block,.obx-governance-card--rejected{--obx-verdict:#a94444}
.obx-governance-card--halt{--obx-verdict:#955f35}
.obx-governance-card--approval,.obx-governance-card--constrain{--obx-verdict:#826a3a}
.obx-governance-card--reviewing{--obx-verdict:var(--obx-accent,#3f6f9c)}
.obx-governance-card--error{--obx-verdict:var(--obx-muted)}
.obx-governance-content{min-width:0;padding:.875rem 1rem .95rem}
.obx-governance-header{min-width:0}
.obx-governance-body{margin-top:.75rem}
.obx-governance-section{
  border-top:1px solid var(--obx-row-border);
  padding-top:.7rem;
  margin-top:.7rem;
}
.obx-timing{font-size:.75rem;line-height:1rem;color:var(--obx-muted)}
.obx-timing-total,.obx-timing-row{
  display:grid;
  grid-template-columns:minmax(0,1fr) max-content;
  align-items:center;
  gap:.75rem;
  font-variant-numeric:tabular-nums;
}
.obx-timing-total{
  color:var(--foreground,#010507);
  font-weight:650;
}
.obx-timing-row{margin:.3rem 0 0}
.obx-timing-row span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.obx-timing-row span:last-child{color:var(--foreground,#010507);font-weight:550}
.obx-section-label{
  color:var(--obx-muted);
  font-size:11px;
  font-weight:700;
  letter-spacing:0;
  line-height:1rem;
  text-transform:none;
}
.obx-request-text{
  margin:.3rem 0 0;
  color:var(--foreground,#010507);
  font-size:.875rem;
  line-height:1.35rem;
}
.obx-meta-row{
  display:grid;
  grid-template-columns:5.75rem minmax(0,1fr);
  gap:.75rem;
  margin-top:.55rem;
  color:var(--obx-muted);
  font-size:.75rem;
  line-height:1rem;
}
.obx-meta-row strong{color:var(--foreground,#010507);font-weight:650}
.obx-detail-list{display:grid;gap:.3rem;margin-top:.5rem}
.obx-detail-row{
  display:grid;
  grid-template-columns:5.75rem minmax(0,1fr);
  gap:.75rem;
  color:var(--obx-muted);
  font-size:.75rem;
  line-height:1rem;
}
.obx-detail-row strong{
  min-width:0;
  color:var(--foreground,#010507);
  font-weight:550;
  overflow:hidden;
  text-overflow:ellipsis;
}
.obx-metrics{display:grid;gap:.3rem;margin-bottom:.6rem}
.obx-metric{
  display:grid;
  grid-template-columns:5.75rem minmax(0,1fr);
  gap:.75rem;
  align-items:baseline;
}
.obx-metric-label{
  color:var(--obx-muted);
  font-size:.75rem;
  font-weight:700;
  letter-spacing:0;
  line-height:1rem;
  text-transform:none;
}
.obx-metric-value{color:var(--foreground,#010507);font-size:.75rem;font-weight:550;line-height:1rem}
.obx-redaction{color:var(--obx-muted);font-size:.75rem;line-height:1.15rem}
.obx-redaction-title{color:var(--foreground,#010507);font-weight:650}
.obx-redaction-body{margin-top:.2rem;max-width:32rem}
.obx-redaction-field{
  display:grid;
  grid-template-columns:5.75rem minmax(0,1fr);
  gap:.75rem;
  align-items:baseline;
  color:var(--foreground,#010507);
  font-size:.75rem;
  line-height:1rem;
}
.obx-redaction-field span{color:var(--obx-muted);font-weight:700}
.obx-redaction-field strong{font-weight:550}
.obx-pill-row{display:grid;gap:.3rem;margin-top:.5rem}
.obx-pill{
  color:var(--foreground,#010507);
  background:transparent;
  border:0;
  border-radius:0;
  font-size:11px;
  line-height:1rem;
  padding:0;
}
.obx-pill--accent{background:transparent}
.obx-check-list{display:grid;gap:.3rem;margin-top:.45rem}
.obx-check-item{
  display:block;
  color:var(--foreground,#010507);
  font-size:.75rem;
  line-height:1rem;
}
.obx-renderer-header{display:flex;align-items:flex-start;gap:.75rem;min-width:0}
.obx-renderer-mark{
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
  width:1.75rem;
  height:1.75rem;
  overflow:hidden;
  border-radius:6px;
}
.obx-renderer-mark--image{
  background:#fff;
  border:1px solid color-mix(in srgb,var(--border,#d9dce3) 85%,transparent);
  padding:.28rem;
}
.obx-renderer-mark--image img{display:block;width:100%;height:100%;object-fit:contain}
.obx-renderer-mark--fallback{
  color:var(--obx-verdict);
  background:transparent;
  border:1px solid color-mix(in srgb,var(--obx-verdict) 32%,transparent);
  font-size:.65rem;
  font-weight:700;
}
.obx-renderer-brand-row{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:.5rem .75rem;
}
.obx-renderer-brand{
  color:var(--obx-muted);
  font-size:.75rem;
  font-weight:700;
  letter-spacing:0;
  line-height:1rem;
  text-transform:none;
}
.obx-renderer-badge{
  display:inline-flex;
  align-items:center;
  gap:.35rem;
  flex-shrink:0;
  color:var(--foreground,#010507);
  font-size:.75rem;
  font-weight:600;
  line-height:1rem;
  padding:0;
}
.obx-renderer-badge::before{
  content:"";
  width:.375rem;
  height:.375rem;
  border-radius:999px;
  background:var(--obx-status-color,var(--obx-verdict));
}
.obx-status--reviewing{--obx-status-color:var(--obx-accent,#3f6f9c)}
.obx-status--allow{--obx-status-color:#2f7d5a}
.obx-status--block,.obx-status--rejected{--obx-status-color:#a94444}
.obx-status--halt{--obx-status-color:#955f35}
.obx-status--approval,.obx-status--constrain{--obx-status-color:#826a3a}
.obx-status--error{--obx-status-color:var(--obx-muted)}
.obx-renderer-title{
  margin:.2rem 0 0;
  color:var(--foreground,#010507);
  font-size:.925rem;
  font-weight:650;
  line-height:1.25rem;
}
.obx-renderer-reason{
  margin:.25rem 0 0;
  color:var(--obx-muted);
  font-size:.8125rem;
  line-height:1.25rem;
  max-width:34rem;
}
@media (max-width:420px){
  .obx-governance-content{padding:.8rem}
  .obx-meta-row,.obx-detail-row,.obx-metric,.obx-redaction-field,.obx-check-item{grid-template-columns:1fr;gap:.15rem}
  .obx-renderer-brand-row{align-items:flex-start}
}
[class~="my-3"]{margin-top:.75rem;margin-bottom:.75rem}
[class~="mt-0.5"]{margin-top:.125rem}
[class~="mt-1"]{margin-top:.25rem}
[class~="mt-2"]{margin-top:.5rem}
[class~="mt-3"]{margin-top:.75rem}
[class~="mb-1.5"]{margin-bottom:.375rem}
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
[class~="pt-3"]{padding-top:.75rem}
[class~="w-full"]{width:100%}
[class~="w-1.5"]{width:.375rem}
[class~="h-1"]{height:.25rem}
[class~="h-1.5"]{height:.375rem}
[class~="w-8"]{width:2rem}
[class~="h-8"]{height:2rem}
[class~="w-9"]{width:2.25rem}
[class~="h-9"]{height:2.25rem}
[class~="h-full"]{height:100%}
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
[class~="space-y-2"]>:not([hidden])~:not([hidden]){margin-top:.5rem}
[class~="space-y-1"]>:not([hidden])~:not([hidden]){margin-top:.25rem}
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
[class~="bg-emerald-500"]{background:#10b981}
[class~="bg-red-500"]{background:#ef4444}
[class~="bg-orange-500"]{background:#f97316}
[class~="bg-amber-500"]{background:#f59e0b}
[class~="bg-[var(--muted-foreground)]"]{background:var(--muted-foreground,#adadb2)}
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
[class~="tabular-nums"]{font-variant-numeric:tabular-nums}
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
[class~="object-contain"]{object-fit:contain}
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
import React4, { useRef, useState as useState2 } from "react";

// ts/src/copilotkit/react-renderer-header.ts
import React3, { useEffect as useEffect2, useState } from "react";
function OpenBoxHeader({
  title,
  badge,
  badgeClassName,
  reason,
  busy,
  logoSrc
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect2(() => {
    setLogoFailed(false);
  }, [logoSrc]);
  const showLogo = Boolean(logoSrc && !logoFailed);
  return h2("div", { className: "obx-renderer-header" }, [
    h2(
      "div",
      {
        key: "mark",
        className: showLogo ? "obx-renderer-mark obx-renderer-mark--image" : "obx-renderer-mark obx-renderer-mark--fallback"
      },
      showLogo ? h2("img", {
        src: logoSrc,
        alt: "",
        onError: () => setLogoFailed(true)
      }) : busy ? "..." : "OB"
    ),
    h2("div", { key: "copy", className: "min-w-0 flex-1" }, [
      h2(
        "div",
        {
          key: "brand-row",
          className: "obx-renderer-brand-row"
        },
        [
          h2(
            "div",
            {
              key: "brand",
              className: "obx-renderer-brand"
            },
            "OpenBox"
          ),
          h2(
            "span",
            {
              key: "badge",
              className: `obx-renderer-badge ${badgeClassName}`
            },
            badge
          )
        ]
      ),
      h2(
        "h3",
        {
          key: "title",
          className: "obx-renderer-title"
        },
        title
      ),
      h2(
        "p",
        {
          key: "reason",
          className: "obx-renderer-reason"
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
  const [decision, setDecision] = useState2(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState2(false);
  const [error, setError] = useState2(null);
  const respondedRef = useRef(false);
  const isPending = status === "inProgress";
  const decide = async (approved) => {
    if (!respond || isSubmitting || respondedRef.current) return;
    setError(null);
    setIsSubmitting(true);
    const apiDecision = approved ? "approve" : "reject";
    try {
      if (!governanceEventId) {
        throw new Error("OpenBox approval decision requires governanceEventId.");
      }
      const client = approvalClient ?? createOpenBoxApprovalClient({ endpoint: approvalEndpoint });
      await client.decide({
        governanceEventId,
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
import React5, { useEffect as useEffect3 } from "react";
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
  const hasDecision = Boolean(toolResult.status || toolResult.verdict);
  const verdict = !hasDecision ? "reviewing" : verdictFromResult(toolResult, scenario);
  const isReviewing = verdict === "reviewing";
  const styles = verdictStyles[verdict];
  const request = textValue(toolResult.request ?? parameters?.request) || "OpenBox governed action";
  const destination = textValue(
    toolResult.destination ?? parameters?.destination
  );
  const amountUsd = typeof toolResult.amountUsd === "number" ? toolResult.amountUsd : parameters?.amountUsd;
  const fields = Array.isArray(toolResult.fields) ? toolResult.fields : Array.isArray(parameters?.fields) ? parameters.fields : void 0;
  const session = parseToolResult(toolResult.session);
  const rawReason = toolResult.status === "error" ? "OpenBox is unavailable or returned an error. The governed action was stopped fail-closed." : verdict === "reviewing" ? "OpenBox is reviewing this before the assistant acts." : textValue(toolResult.reason) || scenario.reason;
  const reason = verdict === "constrain" && /^OpenBox allowed this action\.?$/i.test(rawReason) ? "OpenBox allowed this action after applying required transformations." : rawReason;
  const riskScore = typeof toolResult.riskScore === "number" && toolResult.riskScore > 0 ? toolResult.riskScore : void 0;
  const trustTier = textValue(toolResult.trustTier);
  const redactionSummary = textValue(toolResult.redactionSummary);
  const timings = normalizeTimings(toolResult.timings) ?? normalizeTimings(parameters?.timings);
  useEffect3(() => {
    if (session.status !== "halted") return;
    onSessionHalted?.(session.haltedAt);
  }, [onSessionHalted, session.haltedAt, session.status]);
  return h4(
    "section",
    {
      className: `obx-governance-card obx-governance-card--${verdict}`,
      style: rendererStyle(resolvedTheme)
    },
    [
      h4("div", { key: "content", className: "obx-governance-content" }, [
        h4(
          "div",
          { key: "head", className: "obx-governance-header" },
          h4(OpenBoxHeader, {
            key: "header",
            logoSrc: resolvedTheme.logoSrc,
            title: verdict === "error" ? "Governance unavailable" : isReviewing ? "Governance review" : "Governance decision",
            badge: styles.label,
            badgeClassName: styles.badge,
            reason,
            busy: isReviewing
          })
        ),
        h4("div", { key: "body", className: "obx-governance-body" }, [
          timings ? renderTimingSummary(timings, isReviewing) : null,
          h4(
            "div",
            {
              key: "request",
              className: "obx-governance-section obx-governance-request"
            },
            [
              h4(
                "div",
                {
                  key: "label",
                  className: "obx-section-label"
                },
                "Request"
              ),
              h4(
                "p",
                {
                  key: "text",
                  className: "obx-request-text"
                },
                request
              ),
              h4(
                "div",
                {
                  key: "scenario",
                  className: "obx-meta-row"
                },
                [
                  h4("span", { key: "label" }, "Workflow"),
                  h4("strong", { key: "value" }, scenario.title)
                ]
              ),
              renderRequestDetails({ amountUsd, destination, fields })
            ]
          ),
          riskScore !== void 0 || trustTier || redactionSummary ? h4(
            "div",
            {
              key: "signals",
              className: "obx-governance-section obx-governance-signals"
            },
            [
              renderSignalMetrics({ riskScore, trustTier }),
              redactionSummary ? h4(
                "div",
                { key: "redaction" },
                renderRedactionSummary(redactionSummary, action)
              ) : null
            ]
          ) : null,
          renderCheckedLine(scenario.capability)
        ])
      ])
    ]
  );
}
function renderSignalMetrics({
  riskScore,
  trustTier
}) {
  const metrics = [
    riskScore !== void 0 ? {
      key: "risk",
      label: "Risk score",
      value: `${Math.round(riskScore * 100) / 100}`
    } : void 0,
    trustTier ? { key: "trust", label: "Trust tier", value: trustTier } : void 0
  ].filter(
    (item) => Boolean(item)
  );
  if (!metrics.length) return null;
  return h4(
    "div",
    { key: "metrics", className: "obx-metrics" },
    metrics.map(
      (metric) => h4(
        "div",
        {
          key: metric.key,
          className: "obx-metric"
        },
        [
          h4(
            "div",
            {
              key: "label",
              className: "obx-metric-label"
            },
            metric.label
          ),
          h4(
            "div",
            {
              key: "value",
              className: "obx-metric-value"
            },
            metric.value
          )
        ]
      )
    )
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
  if (result.status === "error" || result.verdict === "error") return "error";
  if (result.status === "halted" || result.verdict === "halt")
    return "halt";
  if (result.status === "constrained" || result.verdict === "constrain")
    return "constrain";
  if (typeof result.redactionSummary === "string" && result.redactionSummary.length > 0 && (result.status === "executed" || result.verdict === "allow")) {
    return "constrain";
  }
  if (result.status === "executed" || result.verdict === "allow")
    return "allow";
  if (result.status === "blocked" || result.status === "approval_pending" || result.verdict === "block") {
    return "block";
  }
  if (result.verdict === "require_approval") return "approval";
  return "reviewing";
}
function renderRedactionSummary(summary, action) {
  if (action === "draft_policy_constrained_message" && summary.includes("output.artifact.sourceContext")) {
    return "OpenBox redacted the sensitive source context used to draft this output.";
  }
  const fields = redactedFieldLabels(summary);
  if (fields.length === 0) return summary;
  return h4("div", { className: "obx-redaction" }, [
    h4(
      "div",
      { key: "title", className: "obx-redaction-title" },
      "Sensitive data adjusted"
    ),
    h4(
      "div",
      { key: "body", className: "obx-redaction-body" },
      "OpenBox removed or transformed sensitive details before this result was shown."
    ),
    h4(
      "div",
      { key: "fields", className: "obx-pill-row" },
      fields.map(
        (field) => h4(
          "div",
          {
            key: field,
            className: "obx-redaction-field"
          },
          [
            h4("span", { key: "label" }, "Field"),
            h4("strong", { key: "value" }, field)
          ]
        )
      )
    )
  ]);
}
function redactedFieldLabels(summary) {
  const matches = Array.from(summary.matchAll(/redacted\s+([A-Za-z0-9_.*[\]-]+(?:\.[A-Za-z0-9_.*[\]-]+)*)/gi));
  const paths = matches.map((match) => match[1]).filter(Boolean);
  const labels = paths.map(redactedFieldLabel);
  return Array.from(new Set(labels));
}
function redactedFieldLabel(path) {
  if (/input\.(?:\d+|\*)\.args\.request|input\.args\.request/.test(path)) {
    return "Request text";
  }
  if (/input\.(?:\d+|\*)\.args\.manualInput|input\.args\.manualInput/.test(path)) {
    return "Edited note";
  }
  if (path.includes("output.artifact.sourceContext")) return "Source context";
  if (path.includes("output.artifact.body")) return "Draft body";
  if (path.includes("output.artifact.records")) return "Report rows";
  if (path.includes("output.artifact.summary")) return "Summary";
  if (path.includes("output.artifact")) return "Result artifact";
  return path.replace(/^input\.(?:\d+|\*)\.args\./, "").replace(/^input\.args\./, "").replace(/^output\.artifact\./, "").replace(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function renderRequestDetails({
  amountUsd,
  destination,
  fields
}) {
  const details = [
    destination ? { label: "Destination", value: destination } : void 0,
    typeof amountUsd === "number" && amountUsd > 0 ? { label: "Amount", value: `$${amountUsd.toLocaleString()}` } : void 0,
    fields?.length ? { label: "Fields", value: fields.join(", ") } : void 0
  ].filter(
    (detail) => Boolean(detail)
  );
  if (!details.length) return null;
  return h4(
    "div",
    {
      key: "details",
      className: "obx-detail-list"
    },
    details.map(
      (detail) => h4(
        "div",
        {
          key: detail.label,
          className: "obx-detail-row"
        },
        [
          h4("span", { key: "label" }, detail.label),
          h4("strong", { key: "value" }, detail.value)
        ]
      )
    )
  );
}
function renderCheckedLine(capability) {
  const items = capability.split(/\s*(?:\+|,)\s+/).map((item) => capabilityLabel(item.trim())).filter(Boolean);
  if (!items.length) return null;
  return h4(
    "div",
    {
      key: "checks",
      className: "obx-governance-section obx-checks"
    },
    [
      h4(
        "div",
        {
          key: "label",
          className: "obx-section-label"
        },
        "Controls"
      ),
      h4(
        "div",
        { key: "items", className: "obx-check-list" },
        items.map(
          (item) => h4(
            "div",
            {
              key: item,
              className: "obx-check-item"
            },
            item
          )
        )
      )
    ]
  );
}
function renderTimingSummary(timings, isReviewing) {
  return h4(
    "div",
    {
      key: "timings",
      className: "obx-governance-section obx-timing"
    },
    [
      h4(
        "div",
        {
          key: "total",
          className: "obx-timing-total"
        },
        [
          h4(
            "span",
            { key: "label" },
            isReviewing ? "Reviewing" : "Completed"
          ),
          h4(
            "span",
            { key: "value" },
            isReviewing ? `${formatMs(timings.totalMs)} elapsed` : `${formatMs(timings.totalMs)} total`
          )
        ]
      ),
      ...timings.steps.map(
        (step) => h4(
          "p",
          {
            key: step.key,
            className: "obx-timing-row"
          },
          [
            h4("span", { key: "label" }, humanTimingLabel(step)),
            h4(
              "span",
              {
                key: "value"
              },
              formatMs(step.ms)
            )
          ]
        )
      )
    ]
  );
}
function normalizeTimings(value) {
  if (!value || typeof value !== "object") return void 0;
  const raw = value;
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normalizeTimingStep).filter((step) => Boolean(step)) : [];
  const totalFromValue = typeof raw.totalMs === "number" && Number.isFinite(raw.totalMs) ? raw.totalMs : void 0;
  const totalMs = totalFromValue ?? steps.reduce((sum, step) => sum + step.ms, 0);
  if (!Number.isFinite(totalMs) || totalMs <= 0 && steps.length === 0) {
    return void 0;
  }
  const openBoxMs = steps.filter((step) => step.kind === "openbox").reduce((sum, step) => sum + step.ms, 0);
  const workMs = steps.filter((step) => step.kind !== "openbox" && step.kind !== "workflow").reduce((sum, step) => sum + step.ms, 0);
  return {
    totalMs: Math.max(0, totalMs),
    openBoxMs: Math.max(0, openBoxMs),
    workMs: Math.max(0, workMs),
    steps
  };
}
function normalizeTimingStep(value) {
  if (!value || typeof value !== "object") return void 0;
  const raw = value;
  const ms = typeof raw.ms === "number" ? raw.ms : Number(raw.ms);
  if (!Number.isFinite(ms) || ms < 0) return void 0;
  const label = textValue(raw.label) || textValue(raw.key);
  if (!label) return void 0;
  return {
    key: textValue(raw.key) || label,
    label,
    kind: textValue(raw.kind) || "tool",
    ms
  };
}
function humanTimingLabel(step) {
  const label = step.label.trim();
  if (/^input policy check$/i.test(label)) return "OpenBox input check";
  if (/^output policy check$/i.test(label)) return "OpenBox output check";
  if (/^business action$/i.test(label)) return "Assistant action";
  if (/^generate result ui$/i.test(label)) return "Generate result UI";
  if (step.kind === "openbox" && !/^OpenBox\b/.test(label)) {
    return `OpenBox ${lowercaseFirst(label)}`;
  }
  return label;
}
function capabilityLabel(value) {
  if (!value) return value;
  return value.replace(/\S+/g, (word) => {
    if (/^[A-Z0-9-]+$/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
}
function lowercaseFirst(value) {
  if (!value) return value;
  return value[0].toLowerCase() + value.slice(1);
}
function formatMs(ms) {
  if (ms >= 1e3) return `${(ms / 1e3).toFixed(ms >= 1e4 ? 0 : 1)}s`;
  return `${Math.round(ms)}ms`;
}
var h4 = React5.createElement;

// ts/src/copilotkit/react-interactive-review.ts
import React6, { useRef as useRef2, useState as useState3 } from "react";
function OpenBoxInteractiveReview({
  status,
  respond,
  mode,
  title,
  request,
  action,
  destination,
  fields,
  manualInput,
  sensitivity,
  choiceId,
  choiceOptions,
  logoSrc,
  theme
}) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const safeMode = mode === "manual" ? "manual" : "choice";
  const options = choiceOptions?.length ? choiceOptions : defaultChoiceOptions;
  const safeRequest = request?.trim() || (safeMode === "choice" ? "Prepare a governed external handoff." : "Draft a governed manual request.");
  const safeAction = action || (safeMode === "choice" ? "review_data_handoff" : "submit_manual_request");
  const safeTitle = title || (safeMode === "choice" ? "OpenBox Input Review" : "OpenBox Manual Review");
  const initialOption = options.find((option) => option.id === choiceId) ?? options.find(
    (option) => fields?.every((field) => option.fields.includes(field))
  ) ?? options[0];
  const [selectedOptionId, setSelectedOptionId] = useState3(initialOption.id);
  const [text, setText] = useState3(manualInput?.trim() || "");
  const [submitted, setSubmitted] = useState3(false);
  const respondedRef = useRef2(false);
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? initialOption;
  const submit = () => {
    if (!respond || submitted || respondedRef.current) return;
    const payload = safeMode === "choice" ? {
      action: safeAction,
      request: safeRequest,
      destination: selectedOption.destination,
      fields: selectedOption.fields,
      audience: selectedOption.audience,
      sensitivity: selectedOption.sensitivity,
      choiceId: selectedOption.id,
      nextTool: "openbox_governed_action",
      mustCallOpenBoxGovernedAction: true,
      submittedAt: (/* @__PURE__ */ new Date()).toISOString()
    } : {
      action: safeAction,
      request: safeRequest,
      destination,
      manualInput: text,
      sensitivity,
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
          h5("textarea", {
            key: "textarea",
            className: "min-h-28 w-full resize-none rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--obx-accent,#3B9AF5)]",
            placeholder: "Enter the final text for OpenBox review.",
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

// ts/src/copilotkit/react-custom-message-renderer.ts
function createOpenBoxCustomMessageRenderer(options = {}) {
  const render = (props) => {
    const position = String(props.position ?? "");
    if (position !== "before" && position !== "after") return null;
    const message = asRecord(props.message);
    const result = findOpenBoxResult(message, props.stateSnapshot);
    if (!result) return null;
    const toolResult = parseToolResult(result);
    if (toolResult.schemaVersion !== "openbox.copilotkit.result.v1") {
      return null;
    }
    const renderProps = {
      name: textValue2(message.name) || textValue2(toolResult.action),
      status: "complete",
      parameters: {},
      result
    };
    const actionResult = asNode(options.renderActionResult?.(renderProps)) ?? (options.artifactRenderers ? h6(OpenBoxActionResult, {
      ...options,
      key: "result",
      result
    }) : null);
    return h6(
      React7.Fragment,
      null,
      asNode(options.renderGovernanceDecision?.(renderProps)) ?? h6(OpenBoxGovernanceDecision, {
        ...options,
        key: "decision",
        status: "complete",
        parameters: {},
        result
      }),
      actionResult
    );
  };
  return {
    agentId: options.agentId,
    render
  };
}
function findOpenBoxResult(message, stateSnapshot) {
  const kind = textValue2(message.role ?? message.type);
  if (kind === "tool") return message.content;
  if (kind !== "assistant" && kind !== "ai") return null;
  const toolCalls = toolCallsFromMessage(message);
  const openBoxToolCallIds = new Set(
    toolCalls.filter((toolCall) => governedToolNames.includes(toolCallName(toolCall))).map((toolCall) => textValue2(asRecord(toolCall).id)).filter(Boolean)
  );
  if (openBoxToolCallIds.size === 0) return null;
  const snapshot = asRecord(stateSnapshot);
  const snapshotMessages = Array.isArray(snapshot.messages) ? snapshot.messages.map(asRecord) : [];
  const toolMessage = snapshotMessages.find((item) => {
    if (item.type !== "tool" && item.role !== "tool") return false;
    const toolCallId = textValue2(item.tool_call_id ?? item.toolCallId);
    return toolCallId && openBoxToolCallIds.has(toolCallId);
  });
  return toolMessage?.content ?? null;
}
function toolCallsFromMessage(message) {
  if (Array.isArray(message.toolCalls)) return message.toolCalls;
  if (Array.isArray(message.tool_calls)) return message.tool_calls;
  const additionalKwargs = asRecord(message.additional_kwargs);
  if (Array.isArray(additionalKwargs.tool_calls)) {
    return additionalKwargs.tool_calls;
  }
  return [];
}
function toolCallName(toolCall) {
  const record = asRecord(toolCall);
  const fn = asRecord(record.function);
  return textValue2(record.name ?? fn.name);
}
function textValue2(value) {
  return typeof value === "string" ? value : "";
}
var h6 = React7.createElement;

// ts/src/copilotkit/react-hook.ts
import React8 from "react";
function useOpenBoxCopilotKit(options = {}) {
  const bindings = options.bindings;
  bindings?.useHumanInTheLoop({
    name: "openboxApprovalReview",
    description: "Show an OpenBox approval UI. After it returns, the assistant must call openbox_resume_governed_action with the returned payload.",
    parameters: options.approvalParameters,
    render: options.renderApprovalReview ?? ((props) => h7(OpenBoxApprovalReview, {
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
    render: options.renderInteractiveReview ?? ((props) => h7(OpenBoxInteractiveReview, {
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
    const actionResult = asNode(options.renderActionResult?.(props)) ?? (options.artifactRenderers ? h7(OpenBoxActionResult, {
      ...options,
      key: "result",
      result
    }) : null);
    return h7(
      React8.Fragment,
      null,
      asNode(options.renderGovernanceDecision?.(props)) ?? h7(OpenBoxGovernanceDecision, {
        ...options,
        key: "decision",
        status,
        parameters,
        result
      }),
      actionResult
    );
  };
  bindings?.useDefaultRenderTool({ render: renderGovernedTool });
  return {
    governedToolNames,
    approvalToolName: "openboxApprovalReview",
    interactiveToolName: "openboxInteractiveReview"
  };
}
var h7 = React8.createElement;
export {
  OpenBoxActionResult,
  OpenBoxApprovalReview,
  OpenBoxGovernanceDecision,
  OpenBoxInteractiveReview,
  createOpenBoxApprovalClient,
  createOpenBoxCustomMessageRenderer,
  useOpenBoxCopilotKit
};
