//! Mirror of `resolveClientName()` in `ts/src/env/client-name.ts`.
//! Reads `OPENBOX_CLIENT_VARIANT` and appends `/<variant>` to the base
//! client name when the variant matches `CLIENT_VARIANT_PATTERN`. Bad
//! variants are silently dropped: a typo never poisons the
//! X-Openbox-Client header (which gates auth on the backend).

use std::env;

/// Allowed character set for the variant suffix. Letters, digits, `.`,
/// `_`, `+`, `-`. Conservative intersection of HTTP-header-safe and
/// shell-safe characters, mirrored across every language SDK so the
/// emitted header is byte-identical from CLI / extension / approver /
/// mobile.
pub const CLIENT_VARIANT_PATTERN: &str = "^[A-Za-z0-9._+-]+$";

/// Build the `X-Openbox-Client` header value for a given base name.
/// When `OPENBOX_CLIENT_VARIANT` is set and matches the pattern, the
/// returned string is `"<base>/<variant>"`; otherwise just `"<base>"`.
pub fn resolve_client_name(base: &str) -> String {
    match env::var("OPENBOX_CLIENT_VARIANT") {
        Ok(v) if matches_variant(&v) => format!("{}/{}", base, v),
        _ => base.to_string(),
    }
}

fn matches_variant(s: &str) -> bool {
    !s.is_empty()
        && s.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variant_pattern_accepts_canonical() {
        assert!(matches_variant("claude-code"));
        assert!(matches_variant("v1.2.3"));
        assert!(matches_variant("foo_bar"));
        assert!(matches_variant("a+b"));
    }

    #[test]
    fn variant_pattern_rejects_whitespace_and_punct() {
        assert!(!matches_variant(""));
        assert!(!matches_variant("has spaces"));
        assert!(!matches_variant("colon:bad"));
        assert!(!matches_variant("slash/bad"));
    }
}
