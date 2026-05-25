//! Tauri-side adapter around `openbox_sdk::OpenBoxClient`. The
//! approver runs on macOS only and is a CLI-companion app: it reads
//! the flat `API_KEY=obx_key_<48hex>` line from the same
//! `~/.openbox/tokens` file the `openbox` CLI manages, builds the
//! SDK client, and ferries every HTTP call through the spec-emitted
//! typed wrapper methods.
//!
//! Authentication: org-level X-API-Key only. Without a CLI-recorded
//! API key for the configured URL target, `ApiClient::new()` returns an error
//! pointing at `openbox auth set-api-key`.
//!
//! Re-exports the SDK's `Approval`, `ApprovalAgent`, `ApprovalMetadata`
//! and `Agent` types under this module's namespace so the rest of the
//! app can keep referring to `api::Approval` while the wire shape
//! lives in the SDK.

use openbox_sdk::env::{load_api_key, resolve_connection};
use openbox_sdk::{ApiError, OpenBoxClient};
use tokio::runtime::Runtime;

pub use openbox_sdk::types::{Agent, Approval, UserProfile};

pub struct ApiClient {
    sdk: OpenBoxClient,
    rt: Runtime,
}

impl ApiClient {
    pub fn for_configured_target() -> Result<Self, String> {
        Self::build()
    }

    /// Build the client against explicit configured service URLs.
    /// Reads the X-API-Key from the on-disk
    /// token store written by `openbox auth set-api-key`. Returns an
    /// actionable error if no key is recorded for that env.
    #[allow(dead_code)]
    pub fn new() -> Result<Self, String> {
        Self::build()
    }

    fn build() -> Result<Self, String> {
        let connection = resolve_connection()?;
        let api_key = load_api_key().ok_or_else(|| {
            format!(
                "No X-API-Key for the configured OpenBox target. The approver reads the same \
                 token store the openbox CLI writes: install + log in via:\n  \
                 brew install openbox-cli\n  openbox auth set-api-key"
            )
        })?;

        let builder = OpenBoxClient::builder()
            .base_url(connection.api_url)
            .api_key(api_key)
            .client_name("apps/approver");
        let sdk = builder.build();

        // Single-threaded runtime: the polling thread is sync and we
        // only ever block_on a single SDK call at a time. Multi-thread
        // would spin extra worker threads we don't use.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("tokio runtime: {e}"))?;

        Ok(ApiClient { sdk, rt })
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
