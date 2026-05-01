//! Hand-written platform glue for the env package. The
//! spec-emitted bindings (every `EnvName` variant, `EnvConfigStatic`,
//! `TokenEntry`, the `ENVIRONMENTS` URL table, …) live in `generated/`;
//! this file adds the runtime helpers that mirror `ts/src/env/`:
//!
//! - [`EnvName`] parse / resolve helpers (`resolve_env`, `resolve_urls`)
//! - [`token_codec`] for the on-disk token store (`parse_token_store`,
//!   `serialize_token_store`)
//! - [`os_paths`] for the per-OS data root (`openbox_data_root`,
//!   `resolve_os_path`)
//! - [`api_key_format`] for the `OPENBOX_API_KEY` validator
//! - [`store`] for the read / write convenience that the CLI, the
//!   approver, and the extension all share

pub mod generated;

pub use generated::*;

mod api_key_format;
mod client_name;
mod os_paths;
mod store;
mod token_codec;

pub use api_key_format::{
    matches_obx_org_key, matches_obx_runtime_key, validate_api_key_format, API_KEY_PATTERN,
    ORG_API_KEY_PATTERN,
};
pub use client_name::{resolve_client_name, CLIENT_VARIANT_PATTERN};
pub use os_paths::{openbox_data_root, resolve_os_path};
pub use store::{
    clear_api_key, load_api_key, load_features, load_permissions, read_store, save_api_key,
    save_features, save_permissions, token_path, write_store,
};
pub use token_codec::{parse_token_store, serialize_token_store};

use std::env;

impl EnvName {
    /// Stable lowercase string used as the env-namespace prefix in the
    /// token store, in CLI flags, and in the `OPENBOX_ENV` env var.
    pub fn as_str(&self) -> &'static str {
        match self {
            EnvName::Production => "production",
            EnvName::Staging => "staging",
            EnvName::Local => "local",
        }
    }

    /// Look up the URL bundle for this env in the spec-emitted
    /// `ENVIRONMENTS` table. The table is exhaustive over the enum by
    /// construction: the emitter fails to generate when
    /// `specs/environments.json` is missing an entry for any variant.
    pub fn resolve(&self) -> EnvConfigStatic {
        for (name, cfg) in ENVIRONMENTS {
            if name == self {
                return *cfg;
            }
        }
        unreachable!("ENVIRONMENTS table is exhaustive over EnvName by emitter contract");
    }

    /// Parse an env name from `OPENBOX_ENV` or a CLI flag value. The
    /// match is case-insensitive; unknown values produce an error
    /// rather than silently routing to production.
    pub fn parse(s: &str) -> Result<Self, ParseEnvError> {
        match s.to_ascii_lowercase().as_str() {
            "production" | "prod" => Ok(EnvName::Production),
            "staging" | "stage" => Ok(EnvName::Staging),
            "local" | "dev" => Ok(EnvName::Local),
            other => Err(ParseEnvError(other.to_string())),
        }
    }
}

/// Returned by [`EnvName::parse`] for inputs that don't match a known
/// environment. Carries the offending value verbatim so CLI surfaces
/// can echo it in the error message.
#[derive(Debug, thiserror::Error)]
#[error("unknown OPENBOX_ENV='{0}'. Use 'production', 'staging', or 'local'.")]
pub struct ParseEnvError(pub String);

/// Mirror of `resolveEnv()` in `ts/src/env/environments.ts`. Reads
/// `OPENBOX_ENV` and falls back to production. CLI callers that accept
/// `--env <name>` should call [`EnvName::parse`] directly so a bad
/// flag surfaces as an error instead of silently picking production.
pub fn resolve_env() -> EnvName {
    match env::var("OPENBOX_ENV") {
        Ok(s) => EnvName::parse(&s).unwrap_or(EnvName::Production),
        Err(_) => EnvName::Production,
    }
}

/// Mirror of `resolveUrls(env)` in `ts/src/env/environments.ts`.
/// Returns the per-env URL bundle; identical to `env.resolve()` but
/// kept under the TS-name so a side-by-side audit is straightforward.
pub fn resolve_urls(env: EnvName) -> EnvConfigStatic {
    env.resolve()
}
