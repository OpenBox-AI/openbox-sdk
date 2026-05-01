//! Per-OS data path resolver. Mirror of `ts/src/env/os-paths.ts`.
//!
//! Layout:
//!   Linux   `$XDG_DATA_HOME/openbox/<scope>` (default `~/.openbox/<scope>`)
//!   macOS   `~/.openbox/<scope>`
//!   Windows `%APPDATA%\openbox\<scope>`     (default `~\AppData\Roaming\openbox\<scope>`)
//!
//! `OPENBOX_HOME` is honored on every OS as a hard override (testing,
//! CI, sandboxes). The TS implementation has the same precedence; the
//! Rust side mirrors it byte-for-byte so the CLI, the extension, and
//! the approver all read / write the same files regardless of which
//! language wrote them last.

use std::env;
use std::path::PathBuf;

use super::generated::OsPathScope;

/// Returns the openbox user-data root for the current platform. Honors
/// `OPENBOX_HOME` as a hard override.
pub fn openbox_data_root() -> PathBuf {
    if let Ok(o) = env::var("OPENBOX_HOME") {
        return PathBuf::from(o);
    }

    if cfg!(target_os = "windows") {
        let app_data = env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| {
            home_dir().join("AppData").join("Roaming")
        });
        return app_data.join("openbox");
    }

    if cfg!(target_os = "linux") {
        if let Ok(xdg) = env::var("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join("openbox");
        }
    }

    home_dir().join(".openbox")
}

/// Resolves a per-OS subpath under [`openbox_data_root`]. Conforms to
/// the `OsPathResolver` interface from the spec.
pub fn resolve_os_path(scope: OsPathScope) -> PathBuf {
    openbox_data_root().join(scope_dirname(scope))
}

fn scope_dirname(scope: OsPathScope) -> &'static str {
    match scope {
        OsPathScope::Tokens => "tokens",
        OsPathScope::Config => "config",
        OsPathScope::Cache => "cache",
        OsPathScope::AgentKeys => "agent-keys",
    }
}

fn home_dir() -> PathBuf {
    // `dirs` would pull a transitive dep; for a single homedir lookup
    // we read `HOME` (Unix) / `USERPROFILE` (Windows) directly. Both
    // are stable env vars on every shipping shell.
    if cfg!(target_os = "windows") {
        env::var("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|_| env::var("HOME").map(PathBuf::from))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}
