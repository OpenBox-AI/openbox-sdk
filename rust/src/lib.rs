//! Rust client for the OpenBox backend API. Lives inside the openbox-sdk
//! monorepo at `rust/`; generated at build time by `progenitor` from the
//! sibling `../specs/backend.json` - the same OpenAPI spec the TypeScript
//! SDK's `Backend` namespace types are generated from. Both languages
//! stay in lockstep because the spec is the single source of truth.
//!
//! ## Refresh procedure
//!
//! When `specs/backend.json` is refreshed and a new tag is cut on
//! openbox-sdk, consumers pick up the new contract by bumping their
//! git `tag` pin. The codegen runs automatically on `cargo build`.
//!
//! ## Usage
//!
//! ```toml
//! [dependencies]
//! openbox-rust-sdk = { git = "https://github.com/OpenBox-AI/openbox-sdk", tag = "v0.1.0-alpha.1" }
//! ```
//!
//! ```ignore
//! use openbox_rust_sdk::backend::Client;
//!
//! let client = Client::new("https://api.openbox.ai");
//! let profile = client.auth_controller_get_profile().send().await?;
//! ```

/// Generated Rust types + async client for the OpenBox backend API.
/// Surfaced under a module name (rather than re-exported flat) so types
/// like `Approval` don't collide with anything we hand-write later
/// (e.g. wire-shape helpers or sync wrappers built on top of this).
pub mod backend {
    include!(concat!(env!("OUT_DIR"), "/backend_codegen.rs"));
}
