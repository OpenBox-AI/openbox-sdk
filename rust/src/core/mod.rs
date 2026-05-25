//! reqwest layer for the core governance API. Mirrors `crate::client`
//! against an explicit core URL. Transport is shared via
//! `crate::transport`.

pub mod generated;

pub use crate::error::ApiError;
pub use generated::*;

use serde::{de::DeserializeOwned, Serialize};

use crate::transport::{Auth, Transport};

pub const DEFAULT_CLIENT_NAME: &str = "openbox-sdk-rust";

pub struct OpenBoxCoreClient {
    transport: Transport,
}

impl OpenBoxCoreClient {
    pub fn new(base_url: impl Into<String>, access_token: impl Into<String>) -> Self {
        Self::builder()
            .base_url(base_url)
            .access_token(access_token)
            .build()
    }

    pub fn builder() -> OpenBoxCoreClientBuilder {
        OpenBoxCoreClientBuilder::default()
    }

    pub fn api_base(&self) -> &str {
        &self.transport.base_url
    }

    pub fn current_access_token(&self) -> Option<String> {
        self.transport.current_access_token()
    }

    pub fn set_access_token(&self, token: impl Into<String>) {
        *self.transport.auth.lock().unwrap() = Auth::Bearer(token.into());
    }

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
pub struct OpenBoxCoreClientBuilder {
    base_url: Option<String>,
    access_token: Option<String>,
    api_key: Option<String>,
    client_name: Option<String>,
    http: Option<reqwest::Client>,
}

impl OpenBoxCoreClientBuilder {
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

    pub fn client_name(mut self, name: impl Into<String>) -> Self {
        self.client_name = Some(name.into());
        self
    }

    pub fn http_client(mut self, http: reqwest::Client) -> Self {
        self.http = Some(http);
        self
    }

    pub fn build(self) -> OpenBoxCoreClient {
        let auth = match (self.access_token, self.api_key) {
            (Some(t), _) => Auth::Bearer(t),
            (None, Some(k)) => Auth::ApiKey(k),
            (None, None) => panic!(
                "OpenBoxCoreClientBuilder: set either .access_token() or .api_key() before .build()"
            ),
        };
        let base_url = self
            .base_url
            .expect("OpenBoxCoreClientBuilder: .base_url() is required before .build()");
        OpenBoxCoreClient {
            transport: Transport {
                http: self.http.unwrap_or_else(reqwest::Client::new),
                base_url,
                client_name: self.client_name.unwrap_or_else(|| DEFAULT_CLIENT_NAME.to_string()),
                auth: std::sync::Mutex::new(auth),
            },
        }
    }
}
