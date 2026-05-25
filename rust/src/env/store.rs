use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::PathBuf;

use super::generated::{OsPathScope, TokenStore};
use super::os_paths::resolve_os_path;
use super::token_codec::{parse_token_store, serialize_token_store};

pub fn token_path() -> PathBuf {
    let local = PathBuf::from(".tokens");
    if local.exists() {
        return local;
    }
    resolve_os_path(OsPathScope::Tokens)
}

pub fn read_store() -> Result<TokenStore, io::Error> {
    let path = token_path();
    if !path.exists() {
        return Ok(TokenStore {
            access_token: None,
            refresh_token: None,
            api_key: None,
            updated_at: None,
            permissions: None,
            features: None,
        });
    }
    let content = fs::read_to_string(&path)?;
    Ok(parse_token_store(&content))
}

pub fn write_store(store: &TokenStore) -> Result<(), io::Error> {
    let path = token_path();
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(&path, serialize_token_store(store))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn load_api_key() -> Option<String> {
    if let Ok(v) = std::env::var("OPENBOX_BACKEND_API_KEY") {
        if !v.is_empty() {
            return Some(v);
        }
    }
    read_store().ok()?.api_key
}

pub fn load_permissions() -> Vec<String> {
    read_store()
        .ok()
        .and_then(|store| store.permissions)
        .unwrap_or_default()
}

pub fn load_features() -> HashMap<String, bool> {
    read_store()
        .ok()
        .and_then(|store| store.features)
        .unwrap_or_default()
}

pub fn save_api_key(api_key: &str) -> Result<(), io::Error> {
    let mut store = read_store()?;
    store.api_key = Some(api_key.to_string());
    store.updated_at = Some(now_iso());
    write_store(&store)
}

pub fn save_permissions(permissions: Vec<String>) -> Result<(), io::Error> {
    let mut store = read_store()?;
    if store.api_key.is_some() {
        store.permissions = Some(permissions);
    }
    write_store(&store)
}

pub fn save_features(features: HashMap<String, bool>) -> Result<(), io::Error> {
    let mut store = read_store()?;
    if store.api_key.is_some() {
        store.features = Some(features);
    }
    write_store(&store)
}

pub fn clear_api_key() -> Result<bool, io::Error> {
    let mut store = read_store()?;
    let had = store.api_key.is_some();
    store.api_key = None;
    write_store(&store)?;
    Ok(had)
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_unix_secs_utc(secs as i64)
}

fn format_unix_secs_utc(secs: i64) -> String {
    let day = secs.div_euclid(86_400);
    let sec_of_day = secs.rem_euclid(86_400);
    let h = sec_of_day / 3600;
    let m = (sec_of_day / 60) % 60;
    let s = sec_of_day % 60;
    let (y, mo, d) = civil_from_days(day);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

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
