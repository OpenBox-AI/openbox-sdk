//! Private HTTP transport shared by `OpenBoxClient` and
//! `OpenBoxCoreClient`. Public clients delegate per-verb to here.

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::error::ApiError;

/// `Mutex`'d so the public clients can rotate auth in place.
#[derive(Debug, Clone)]
pub(crate) enum Auth {
    Bearer(String),
    ApiKey(String),
}

pub(crate) struct Transport {
    pub http: reqwest::Client,
    pub base_url: String,
    pub client_name: String,
    pub auth: std::sync::Mutex<Auth>,
}

impl Transport {
    /// Snapshot of the bearer token, or `None` for API-key auth.
    pub fn current_access_token(&self) -> Option<String> {
        match &*self.auth.lock().unwrap() {
            Auth::Bearer(t) => Some(t.clone()),
            Auth::ApiKey(_) => None,
        }
    }

    pub async fn request<R, B, Q>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&B>,
        query: Option<&Q>,
    ) -> Result<R, ApiError>
    where
        R: DeserializeOwned,
        B: Serialize + ?Sized,
        Q: Serialize + ?Sized,
    {
        // Normalize path joins. Both `base_url` and `path` are user-
        // supplied; trim a single trailing/leading slash so that the
        // common `(api.openbox.ai, /agent/list)` case lands at
        // `https://api.openbox.ai/agent/list`.
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );

        let mut req = self.http.request(method, &url);
        // X-Openbox-Client is a presence-check the backend auth guard
        // requires; without it every call 401s.
        req = req.header("X-Openbox-Client", &self.client_name);

        match &*self.auth.lock().unwrap() {
            Auth::Bearer(t) => {
                req = req.header("Authorization", format!("Bearer {}", t));
            }
            Auth::ApiKey(k) => {
                req = req.header("X-API-Key", k);
            }
        }

        if let Some(q) = query {
            req = req.query(q);
        }
        if let Some(b) = body {
            req = req.json(b);
        }

        let resp = req.send().await?;
        let status = resp.status();
        let bytes = resp.bytes().await?;

        if !status.is_success() {
            let body = String::from_utf8_lossy(&bytes).to_string();
            return Err(ApiError::Status {
                status: status.as_u16(),
                body,
            });
        }

        // 204 / empty 2xx → null.
        if bytes.is_empty() {
            return serde_json::from_slice::<R>(b"null").map_err(Into::into);
        }

        // Try the `{ "data": T }` envelope first, fall back to raw.
        match serde_json::from_slice::<Envelope<R>>(&bytes) {
            Ok(env) => Ok(env.data),
            Err(_) => serde_json::from_slice::<R>(&bytes).map_err(Into::into),
        }
    }
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    data: T,
}
