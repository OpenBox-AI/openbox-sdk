//! Hand-written platform glue for the env package. The spec-emitted
//! bindings live in `generated/`; this module owns URL-first runtime
//! helpers, token codec glue, OS paths, and API-key validators.

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connection {
    pub api_url: String,
    pub core_url: String,
    pub platform_url: Option<String>,
    pub auth_url: Option<String>,
    pub stack_url: Option<String>,
}

pub fn resolve_connection() -> Result<Connection, String> {
    apply_env_source();
    let stack_url = env::var("OPENBOX_STACK_URL").ok().filter(|s| !s.is_empty());
    let stack = stack_url.as_deref().map(endpoints_from_stack_url).transpose()?;
    let api_url = env::var("OPENBOX_API_URL")
        .ok()
        .or_else(|| stack.as_ref().map(|s| s.api_url.clone()))
        .ok_or_else(|| "OPENBOX_API_URL is required. Set explicit OpenBox service URLs.".to_string())?;
    let core_url = env::var("OPENBOX_CORE_URL")
        .ok()
        .or_else(|| stack.as_ref().map(|s| s.core_url.clone()))
        .ok_or_else(|| "OPENBOX_CORE_URL is required. Set explicit OpenBox service URLs.".to_string())?;
    Ok(Connection {
        api_url: normalize_service_url("OPENBOX_API_URL", &api_url)?,
        core_url: normalize_service_url("OPENBOX_CORE_URL", &core_url)?,
        platform_url: env::var("OPENBOX_PLATFORM_URL")
            .ok()
            .or_else(|| stack.as_ref().and_then(|s| s.platform_url.clone())),
        auth_url: env::var("OPENBOX_AUTH_URL")
            .ok()
            .or_else(|| stack.as_ref().and_then(|s| s.auth_url.clone())),
        stack_url,
    })
}

fn endpoints_from_stack_url(raw: &str) -> Result<Connection, String> {
    let stack_url = normalize_stack_url(raw)?;
    let url = url::Url::parse(&stack_url).map_err(|e| e.to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "OpenBox stack URL is missing a host".to_string())?;
    let root_host = host
        .strip_prefix("api.")
        .or_else(|| host.strip_prefix("core."))
        .or_else(|| host.strip_prefix("auth."))
        .unwrap_or(host);
    let origin = format!("{}://", url.scheme());
    Ok(Connection {
        api_url: format!("{origin}api.{root_host}/ob"),
        core_url: format!("{origin}core.{root_host}/ob"),
        auth_url: Some(format!("{origin}auth.{root_host}/ob")),
        platform_url: Some(stack_url.clone()),
        stack_url: Some(stack_url),
    })
}

fn normalize_stack_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("OpenBox stack URL cannot be empty.".to_string());
    }
    let with_protocol = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    normalize_service_url("OPENBOX_STACK_URL", &with_protocol)
}

fn normalize_service_url(name: &str, raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw.trim()).map_err(|e| format!("{name} is not a valid URL: {e}"))?;
    if url.scheme() != "https" && !is_loopback(url.host_str().unwrap_or_default()) {
        return Err(format!("{name} must use https:// unless it points at localhost."));
    }
    let mut normalized = url;
    normalized.set_query(None);
    normalized.set_fragment(None);
    let path = normalized.path().trim_end_matches('/').to_string();
    normalized.set_path(&path);
    Ok(normalized.to_string().trim_end_matches('/').to_string())
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

pub fn apply_env_source() {
    for (key, value) in read_config_pairs() {
        if key.contains('.') || !key.starts_with("OPENBOX_") {
            continue;
        }
        if env::var(&key).is_err() {
            unsafe { env::set_var(key, value) };
        }
    }
}

fn read_config_pairs() -> Vec<(String, String)> {
    let path = openbox_data_root().join("config");
    let text = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    text.lines()
        .filter_map(|raw| {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

pub fn is_debug_mode() -> bool {
    fn truthy(s: &str) -> bool {
        matches!(s.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")
    }
    if let Ok(v) = env::var("OPENBOX_DEBUG") {
        if truthy(v.trim()) {
            return true;
        }
    }
    read_config_pairs()
        .into_iter()
        .any(|(key, value)| key == "OPENBOX_DEBUG" && truthy(value.trim()))
}
