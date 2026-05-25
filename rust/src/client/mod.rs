//! reqwest layer for the management API. `generated/wrapper_methods.rs`
//! adds one async fn per HTTP operation on top of the `request_<verb>`
//! helpers defined here. Construction goes through
//! [`OpenBoxClient::new`] / [`OpenBoxClient::builder`].

pub mod generated;

pub use crate::error::ApiError;
pub use generated::*;

use serde::{de::DeserializeOwned, Serialize};

use crate::transport::{Auth, Transport};

/// Default `X-Openbox-Client` header. Consumers override via
/// `client_name(...)` so request logs distinguish callers.
pub const DEFAULT_CLIENT_NAME: &str = "openbox-sdk-rust";

pub struct OpenBoxClient {
    transport: Transport,
}

impl OpenBoxClient {
    /// Build a client from an explicit base URL and access token. The
    /// most common case; see [`OpenBoxClient::builder`] for the
    /// refresh-token / API-key / custom-client-name path.
    pub fn new(base_url: impl Into<String>, access_token: impl Into<String>) -> Self {
        Self::builder()
            .base_url(base_url)
            .access_token(access_token)
            .build()
    }

    pub fn builder() -> OpenBoxClientBuilder {
        OpenBoxClientBuilder::default()
    }

    /// The base URL the client sends requests to. Approvers and other
    /// realtime consumers need it to build the Socket.IO URL outside
    /// the HTTP path.
    pub fn api_base(&self) -> &str {
        &self.transport.base_url
    }

    /// Snapshot of the bearer access token. Returns `None` when the
    /// client is configured for API-key auth. Callers that need the
    /// token for a separate transport (WS / Socket.IO) read it once at
    /// connect time; the SDK does not keep them subscribed to changes.
    pub fn current_access_token(&self) -> Option<String> {
        self.transport.current_access_token()
    }

    /// Replace the bearer access token in place. Called by long-lived
    /// consumers (the approver polling loop, the realtime fan-out
    /// thread) after they refresh the JWT through their own auth path.
    /// Switches the client from API-key to bearer auth if needed.
    pub fn set_access_token(&self, token: impl Into<String>) {
        *self.transport.auth.lock().unwrap() = Auth::Bearer(token.into());
    }

    /// Replace the API key in place. Mirrors [`set_access_token`] for
    /// the org-key auth path; switches the client from bearer to
    /// API-key auth if needed.
    pub fn set_api_key(&self, key: impl Into<String>) {
        *self.transport.auth.lock().unwrap() = Auth::ApiKey(key.into());
    }

    pub async fn request_get<R, B, Q>(
        &self,
        path: &str,
        body: Option<&B>,
        query: Option<&Q>,
    ) -> Result<R, ApiError>
    where
        R: DeserializeOwned,
        B: Serialize + ?Sized,
        Q: Serialize + ?Sized,
    {
        self.transport.request(reqwest::Method::GET, path, body, query).await
    }

    pub async fn request_delete<R, B, Q>(
        &self,
        path: &str,
        body: Option<&B>,
        query: Option<&Q>,
    ) -> Result<R, ApiError>
    where
        R: DeserializeOwned,
        B: Serialize + ?Sized,
        Q: Serialize + ?Sized,
    {
        self.transport.request(reqwest::Method::DELETE, path, body, query).await
    }

    pub async fn request_post<R, B, Q>(
        &self,
        path: &str,
        body: Option<&B>,
        query: Option<&Q>,
    ) -> Result<R, ApiError>
    where
        R: DeserializeOwned,
        B: Serialize + ?Sized,
        Q: Serialize + ?Sized,
    {
        self.transport.request(reqwest::Method::POST, path, body, query).await
    }

    pub async fn request_patch<R, B, Q>(
        &self,
        path: &str,
        body: Option<&B>,
        query: Option<&Q>,
    ) -> Result<R, ApiError>
    where
        R: DeserializeOwned,
        B: Serialize + ?Sized,
        Q: Serialize + ?Sized,
    {
        self.transport.request(reqwest::Method::PATCH, path, body, query).await
    }

    pub async fn request_put<R, B, Q>(
        &self,
        path: &str,
        body: Option<&B>,
        query: Option<&Q>,
    ) -> Result<R, ApiError>
    where
        R: DeserializeOwned,
        B: Serialize + ?Sized,
        Q: Serialize + ?Sized,
    {
        self.transport.request(reqwest::Method::PUT, path, body, query).await
    }
}

#[derive(Default)]
pub struct OpenBoxClientBuilder {
    base_url: Option<String>,
    access_token: Option<String>,
    api_key: Option<String>,
    client_name: Option<String>,
    http: Option<reqwest::Client>,
}

impl OpenBoxClientBuilder {
    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = Some(base_url.into());
        self
    }

    pub fn access_token(mut self, token: impl Into<String>) -> Self {
        self.access_token = Some(token.into());
        self
    }

    pub fn api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    /// Override the `X-Openbox-Client` header. Defaults to
    /// [`DEFAULT_CLIENT_NAME`] when unset.
    pub fn client_name(mut self, name: impl Into<String>) -> Self {
        self.client_name = Some(name.into());
        self
    }

    pub fn http_client(mut self, http: reqwest::Client) -> Self {
        self.http = Some(http);
        self
    }

    /// Panics if neither `access_token` nor `api_key` was set, or if
    /// `base_url` is missing. Callers always go through one of the
    /// non-default constructors above so this is a programmer error,
    /// not a runtime one.
    pub fn build(self) -> OpenBoxClient {
        let auth = match (self.access_token, self.api_key) {
            (Some(t), _) => Auth::Bearer(t),
            (None, Some(k)) => Auth::ApiKey(k),
            (None, None) => panic!(
                "OpenBoxClientBuilder: set either .access_token() or .api_key() before .build()"
            ),
        };
        let base_url = self
            .base_url
            .expect("OpenBoxClientBuilder: .base_url() is required before .build()");
        OpenBoxClient {
            transport: Transport {
                http: self.http.unwrap_or_else(reqwest::Client::new),
                base_url,
                client_name: self.client_name.unwrap_or_else(|| DEFAULT_CLIENT_NAME.to_string()),
                auth: std::sync::Mutex::new(auth),
            },
        }
    }
}
