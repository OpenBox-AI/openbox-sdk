//! Hand-written codec for the on-disk token store. Mirror of
//! `ts/src/env/token-codec.ts`. The wire format is a flat KV file:
//!
//! ```text
//! production.ACCESS_TOKEN=...
//! production.REFRESH_TOKEN=...
//! production.API_KEY=obx_key_...
//! production.UPDATED_AT=2025-12-31T23:59:59Z
//! production.PERMISSIONS=Admin,create:agent,...
//! production.FEATURES=webhooks:true,sso:false
//! staging.ACCESS_TOKEN=...
//! ```
//!
//! Legacy un-prefixed entries (`ACCESS_TOKEN=...`) are parsed as
//! production for back-compat with pre-multi-env CLI installs; on the
//! next save the file is rewritten in the namespaced shape.
//!
//! The Rust side reads / writes the SAME file the TS CLI does so the
//! approver and the VS Code extension can both ride on `openbox auth
//! login` without each owning a token-capture flow.

use std::collections::HashMap;

use super::generated::{TokenEntry, TokenStore};

/// `TokenEntry` is spec-emitted with no derives beyond serde, so a
/// hand-written zero value lives here. Used by [`parse_token_store`]
/// when it first encounters a new env-namespace.
fn empty_entry() -> TokenEntry {
    TokenEntry {
        access_token: None,
        refresh_token: None,
        api_key: None,
        updated_at: None,
        permissions: None,
        features: None,
    }
}

/// Parse the file content into a [`TokenStore`]. Unknown env names and
/// malformed lines are silently dropped: same forgiving behavior as
/// the TS implementation.
pub fn parse_token_store(content: &str) -> TokenStore {
    let mut store = TokenStore {
        production: None,
        staging: None,
        local: None,
    };
    let mut legacy = empty_entry();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        let dot = key.find('.');

        match dot {
            None => apply_field(&mut legacy, key, value),
            Some(idx) => {
                let env_name = &key[..idx];
                let field = &key[idx + 1..];
                let entry = match env_name {
                    "production" => store.production.get_or_insert_with(empty_entry),
                    "staging" => store.staging.get_or_insert_with(empty_entry),
                    "local" => store.local.get_or_insert_with(empty_entry),
                    _ => continue,
                };
                apply_field(entry, field, value);
            }
        }
    }

    // Legacy entries belong to production by convention. Namespaced
    // entries always win; legacy is a fallback, not an override.
    if legacy.access_token.is_some() && store.production.is_none() {
        store.production = Some(legacy);
    }
    store
}

/// Serialize the store back to the wire format. The output ends with a
/// trailing newline so editors don't yelp about missing-final-newline.
pub fn serialize_token_store(store: &TokenStore) -> String {
    let mut out = String::new();
    for (name, entry) in [
        ("production", store.production.as_ref()),
        ("staging", store.staging.as_ref()),
        ("local", store.local.as_ref()),
    ] {
        let Some(entry) = entry else { continue };
        // Either credential is enough to keep the entry; api-key alone
        // is a valid auth state (the X-API-Key flow has no JWT).
        if entry.access_token.is_none() && entry.api_key.is_none() {
            continue;
        }
        if let Some(at) = &entry.access_token {
            out.push_str(&format!("{}.ACCESS_TOKEN={}\n", name, at));
            out.push_str(&format!(
                "{}.REFRESH_TOKEN={}\n",
                name,
                entry.refresh_token.as_deref().unwrap_or("")
            ));
        }
        if let Some(key) = &entry.api_key {
            out.push_str(&format!("{}.API_KEY={}\n", name, key));
        }
        out.push_str(&format!(
            "{}.UPDATED_AT={}\n",
            name,
            entry.updated_at.as_deref().unwrap_or("")
        ));
        if let Some(perms) = &entry.permissions {
            if !perms.is_empty() {
                out.push_str(&format!("{}.PERMISSIONS={}\n", name, perms.join(",")));
            }
        }
        if let Some(features) = &entry.features {
            if !features.is_empty() {
                out.push_str(&format!(
                    "{}.FEATURES={}\n",
                    name,
                    serialize_features(features)
                ));
            }
        }
    }
    out
}

fn apply_field(entry: &mut TokenEntry, field: &str, value: &str) {
    match field {
        "ACCESS_TOKEN" => entry.access_token = Some(value.to_string()),
        "REFRESH_TOKEN" => {
            entry.refresh_token = if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            };
        }
        "API_KEY" => {
            entry.api_key = if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            };
        }
        "UPDATED_AT" => entry.updated_at = Some(value.to_string()),
        "PERMISSIONS" => {
            entry.permissions = Some(
                value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            );
        }
        "FEATURES" => {
            let mut map = HashMap::new();
            for pair in value.split(',') {
                let Some((k, v)) = pair.split_once(':') else {
                    continue;
                };
                let k = k.trim();
                if !k.is_empty() {
                    map.insert(k.to_string(), v.trim() == "true");
                }
            }
            entry.features = Some(map);
        }
        _ => {}
    }
}

fn serialize_features(map: &HashMap<String, bool>) -> String {
    // Alphabetical so the on-disk format is byte-stable across writes
    // (HashMap iteration order isn't).
    let mut pairs: Vec<(&String, &bool)> = map.iter().collect();
    pairs.sort_by_key(|(k, _)| k.as_str());
    pairs
        .into_iter()
        .map(|(k, v)| format!("{}:{}", k, v))
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_api_key_only_entry() {
        let input = "production.API_KEY=obx_key_abc\nproduction.UPDATED_AT=2026-01-01T00:00:00Z\n";
        let store = parse_token_store(input);
        let entry = store.production.as_ref().expect("entry");
        assert_eq!(entry.api_key.as_deref(), Some("obx_key_abc"));
        assert_eq!(entry.access_token, None);
        let out = serialize_token_store(&store);
        assert!(out.contains("production.API_KEY=obx_key_abc"));
    }

    #[test]
    fn legacy_entry_lands_on_production() {
        let store = parse_token_store("ACCESS_TOKEN=jwt-here\n");
        assert_eq!(
            store.production.unwrap().access_token.as_deref(),
            Some("jwt-here")
        );
    }

    #[test]
    fn namespaced_wins_over_legacy() {
        let store = parse_token_store(
            "ACCESS_TOKEN=legacy\nproduction.ACCESS_TOKEN=namespaced\n",
        );
        assert_eq!(
            store.production.unwrap().access_token.as_deref(),
            Some("namespaced")
        );
    }
}
