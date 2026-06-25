export const openBoxRendererCss = `
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
.obx-renderer-mark--text{
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
