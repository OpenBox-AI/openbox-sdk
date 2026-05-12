//! Rust mirror of `ts/src/approvals/source.ts`. Source
//! attribution for an approval row.
//!
//! Every host adapter calls `buildSpan(host, ...)` from the SDK,
//! which stamps `module: <host>` on each span. The approval row
//! carries the spans verbatim, so the first span's `module`
//! identifies the originating host. The helper falls back to the
//! `gen_ai.system` classifier attribute when `module` is missing
//! (older or third-party adapters).
//!
//! When the backend gains a first-class `source` field on the
//! approval row, this helper should be updated to read that first.
//! The spec currently emits `ApprovalMetadata` as a closed struct
//! (only `trust_tier`), so the span path is the only read site for
//! now.
//!
//! Approvers and any UI that aggregates approvals across hosts
//! call `approval_source` to render a per-row source chip.

use crate::types::generated::Approval;

/// Infers the originating host. Returns `None` when no span
/// carries a usable `module` or `gen_ai.system`. Callers should
/// treat `None` permissively: display the row rather than filter
/// it out.
pub fn approval_source(approval: &Approval) -> Option<String> {
    let first = approval.spans.as_ref().and_then(|s| s.first())?;
    // `module` is the canonical write site (see
    // `ts/src/governance/spans.ts`).
    if let Some(module) = first.get("module").and_then(|v| v.as_str()) {
        if !module.is_empty() {
            return Some(module.to_string());
        }
    }
    // `gen_ai.system` is the classifier-derived fallback for
    // adapters that did not set `module`.
    let attrs = first.get("attributes").and_then(|v| v.as_object())?;
    if let Some(sys) = attrs.get("gen_ai.system").and_then(|v| v.as_str()) {
        if !sys.is_empty() {
            return Some(sys.to_string());
        }
    }
    None
}
