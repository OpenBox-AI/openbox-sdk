//! Shared error type for `client` and `core`.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    /// reqwest transport failure (TLS, DNS, connection reset).
    #[error("transport: {0}")]
    Transport(#[from] reqwest::Error),

    /// Non-2xx status; body captured verbatim.
    #[error("status {status}: {body}")]
    Status { status: u16, body: String },

    /// 2xx body didn't match the declared response type.
    #[error("decode: {0}")]
    Decode(String),

    /// Auth state unusable.
    #[error("auth: {0}")]
    Auth(String),

    /// Pre-flight failure (bad URL, query serialization, etc).
    #[error("config: {0}")]
    Config(String),
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError::Decode(e.to_string())
    }
}
