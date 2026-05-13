//! Persistent user settings for the approver tray. The shape is
//! intentionally tiny: env selection (production / staging / local),
//! a notifications toggle, and a poll-interval bucket. Lives in a
//! single JSON file alongside the CLI's `tokens` store so all
//! per-user state ends up under one directory.
//!
//! Defaults match the v1 hardcoded behavior so an existing install
//! that has never opened the Settings window keeps the same UX it
//! always had.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;

use openbox_sdk::env::openbox_data_root;

const SETTINGS_FILE: &str = "approver-settings.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvChoice {
    Production,
    Staging,
    Local,
}

impl EnvChoice {
    pub fn as_str(&self) -> &'static str {
        match self {
            EnvChoice::Production => "production",
            EnvChoice::Staging => "staging",
            EnvChoice::Local => "local",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "production" => Some(EnvChoice::Production),
            "staging" => Some(EnvChoice::Staging),
            "local" => Some(EnvChoice::Local),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    /// Deprecated. Kept in the struct for backward-compat with
    /// existing approver-settings.json files; reads ignore it and
    /// writes never persist it. The active env now lives in
    /// `~/.openbox/config` as `OPENBOX_ENV=...`, the single source of
    /// truth every OpenBox surface (CLI, MCP, cursor hook, claude-
    /// code hook, approver) reads through `apply_env_source()`.
    #[serde(default, skip_serializing)]
    pub env: Option<EnvChoice>,
    pub notifications_enabled: bool,
    pub poll_interval_secs: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            env: None,
            notifications_enabled: true,
            poll_interval_secs: 5,
        }
    }
}

impl Settings {
    /// Coerce the poll interval to the three buckets the UI exposes
    /// (5s, 15s, 60s). Anything else snaps to the closest bucket.
    /// Done on read so a hand-edited JSON file with a junk value
    /// can't make the polling thread spin at sub-second cadence.
    pub fn normalized_poll_secs(&self) -> u64 {
        match self.poll_interval_secs {
            0..=9 => 5,
            10..=29 => 15,
            _ => 60,
        }
    }
}

/// Path to the settings file under the openbox data root.
pub fn settings_path() -> PathBuf {
    openbox_data_root().join(SETTINGS_FILE)
}

/// Load settings; on any I/O or parse error, return defaults. The
/// approver should never refuse to start because the JSON file is
/// damaged; defaults are a reasonable fallback and the user can fix
/// the file via the Settings window's writes.
pub fn load() -> Settings {
    let path = settings_path();
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Settings::default(),
    };
    match serde_json::from_slice::<Settings>(&bytes) {
        Ok(s) => s,
        Err(_) => Settings::default(),
    }
}

/// Persist settings atomically with 0o600 mode. The parent dir is
/// created if missing (mirrors how the SDK's token-store writer
/// handles a fresh install).
pub fn save(s: &Settings) -> io::Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(s)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&path, json)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;

    // The tests mutate process-wide env vars (OPENBOX_HOME) to redirect
    // the settings path into a temp dir. Cargo runs unit tests in a
    // shared process, so a mutex serializes them.
    static GUARD: Mutex<()> = Mutex::new(());

    fn with_temp_home<F: FnOnce(&PathBuf)>(f: F) {
        let _g = GUARD.lock().unwrap();
        let dir = env::temp_dir().join(format!(
            "approver-settings-test-{}-{}",
            std::process::id(),
            rand_suffix(),
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let prev = env::var("OPENBOX_HOME").ok();
        env::set_var("OPENBOX_HOME", &dir);
        f(&dir);
        match prev {
            Some(v) => env::set_var("OPENBOX_HOME", v),
            None => env::remove_var("OPENBOX_HOME"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    fn rand_suffix() -> String {
        // Cheap unique suffix without pulling in a random-number crate.
        // Instant nanos are monotonic and good enough to disambiguate
        // parallel test invocations within one process.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        format!("{nanos}")
    }

    #[test]
    fn defaults_when_missing() {
        with_temp_home(|_| {
            let s = load();
            assert_eq!(s, Settings::default());
            assert_eq!(s.env, EnvChoice::Production);
            assert!(s.notifications_enabled);
            assert_eq!(s.poll_interval_secs, 5);
        });
    }

    #[test]
    fn defaults_on_malformed_json() {
        with_temp_home(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(SETTINGS_FILE), b"{ this is not json").unwrap();
            assert_eq!(load(), Settings::default());
        });
    }

    #[test]
    fn round_trip_default() {
        with_temp_home(|_| {
            let s = Settings::default();
            save(&s).unwrap();
            let s2 = load();
            assert_eq!(s, s2);
        });
    }

    #[test]
    fn round_trip_custom() {
        with_temp_home(|_| {
            let s = Settings {
                env: EnvChoice::Staging,
                notifications_enabled: false,
                poll_interval_secs: 60,
            };
            save(&s).unwrap();
            let s2 = load();
            assert_eq!(s, s2);
        });
    }

    #[test]
    fn round_trip_local_15() {
        with_temp_home(|_| {
            let s = Settings {
                env: EnvChoice::Local,
                notifications_enabled: true,
                poll_interval_secs: 15,
            };
            save(&s).unwrap();
            let s2 = load();
            assert_eq!(s, s2);
        });
    }

    #[cfg(unix)]
    #[test]
    fn file_mode_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        with_temp_home(|_| {
            let s = Settings::default();
            save(&s).unwrap();
            let meta = fs::metadata(settings_path()).unwrap();
            let mode = meta.permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "expected 0o600, got {:o}", mode);
        });
    }

    #[test]
    fn poll_interval_normalization() {
        let s5 = Settings { env: EnvChoice::Production, notifications_enabled: true, poll_interval_secs: 5 };
        let s15 = Settings { env: EnvChoice::Production, notifications_enabled: true, poll_interval_secs: 15 };
        let s60 = Settings { env: EnvChoice::Production, notifications_enabled: true, poll_interval_secs: 60 };
        let junk = Settings { env: EnvChoice::Production, notifications_enabled: true, poll_interval_secs: 7 };
        let big = Settings { env: EnvChoice::Production, notifications_enabled: true, poll_interval_secs: 999 };
        assert_eq!(s5.normalized_poll_secs(), 5);
        assert_eq!(s15.normalized_poll_secs(), 15);
        assert_eq!(s60.normalized_poll_secs(), 60);
        assert_eq!(junk.normalized_poll_secs(), 5);
        assert_eq!(big.normalized_poll_secs(), 60);
    }

    #[test]
    fn env_choice_string_roundtrip() {
        for v in [EnvChoice::Production, EnvChoice::Staging, EnvChoice::Local] {
            assert_eq!(EnvChoice::from_str(v.as_str()), Some(v.clone()));
        }
        assert!(EnvChoice::from_str("nope").is_none());
    }
}
