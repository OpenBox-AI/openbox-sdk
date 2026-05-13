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

/// Rust mirror of `applyEnvSource()` in `ts/src/cli/env-source.ts`.
///
/// Layers `~/.openbox/config` into the process environment so every
/// OpenBox surface — CLI, MCP, cursor / claude-code hooks, the Rust
/// approver — converges on the same active env without the user
/// having to remember to `export OPENBOX_ENV` in every shell. Reads
/// global keys first, resolves the env, then layers per-env keys.
///
/// Precedence (highest first):
///   1. Process env vars already set (explicit shell export wins).
///   2. `~/.openbox/config` global keys (lines without a prefix).
///   3. `~/.openbox/config` per-env keys (lines like
///      `local.OPENBOX_API_URL=...`).
///   4. Defaults baked into the spec-emitted `ENVIRONMENTS` table.
///
/// Returns the active env after layering. Idempotent: every set is
/// gated on `env::var().is_err()` so a second call is a no-op when
/// the first one's writes still stand. Best-effort: a missing file
/// or a parse error returns the env resolved from whatever env vars
/// are already set, never panics.
pub fn apply_env_source() -> EnvName {
    let pairs = read_config_pairs();
    // Pass 1: global keys (no env-prefix). Layered before env
    // resolution so a persisted `OPENBOX_ENV=local` takes effect.
    for (key, value) in &pairs {
        if !is_global_key(key) {
            continue;
        }
        if env::var(key).is_err() {
            // Safe because the keys we layer are all well-known
            // OPENBOX_* config knobs; the file format pre-validates.
            unsafe { env::set_var(key, value) };
        }
    }
    let env_name = resolve_env();
    let prefix = format!("{}.", env_name.as_str());
    // Pass 2: per-env keys. Strip the `<env>.` prefix before writing.
    for (key, value) in &pairs {
        if let Some(stripped) = key.strip_prefix(&prefix) {
            if env::var(stripped).is_err() {
                unsafe { env::set_var(stripped, value) };
            }
        }
    }
    env_name
}

/// Persist `OPENBOX_ENV=<env>` to the global section of
/// `~/.openbox/config`. The CLI's `openbox config set --global` writes
/// the same line; this helper is the Rust-side equivalent so the
/// approver's Settings window can flip env globally instead of
/// keeping its own per-app copy.
///
/// Edit semantics:
/// - If the file is missing, it's created with a single leading
///   `OPENBOX_ENV=<env>` line.
/// - If a global `OPENBOX_ENV=...` line already exists, it's replaced
///   in place. Any other global or per-env keys are preserved.
/// - If no `OPENBOX_ENV` line exists, one is prepended above per-env
///   keys (matching the order the CLI writes for fresh installs).
///
/// After this call, `apply_env_source()` will pick up the new value
/// on the next invocation. In-process callers that already have an
/// env resolved should rerun `apply_env_source()` themselves.
pub fn write_global_env(env: EnvName) -> std::io::Result<()> {
    let path = openbox_data_root().join("config");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut out_lines: Vec<String> = Vec::new();
    let mut replaced = false;
    for raw in existing.lines() {
        let trimmed = raw.trim_start();
        if trimmed.starts_with("OPENBOX_ENV=") && !trimmed.contains('.') {
            out_lines.push(format!("OPENBOX_ENV={}", env.as_str()));
            replaced = true;
        } else {
            out_lines.push(raw.to_string());
        }
    }
    if !replaced {
        // Insert at the top, after any leading comment block so the
        // file reads in the same order as the CLI's fresh-install
        // template.
        let mut insert_at = 0;
        for (i, line) in out_lines.iter().enumerate() {
            let t = line.trim();
            if t.starts_with('#') || t.is_empty() {
                insert_at = i + 1;
            } else {
                break;
            }
        }
        out_lines.insert(insert_at, format!("OPENBOX_ENV={}", env.as_str()));
    }
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut joined = out_lines.join("\n");
    if !joined.ends_with('\n') {
        joined.push('\n');
    }
    std::fs::write(&path, joined)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Walk `~/.openbox/config`, returning each non-comment `KEY=value`
/// pair in file order. Missing file or any IO error returns an empty
/// vec; the caller treats it as "no overrides". Lines without `=` or
/// empty / `#`-prefixed lines are skipped silently.
fn read_config_pairs() -> Vec<(String, String)> {
    let path = openbox_data_root().join("config");
    let text = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            out.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    out
}

/// Recognize keys that live at the global (no-prefix) layer of the
/// config file. Per-env keys carry an `<env>.` prefix that this
/// function rejects, so a stray `local.OPENBOX_ENV=...` never
/// pollutes the global layer.
fn is_global_key(key: &str) -> bool {
    !key.contains('.') && key.starts_with("OPENBOX_")
}

/// Reveal env-internal UI surfaces (env picker, active-env labels,
/// --env CLI flag in --help, etc.) when true. Returns false on every
/// public-facing build by default so end users never see staging /
/// local env names; the SDK keeps env switching available through
/// `~/.openbox/config` for power users without surfacing the
/// existence of multiple envs in the UI.
///
/// Sources (highest first):
///   1. `OPENBOX_DEBUG=1|true` env var
///   2. `~/.openbox/config` global `OPENBOX_DEBUG=true` line
///
/// Truthy values: `1`, `true`, `yes`, `on` (case-insensitive). Any
/// other value, including empty / unset, is false.
pub fn is_debug_mode() -> bool {
    fn truthy(s: &str) -> bool {
        matches!(s.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
    }
    if let Ok(v) = env::var("OPENBOX_DEBUG") {
        if truthy(v.trim()) {
            return true;
        }
    }
    for (k, v) in read_config_pairs() {
        if k == "OPENBOX_DEBUG" && truthy(v.trim()) {
            return true;
        }
    }
    false
}
