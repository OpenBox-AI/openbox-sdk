//! On-disk read / write helpers for the env-namespaced token store.
//! Mirror of `ts/src/cli/config.ts`'s `readStore` / `loadApiKey` /
//! `saveApiKey` / `loadPermissions` / `loadFeatures` helpers; lives in
//! the SDK so the approver and the VS Code extension share the same
//! IO path the CLI uses.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;

use super::generated::{EnvName, OsPathScope, TokenEntry, TokenStore};
use super::os_paths::resolve_os_path;
use super::token_codec::{parse_token_store, serialize_token_store};

/// Resolve the token-file path. Mirrors the CLI: a `.tokens` file in
/// the current working directory wins (CI / dev-loop convenience),
/// otherwise the per-OS data root's `tokens` file is used. The
/// containing directory is created on first write.
pub fn token_path() -> PathBuf {
    let local = PathBuf::from(".tokens");
    if local.exists() {
        return local;
    }
    resolve_os_path(OsPathScope::Tokens)
}

/// Read and parse the token store. Missing file = empty store; this
/// matches every callsite that wants "no auth yet" handled gracefully.
/// IO failures (e.g. permission denied on a present file) bubble up.
pub fn read_store() -> Result<TokenStore, io::Error> {
    let path = token_path();
    if !path.exists() {
        return Ok(TokenStore {
            production: None,
            staging: None,
            local: None,
        });
    }
    let content = fs::read_to_string(&path)?;
    Ok(parse_token_store(&content))
}

/// Persist the store back to disk. Creates the parent directory if
/// needed. Sets file mode `0o600` on Unix so the API key isn't
/// world-readable.
pub fn write_store(store: &TokenStore) -> Result<(), io::Error> {
    let path = token_path();
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }
    let content = serialize_token_store(store);
    fs::write(&path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Look up the X-API-Key for the requested env. Mirrors the CLI:
/// `OPENBOX_BACKEND_API_KEY` env-var wins so CI can inject a key
/// without touching disk; otherwise the on-disk store is consulted.
pub fn load_api_key(env: EnvName) -> Option<String> {
    if let Ok(v) = std::env::var("OPENBOX_BACKEND_API_KEY") {
        if !v.is_empty() {
            return Some(v);
        }
    }
    let store = read_store().ok()?;
    entry_for(&store, env).and_then(|e| e.api_key.clone())
}

/// Look up the cached permissions list for the requested env.
pub fn load_permissions(env: EnvName) -> Vec<String> {
    let Ok(store) = read_store() else {
        return Vec::new();
    };
    entry_for(&store, env)
        .and_then(|e| e.permissions.clone())
        .unwrap_or_default()
}

/// Look up the cached feature flags for the requested env.
pub fn load_features(env: EnvName) -> HashMap<String, bool> {
    let Ok(store) = read_store() else {
        return HashMap::new();
    };
    entry_for(&store, env)
        .and_then(|e| e.features.clone())
        .unwrap_or_default()
}

/// Persist a freshly-minted X-API-Key to the on-disk store.
pub fn save_api_key(env: EnvName, api_key: &str) -> Result<(), io::Error> {
    mutate_entry(env, |entry| {
        entry.api_key = Some(api_key.to_string());
        entry.updated_at = Some(now_iso());
    })
}

/// Persist the permissions claim list for the requested env. No-op
/// when the env has no `apiKey` recorded; mirrors the TS CLI's guard
/// (we only cache permissions for already-authed envs).
pub fn save_permissions(env: EnvName, permissions: Vec<String>) -> Result<(), io::Error> {
    mutate_entry(env, |entry| {
        if entry.api_key.is_some() {
            entry.permissions = Some(permissions.clone());
        }
    })
}

/// Persist the feature-flags map for the requested env.
pub fn save_features(env: EnvName, features: HashMap<String, bool>) -> Result<(), io::Error> {
    mutate_entry(env, |entry| {
        if entry.api_key.is_some() {
            entry.features = Some(features.clone());
        }
    })
}

/// Wipe the recorded credentials for the requested env. Returns
/// `true` if an entry actually existed and was removed.
pub fn clear_api_key(env: EnvName) -> Result<bool, io::Error> {
    let mut store = read_store()?;
    let slot = slot_for(&mut store, env);
    let had = slot.as_ref().is_some_and(|e| e.api_key.is_some());
    *slot = None;
    write_store(&store)?;
    Ok(had)
}

fn mutate_entry<F: FnOnce(&mut TokenEntry)>(env: EnvName, f: F) -> Result<(), io::Error> {
    let mut store = read_store()?;
    let slot = slot_for(&mut store, env);
    let entry = slot.get_or_insert_with(|| TokenEntry {
        access_token: None,
        refresh_token: None,
        api_key: None,
        updated_at: None,
        permissions: None,
        features: None,
    });
    f(entry);
    write_store(&store)
}

fn slot_for(store: &mut TokenStore, env: EnvName) -> &mut Option<TokenEntry> {
    match env {
        EnvName::Production => &mut store.production,
        EnvName::Staging => &mut store.staging,
        EnvName::Local => &mut store.local,
    }
}

fn entry_for(store: &TokenStore, env: EnvName) -> Option<&TokenEntry> {
    match env {
        EnvName::Production => store.production.as_ref(),
        EnvName::Staging => store.staging.as_ref(),
        EnvName::Local => store.local.as_ref(),
    }
}

fn now_iso() -> String {
    // RFC 3339 UTC, hand-formatted to skip a chrono dep.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_unix_secs_utc(secs as i64)
}

fn format_unix_secs_utc(secs: i64) -> String {
    // Days since 1970-01-01.
    let day = secs.div_euclid(86_400);
    let sec_of_day = secs.rem_euclid(86_400);
    let h = sec_of_day / 3600;
    let m = (sec_of_day / 60) % 60;
    let s = sec_of_day % 60;
    let (y, mo, d) = civil_from_days(day);
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z",
        y = y,
        mo = mo,
        d = d,
        h = h,
        m = m,
        s = s
    )
}

/// Howard Hinnant's day-number-since-epoch → (y, m, d) algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_zero_is_1970_01_01() {
        assert_eq!(format_unix_secs_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn known_timestamp_matches() {
        // 2026-01-01T00:00:00Z → 1767225600
        assert_eq!(format_unix_secs_utc(1767225600), "2026-01-01T00:00:00Z");
    }
}
