//! Tauri-side adapter around `openbox_sdk::OpenBoxClient`. The
//! approver runs on macOS only and is a CLI-companion app: it reads
//! the `<env>.API_KEY=obx_key_<48hex>` line from the same
//! `~/.openbox/tokens` file the `openbox` CLI manages, builds the
//! SDK client, and ferries every HTTP call through the spec-emitted
//! typed wrapper methods.
//!
//! Authentication: org-level X-API-Key only. Without a CLI-recorded
//! API key for the active env, `ApiClient::new()` returns an error
//! pointing at `openbox auth set-api-key`.
//!
//! Re-exports the SDK's `Approval`, `ApprovalAgent`, `ApprovalMetadata`
//! and `Agent` types under this module's namespace so the rest of the
//! app can keep referring to `api::Approval` while the wire shape
//! lives in the SDK.

use openbox_sdk::env::{load_api_key, resolve_env, EnvName};
use openbox_sdk::{ApiError, OpenBoxClient};
use tokio::runtime::Runtime;

pub use openbox_sdk::types::{Agent, Approval, UserProfile};

pub struct ApiClient {
    sdk: OpenBoxClient,
    rt: Runtime,
    #[allow(dead_code)]
    env: EnvName,
}

impl ApiClient {
    /// Build a client for an explicit env. Shares the path
    /// `ApiClient::new()` always took (token-store lookup, optional
    /// `OPENBOX_API_URL` override) but ignores `OPENBOX_ENV` so the
    /// Settings window can flip envs without re-launching the
    /// process. The env arg wins over the env var.
    pub fn for_env(env: EnvName) -> Result<Self, String> {
        Self::build(env)
    }

    /// Build the client against the env selected via `OPENBOX_ENV`
    /// (production by default). Reads the X-API-Key from the on-disk
    /// token store written by `openbox auth set-api-key`. Returns an
    /// actionable error if no key is recorded for that env.
    #[allow(dead_code)]
    pub fn new() -> Result<Self, String> {
        let env = resolve_env();
        Self::build(env)
    }

    /// Read back the env this client was built against. Useful when
    /// the Settings window's read-only "Active env" row needs to
    /// reflect what the live polling thread is actually hitting.
    #[allow(dead_code)]
    pub fn env(&self) -> EnvName {
        self.env
    }

    fn build(env: EnvName) -> Result<Self, String> {
        let api_key = load_api_key(env).ok_or_else(|| {
            let env_name = env.as_str();
            let flag = if env == EnvName::Production {
                String::new()
            } else {
                format!("--env {} ", env_name)
            };
            format!(
                "No X-API-Key for env '{}'. The approver reads the same \
                 token store the openbox CLI writes: install + log in via:\n  \
                 brew install openbox-cli\n  openbox {}auth set-api-key",
                env_name, flag
            )
        })?;

        // The SDK's static ENVIRONMENTS table ships with an empty
        // `staging.apiUrl` (the staging deployment lives on internal
        // infra and isn't bundled in the public spec). Mobile bridges
        // the same gap with EXPO_PUBLIC_OPENBOX_API_URL at build time;
        // the approver does the same at runtime via OPENBOX_API_URL.
        // When set, it wins over the env's static URL, letting one
        // signed bundle hit production OR an internal env without a
        // rebuild. Empty value falls back to the spec URL.
        let mut builder = OpenBoxClient::builder()
            .for_env(env)
            .api_key(api_key)
            .client_name("apps/approver");
        if let Ok(override_url) = std::env::var("OPENBOX_API_URL") {
            let trimmed = override_url.trim();
            if !trimmed.is_empty() {
                builder = builder.base_url(trimmed.to_string());
            }
        }
        let sdk = builder.build();

        // Single-threaded runtime: the polling thread is sync and we
        // only ever block_on a single SDK call at a time. Multi-thread
        // would spin extra worker threads we don't use.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("tokio runtime: {e}"))?;

        Ok(ApiClient { sdk, rt, env })
    }

    pub fn get_profile(&self) -> Result<UserProfile, String> {
        self.rt
            .block_on(self.sdk.get_profile())
            .map_err(format_err)
    }

    pub fn list_agents(&self) -> Result<Vec<Agent>, String> {
        // Single page is enough for the bootstrap path: we only need
        // an `organization_id` to fall back on when the profile's
        // `orgId` is absent. The SDK's typed method returns the full
        // `PaginatedResponse<Agent>` envelope; we collapse to the
        // `data` slice so callers don't need to care about the shape.
        let query = serde_json::json!({ "page": 0, "perPage": 1 });
        let resp = self
            .rt
            .block_on(self.sdk.list_agents(Some(&query)))
            .map_err(format_err)?;
        Ok(resp.data)
    }

    pub fn get_org_approvals(&self, org_id: &str) -> Result<Vec<Approval>, String> {
        let query = serde_json::json!({
            "status": "pending",
            "page": 0,
            "perPage": 50,
        });
        let resp = self
            .rt
            .block_on(self.sdk.get_org_approvals(org_id, Some(&query)))
            .map_err(format_err)?;
        Ok(resp.approvals.data)
    }

    /// List approvals for a decided status. The backend's
    /// `getOrgApprovals` op accepts `status` of pending / approved /
    /// rejected / expired (see specs/typespec/backend/main.tsp), so the
    /// approver doesn't need to fetch the universe and filter
    /// client-side; the status arg goes straight to the wire. Caller
    /// passes one of "approved", "rejected", "expired".
    pub fn list_decided(
        &self,
        org_id: &str,
        status: &str,
    ) -> Result<Vec<Approval>, String> {
        let query = serde_json::json!({
            "status": status,
            "page": 0,
            "perPage": 200,
        });
        let resp = self
            .rt
            .block_on(self.sdk.get_org_approvals(org_id, Some(&query)))
            .map_err(format_err)?;
        Ok(resp.approvals.data)
    }

    pub fn decide_approval(
        &self,
        agent_id: &str,
        approval_id: &str,
        action: &str,
    ) -> Result<(), String> {
        let query = serde_json::json!({ "action": action });
        self.rt
            .block_on(self.sdk.decide_approval(agent_id, approval_id, Some(&query)))
            .map(|_| ())
            .map_err(format_err)
    }
}

/// Map `ApiError` into the human-readable string surface the rest of
/// the app uses. Status 401/403 get a CLI hint so a fresh user
/// understands what to do.
fn format_err(err: ApiError) -> String {
    match &err {
        ApiError::Status { status: 401, .. } | ApiError::Status { status: 403, .. } => {
            format!(
                "{err}\nThe approver uses the same X-API-Key the CLI does. \
                 Refresh it with `openbox auth set-api-key`."
            )
        }
        _ => err.to_string(),
    }
}
