//! Approval rendering helpers shared by every Rust consumer of the
//! SDK. Keeps the activity-label vocabulary, summarized input picks,
//! verdict labels, and relative-time strings byte-aligned with
//! `ts/src/approvals/format.ts` so the same approval renders the same
//! string on iOS, in the VS Code extension, and in any Rust UI.
//!
//! The canonical activity-label table itself is spec-emitted into
//! `crate::core::generated::govern`; this module wraps that table
//! with the title-case fallback formatter for free-form
//! custom-preset activity_types.

pub mod format;
