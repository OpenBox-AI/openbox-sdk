//! Approvals polling primitive. Parity with
//! `ts/src/polling/index.ts`, expressed Rust-idiomatically. No
//! internal thread or tokio loop and no event emitter. The
//! consumer drives the cadence (tokio interval, blocking
//! `thread::sleep`, OS timer); this module provides the diff
//! logic and seed-state bookkeeping so every consumer reports
//! brand-new approvals consistently.
//!
//! Tray apps, webhook bridges, CLI watch commands, and headless
//! monitors all use the same `ApprovalsPoller` to share the
//! cold-seed gate (no notification spam on the first poll) and
//! the known-ids set (resilient to dropped rows, reordering, and
//! cursor pagination).
//!
//! Usage:
//!
//! ```ignore
//! let mut poller = ApprovalsPoller::new(client.clone(), org_id);
//! loop {
//!     let PollResult { brand_new, approvals, changed } = poller.poll().await?;
//!     if changed { render(&approvals); }
//!     for a in &brand_new { notify(a); }
//!     tokio::time::sleep(Duration::from_secs(5)).await;
//! }
//! ```

use std::collections::HashSet;
use std::sync::Arc;

use crate::client::OpenBoxClient;
use crate::error::ApiError;
use crate::types::generated::Approval;

/// Pure diff helper for consumers that drive the poll loop
/// themselves (for example tray apps or sync runtimes). Given the
/// prior `known` id set and a new snapshot, returns the next id
/// set and the brand-new subset. The brand-new list is empty
/// during cold seed (when `known` is empty).
pub fn diff_known_ids(
    known: &HashSet<String>,
    snapshot: &[String],
) -> (HashSet<String>, Vec<String>) {
    let new_ids: HashSet<String> = snapshot.iter().cloned().collect();
    let brand_new: Vec<String> = if known.is_empty() {
        Vec::new()
    } else {
        snapshot
            .iter()
            .filter(|id| !known.contains(*id))
            .cloned()
            .collect()
    };
    (new_ids, brand_new)
}

/// Result of a single `poll()` call.
pub struct PollResult {
    /// Full list as returned by the backend.
    pub approvals: Vec<Approval>,
    /// Subset whose ids were absent from the prior poll's `known`
    /// set. Empty during the first (seed) poll so consumers do
    /// not surface pre-existing rows as new arrivals.
    pub brand_new: Vec<Approval>,
    /// `true` when the id set differs from the prior poll.
    pub changed: bool,
}

pub struct ApprovalsPoller {
    client: Arc<OpenBoxClient>,
    org_id: String,
    known: HashSet<String>,
    seeded: bool,
}

impl ApprovalsPoller {
    pub fn new(client: Arc<OpenBoxClient>, org_id: impl Into<String>) -> Self {
        Self {
            client,
            org_id: org_id.into(),
            known: HashSet::new(),
            seeded: false,
        }
    }

    /// Forget the prior `known` set (for example after a filter
    /// or status change, or an environment switch). The next poll
    /// re-seeds; `brand_new` will be empty on that poll even if
    /// rows appear new to the consumer.
    pub fn reset(&mut self) {
        self.known.clear();
        self.seeded = false;
    }

    /// `true` when the next `poll()` call will not emit brand-new
    /// rows. Useful for gating UI elements during cold start.
    pub fn is_cold_start(&self) -> bool {
        !self.seeded
    }

    /// Runs one poll round. Updates the internal known-id set and
    /// returns the full list, the brand-new subset, and a changed
    /// flag.
    pub async fn poll(&mut self) -> Result<PollResult, ApiError> {
        let response = self.client.get_org_approvals(&self.org_id, None).await?;
        let approvals: Vec<Approval> = response.approvals.data;

        let new_ids: HashSet<String> = approvals.iter().map(|a| a.id.clone()).collect();
        let brand_new: Vec<Approval> = if self.seeded {
            approvals
                .iter()
                .filter(|a| !self.known.contains(&a.id))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        let changed = self.known.len() != new_ids.len()
            || new_ids.iter().any(|id| !self.known.contains(id));

        self.known = new_ids;
        self.seeded = true;
        Ok(PollResult {
            approvals,
            brand_new,
            changed,
        })
    }
}
