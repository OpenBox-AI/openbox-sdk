//! Rust SDK. Each `<package>/generated/` tree is emitted from
//! `specs/typespec/` via `typespec-emitter-rust` (re-emit via
//! `npm run specs:compile`). Hand-written glue lives in
//! `<package>/mod.rs` and `error.rs`.

pub mod error;
pub mod env;
pub mod types;
pub mod verdict;
pub(crate) mod transport;
pub mod client;
pub mod core;

pub use client::OpenBoxClient;
pub use core::OpenBoxCoreClient;
pub use error::ApiError;
pub use verdict::{verdict_label, VERDICT_ALLOW, VERDICT_BLOCK, VERDICT_CONSTRAIN, VERDICT_HALT, VERDICT_REQUIRE_APPROVAL};
