use std::collections::HashMap;

use super::generated::TokenStore;

pub fn parse_token_store(content: &str) -> TokenStore {
    let mut store = TokenStore {
        access_token: None,
        refresh_token: None,
        api_key: None,
        updated_at: None,
        permissions: None,
        features: None,
    };
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.contains('.') {
            continue;
        }
        apply_field(&mut store, key.trim(), value.trim());
    }
    store
}

pub fn serialize_token_store(store: &TokenStore) -> String {
    let mut out = String::new();
    if let Some(access_token) = &store.access_token {
        out.push_str(&format!("ACCESS_TOKEN={access_token}\n"));
        out.push_str(&format!(
            "REFRESH_TOKEN={}\n",
            store.refresh_token.as_deref().unwrap_or("")
        ));
    }
    if let Some(api_key) = &store.api_key {
        out.push_str(&format!("API_KEY={api_key}\n"));
    }
    if store.access_token.is_some() || store.api_key.is_some() {
        out.push_str(&format!(
            "UPDATED_AT={}\n",
            store.updated_at.as_deref().unwrap_or("")
        ));
    }
    if let Some(permissions) = &store.permissions {
        if !permissions.is_empty() {
            out.push_str(&format!("PERMISSIONS={}\n", permissions.join(",")));
        }
    }
    if let Some(features) = &store.features {
        if !features.is_empty() {
            out.push_str(&format!("FEATURES={}\n", serialize_features(features)));
        }
    }
    out
}

fn apply_field(entry: &mut TokenStore, field: &str, value: &str) {
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
                let Some((key, value)) = pair.split_once(':') else {
                    continue;
                };
                let key = key.trim();
                if !key.is_empty() {
                    map.insert(key.to_string(), value.trim() == "true");
                }
            }
            entry.features = Some(map);
        }
        _ => {}
    }
}

fn serialize_features(map: &HashMap<String, bool>) -> String {
    let mut pairs: Vec<_> = map.iter().collect();
    pairs.sort_by(|(a, _), (b, _)| a.cmp(b));
    pairs
        .into_iter()
        .map(|(key, value)| format!("{key}:{value}"))
        .collect::<Vec<_>>()
        .join(",")
}
