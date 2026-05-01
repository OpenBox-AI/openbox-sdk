//! API-key format validation. Patterns are sourced from the
//! `@token_format` decorators on `Credentials.apiKey` /
//! `TokenEntry.apiKey` in `specs/typespec/env/main.tsp`.

/// Agent-runtime key shape emitted by `agent create` /
/// `api-key rotate <agentId>`. Used by the core governance API
/// (`OPENBOX_API_KEY`).
pub const API_KEY_PATTERN: &str = "^obx_(?:live|test)_[0-9a-f]{48}$";

/// Org-level X-API-Key shape (the management-API auth path). Distinct
/// from the agent-runtime key; `OPENBOX_BACKEND_API_KEY` and the
/// `<env>.API_KEY=` line in the on-disk token store both carry this
/// shape.
pub const ORG_API_KEY_PATTERN: &str = "^obx_key_[0-9a-f]{48}$";

/// Returns `Ok(())` if the key matches `obx_(live|test)_<48hex>`. Used
/// to gate `OPENBOX_API_KEY` against the most common misuse: pasting
/// the `token` field from `agent list` (which is an internal
/// attestation token, not the runtime key).
pub fn validate_api_key_format(value: &str) -> Result<(), &'static str> {
    if matches_obx_runtime_key(value) {
        Ok(())
    } else {
        Err("OPENBOX_API_KEY must match obx_(live|test)_<48hex>")
    }
}

/// Returns `true` iff `value` matches the agent-runtime key shape. The
/// regex is implemented by hand (length + prefix + hex check) so the
/// SDK doesn't pull a `regex` dependency for a single fixed pattern.
pub fn matches_obx_runtime_key(value: &str) -> bool {
    let body = match value
        .strip_prefix("obx_live_")
        .or_else(|| value.strip_prefix("obx_test_"))
    {
        Some(b) => b,
        None => return false,
    };
    is_lower_hex_n(body, 48)
}

/// Returns `true` iff `value` matches the org X-API-Key shape.
pub fn matches_obx_org_key(value: &str) -> bool {
    let body = match value.strip_prefix("obx_key_") {
        Some(b) => b,
        None => return false,
    };
    is_lower_hex_n(body, 48)
}

fn is_lower_hex_n(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_live_runtime_key() {
        let key = format!("obx_live_{}", "a".repeat(48));
        assert!(validate_api_key_format(&key).is_ok());
    }

    #[test]
    fn rejects_uppercase_hex() {
        let key = format!("obx_live_{}", "A".repeat(48));
        assert!(validate_api_key_format(&key).is_err());
    }

    #[test]
    fn rejects_org_key_when_runtime_expected() {
        let key = format!("obx_key_{}", "0".repeat(48));
        assert!(validate_api_key_format(&key).is_err());
        assert!(matches_obx_org_key(&key));
    }
}
