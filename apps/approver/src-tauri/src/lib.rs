mod api;
mod settings;
#[cfg(target_os = "macos")]
mod history_window;
#[cfg(target_os = "macos")]
mod native_tray;
#[cfg(target_os = "macos")]
mod settings_window;

// Activity-label, verdict, and relative-time formatting all come from
// `openbox_sdk::approvals` so the approver renders a given approval the
// same way mobile and the VS Code extension do. The canonical
// activity-label table itself is spec-emitted into
// `rust/src/core/generated/govern.rs`; the SDK wraps it with a
// title-case fallback for free-form custom-preset activity_types.
use openbox_sdk::approvals::format::{format_label, time_ago, time_remaining};
use openbox_sdk::approvals::approval_source;
use openbox_sdk::env::{apply_env_source, resolve_urls, EnvName};
use openbox_sdk::verdict::verdict_label;

use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(target_os = "macos")]
use native_tray::{ApprovalData, NativeTray};

use settings::{EnvChoice, Settings};

/// Convert the persisted [`EnvChoice`] into the SDK's [`EnvName`].
/// One enum per side because the persisted choice is allowed to evolve
/// independently of the wire-level enum (e.g. a future "qa" bucket
/// that resolves to staging URLs would only land here).
pub fn env_choice_to_name(c: &EnvChoice) -> EnvName {
    match c {
        EnvChoice::Production => EnvName::Production,
        EnvChoice::Staging => EnvName::Staging,
        EnvChoice::Local => EnvName::Local,
    }
}

pub struct AppState {
    pub org_id: Option<String>,
    /// Cached profile email if the backend's /auth/profile returned
    /// one. Org X-API-Keys aren't user-bound so this is usually
    /// absent; the tray header now renders the org id instead and
    /// only falls back to email when org_id is missing.
    pub user_email: Option<String>,
    pub known_ids: HashSet<String>,
    pub pending_refresh: bool,
    pub pending_decide: Option<(String, String, String)>,
    pub consecutive_errors: u32,
    pub settings: Settings,
    /// Active env. Initialized from `apply_env_source()` at startup
    /// and mutated by the Settings window's env-switch handler. The
    /// env lives here (transient, runtime) instead of in
    /// `Settings` (which used to persist it to a separate
    /// `approver-settings.json` — that was a duplicate source of
    /// truth before `~/.openbox/config` became canonical).
    pub current_env: EnvName,
    /// Flips to `true` when the Settings window swaps the API client
    /// to a new env. The polling thread checks this each iteration
    /// before fetching: when set, it re-runs bootstrap (profile +
    /// fallback agents-list) against the new client and clears the
    /// flag. `known_ids` is reset on the same hop so a stale ID set
    /// from the old env doesn't leak into the new env's "brand new"
    /// diff and spam notifications on the first post-switch tick.
    pub needs_bootstrap: bool,
}

/// Re-export of `openbox_sdk::polling::diff_known_ids`. The
/// approver's poll loop keeps its own machinery (tray-update
/// plumbing, retry queue, configurable cadence), but the dedupe
/// arithmetic is the same as for every other SDK consumer and
/// therefore lives in the SDK.
pub use openbox_sdk::polling::diff_known_ids;

/// Compose the tray menu's top disabled-item header. Renders the
/// org id by default (env intentionally hidden so end users never
/// see staging / local labels). When `is_debug_mode()` is on, the
/// header appends `· <env>` so internal users can confirm which
/// env the app is hitting.
pub fn tray_header(org_id: Option<&str>, env: EnvName) -> String {
    let base = match org_id {
        Some(o) => format!("Org {}", o),
        None => "OpenBox Approver".to_string(),
    };
    if openbox_sdk::env::is_debug_mode() {
        format!("{} \u{00B7} {}", base, env.as_str())
    } else {
        base
    }
}

/// Drain the queued decision off `AppState`. Mirrors the inline pop
/// the polling loop runs every tick, but factored out so a test can
/// confirm the queue empties correctly across consecutive ticks.
pub fn take_pending_decision(
    pending: &mut Option<(String, String, String)>,
) -> Option<(String, String, String)> {
    pending.take()
}

/// Decide whether the polling tick should fire a notification given
/// the diff result and the user's notifications-enabled toggle. The
/// gate is the conjunction of the two flags. Pulled out of the
/// polling loop so a test can flip the toggle without instantiating
/// the rest of the pipeline.
pub fn should_notify(notifications_enabled: bool, brand_new_count: usize) -> bool {
    notifications_enabled && brand_new_count > 0
}

/// Select the subset of `approvals` whose `id` lives in
/// `brand_new_ids`, preserving the input order. Identical to the
/// inline filter the polling loop runs before calling
/// `notify_new_approvals`. Tests use this to verify the selection
/// behavior without poking at the actual notification crate.
pub fn select_brand_new<'a>(
    approvals: &'a [api::Approval],
    brand_new_ids: &[String],
) -> Vec<&'a api::Approval> {
    let new_set: HashSet<&String> = brand_new_ids.iter().collect();
    approvals
        .iter()
        .filter(|a| new_set.contains(&a.id))
        .collect()
}

/// Outcome the polling loop applies after attempting a decide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecisionOutcome {
    /// `decide_approval` returned Ok; the entry stays drained.
    Drained,
    /// `decide_approval` returned Err; the entry is re-queued for
    /// the next tick to retry.
    Retry,
}

/// Translate the decide call's `Result` into the next state of the
/// pending-decide slot. On Ok, the slot stays empty (we already
/// `take_pending_decision`'d it); on Err the original tuple is
/// re-queued. Splitting this out of the polling loop body lets the
/// retry behavior be unit-tested without hitting the SDK.
pub fn apply_decision_result(
    pending: &mut Option<(String, String, String)>,
    decision: (String, String, String),
    result: Result<(), String>,
) -> DecisionOutcome {
    match result {
        Ok(()) => DecisionOutcome::Drained,
        Err(_) => {
            *pending = Some(decision);
            DecisionOutcome::Retry
        }
    }
}

/// Resolve `(email, org_id)` from the bootstrap source closures.
/// Production wires `profile_fn` to `ApiClient::get_profile` and
/// `agents_fn` to `ApiClient::list_agents`. Tests pass mock closures
/// so the fallback chain (profile success → email + orgId; profile
/// success without orgId → agents-list fallback for org; profile
/// failure → both fallbacks) can be exercised without a network.
pub fn resolve_bootstrap<P, A>(
    profile_fn: P,
    agents_fn: A,
) -> Result<(String, String), String>
where
    P: FnOnce() -> Result<api::UserProfile, String>,
    A: FnOnce() -> Result<Vec<api::Agent>, String>,
{
    let (email, profile_org_id) = match profile_fn() {
        Ok(p) => {
            let e = if !p.email.is_empty() {
                p.email
            } else if let Some(u) = p.preferred_username {
                u
            } else if !p.sub.is_empty() {
                p.sub
            } else {
                "unknown".into()
            };
            (e, p.org_id)
        }
        Err(e) => {
            eprintln!("get_profile failed, falling back to agents list: {}", e);
            ("unknown".into(), None)
        }
    };

    let org_id = if let Some(oid) = profile_org_id {
        oid
    } else {
        let agents = agents_fn()?;
        agents
            .first()
            .map(|a| a.organization_id.clone())
            .ok_or("No organization found")?
    };

    Ok((email, org_id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Layer ~/.openbox/config into the process environment so the
    // approver agrees with every other OpenBox surface on the active
    // env, the per-env URLs, and the per-env API-key location. Without
    // this, the approver defaults to production and ignores the user's
    // `openbox config set --global OPENBOX_ENV=local`. Mirrors the JS
    // `applyEnvSource()` call every CLI / MCP / hook entrypoint makes.
    let initial_env = apply_env_source();

    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let initial_settings = settings::load();

            let state = Arc::new(Mutex::new(AppState {
                org_id: None,
                user_email: None,
                known_ids: HashSet::new(),
                pending_refresh: false,
                pending_decide: None,
                consecutive_errors: 0,
                settings: initial_settings.clone(),
                current_env: initial_env,
                needs_bootstrap: false,
            }));

            #[cfg(target_os = "macos")]
            {
                let (wakeup_tx, wakeup_rx) = mpsc::channel::<()>();
                let wakeup_tx_for_menu = wakeup_tx.clone();

                // Shared API client lives behind a Mutex so the
                // Settings window's env-change handler can swap in a
                // freshly-built client without tearing down the
                // polling thread. The polling loop locks per
                // iteration; reads vastly outnumber writes (one swap
                // per env-change vs N polls per minute), so the
                // contention is in the noise. `Option<>` lets us cope
                // with a startup where no key is recorded yet (the
                // user opens Settings, picks an env that has a key,
                // and we plug it in without a relaunch).
                // `initial_env` was resolved at `apply_env_source()`
                // call above from `~/.openbox/config`; settings.env is
                // ignored (deprecated, kept for back-compat parse only).
                let client_handle: Arc<Mutex<Option<api::ApiClient>>> =
                    match api::ApiClient::for_env(initial_env) {
                        Ok(c) => Arc::new(Mutex::new(Some(c))),
                        Err(e) => {
                            eprintln!("Failed to initialize: {}", e);
                            Arc::new(Mutex::new(None))
                        }
                    };

                let state_for_tray = state.clone();
                let handle_for_actions = app.handle().clone();
                let client_for_settings = client_handle.clone();

                let tray = NativeTray::new(
                    include_bytes!("../icons/tray-icon@2x.png"),
                    "OpenBox Approver",
                    move |action_id| {
                        if action_id == "quit" {
                            std::process::exit(0);
                        }
                        if action_id == "show_history" {
                            let state_w = state_for_tray.clone();
                            let _ = handle_for_actions.run_on_main_thread(move || {
                                history_window::show(state_w);
                            });
                            return;
                        }
                        if action_id == "show_settings" {
                            let state_w = state_for_tray.clone();
                            let wakeup_w = wakeup_tx_for_menu.clone();
                            let client_w = client_for_settings.clone();
                            let _ = handle_for_actions.run_on_main_thread(move || {
                                settings_window::show(state_w, wakeup_w, client_w);
                            });
                            return;
                        }

                        let mut s = state_for_tray.lock().unwrap();
                        if action_id == "refresh" {
                            s.pending_refresh = true;
                            let _ = wakeup_tx_for_menu.send(());
                        } else if let Some(rest) = action_id.strip_prefix("approve:") {
                            let parts: Vec<&str> = rest.splitn(2, ':').collect();
                            if parts.len() == 2 {
                                s.pending_decide = Some((parts[0].into(), parts[1].into(), "approve".into()));
                            }
                        } else if let Some(rest) = action_id.strip_prefix("reject:") {
                            let parts: Vec<&str> = rest.splitn(2, ':').collect();
                            if parts.len() == 2 {
                                s.pending_decide = Some((parts[0].into(), parts[1].into(), "reject".into()));
                            }
                        }
                    },
                );

                let tray = Arc::new(Mutex::new(tray));

                // Surface a startup error in the tray menu after the
                // tray exists. Earlier we only logged it; surface it
                // visually too so users see why nothing's loading.
                if client_handle.lock().unwrap().is_none() {
                    let tray_c = tray.clone();
                    let handle_c = app.handle().clone();
                    let _ = handle_c.run_on_main_thread(move || {
                        tray_c.lock().unwrap().update_menu(
                            None,
                            &[],
                            Some(
                                "No API client. Open Settings to pick an env with a recorded key.",
                            ),
                        );
                    });
                }

                // Mark "bootstrap pending" up front; the polling loop
                // runs profile + agents-list on its first iteration
                // and again any time the env-switch handler flips
                // this flag.
                state.lock().unwrap().needs_bootstrap = true;

                let state_poll = state.clone();
                let tray_poll = tray.clone();
                let handle = app.handle().clone();
                let client_for_poll = client_handle.clone();

                thread::spawn(move || {
                    loop {
                        // ---- Optional re-bootstrap ----
                        let need = {
                            let s = state_poll.lock().unwrap();
                            s.needs_bootstrap
                        };
                        if need {
                            let bootstrap_result = {
                                let cg = client_for_poll.lock().unwrap();
                                match cg.as_ref() {
                                    Some(c) => bootstrap(c).map(|(e, o)| (Some(e), Some(o))),
                                    None => Err("No API client built; configure an env in Settings.".to_string()),
                                }
                            };
                            match bootstrap_result {
                                Ok((email, org)) => {
                                    let mut s = state_poll.lock().unwrap();
                                    s.user_email = email.clone();
                                    s.org_id = org.clone();
                                    s.needs_bootstrap = false;
                                    s.known_ids.clear();
                                    let header = tray_header(s.org_id.as_deref(), s.current_env);
                                    drop(s);
                                    let tray_c = tray_poll.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        tray_c.lock().unwrap().update_menu(Some(&header), &[], None);
                                    });
                                }
                                Err(e) => {
                                    eprintln!("Bootstrap failed: {}", e);
                                    let tray_c = tray_poll.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        tray_c.lock().unwrap().update_menu(None, &[], Some(&e));
                                    });
                                    // Sleep at the configured cadence
                                    // before retrying; an env without a
                                    // valid key shouldn't busy-loop.
                                    let interval_secs = state_poll.lock().unwrap().settings.normalized_poll_secs();
                                    match wakeup_rx.recv_timeout(Duration::from_secs(interval_secs)) {
                                        Ok(()) => { while wakeup_rx.try_recv().is_ok() {} }
                                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                                            thread::sleep(Duration::from_secs(interval_secs));
                                        }
                                    }
                                    continue;
                                }
                            }
                        }

                        let (decide, org_id) = {
                            let mut s = state_poll.lock().unwrap();
                            s.pending_refresh = false;
                            (
                                take_pending_decision(&mut s.pending_decide),
                                s.org_id.clone(),
                            )
                        };

                        let Some(org_id) = org_id else {
                            // Bootstrap hasn't produced an org yet;
                            // try again on the next tick.
                            let interval_secs = state_poll.lock().unwrap().settings.normalized_poll_secs();
                            let _ = wakeup_rx.recv_timeout(Duration::from_secs(interval_secs));
                            continue;
                        };

                        if let Some((agent_id, event_id, action)) = decide {
                            let res = {
                                let cg = client_for_poll.lock().unwrap();
                                match cg.as_ref() {
                                    Some(c) => c.decide_approval(&agent_id, &event_id, &action),
                                    None => Err("No API client".into()),
                                }
                            };
                            if let Err(e) = res {
                                eprintln!("Decision failed: {}", e);
                                // Re-queue the decision so the next
                                // tick retries; the failure was
                                // transient (network blip, 5xx) most
                                // of the time and we shouldn't drop
                                // the user's intent on the floor.
                                state_poll.lock().unwrap().pending_decide =
                                    Some((agent_id, event_id, action));
                            }
                        }

                        let poll_res = {
                            let cg = client_for_poll.lock().unwrap();
                            match cg.as_ref() {
                                Some(c) => c.get_org_approvals(&org_id),
                                None => Err("No API client".into()),
                            }
                        };
                        match poll_res {
                            Ok(approvals) => {
                                let snapshot_ids: Vec<String> = approvals.iter().map(|a| a.id.clone()).collect();

                                let (new_ids, brand_new_ids, notify_enabled) = {
                                    let mut s = state_poll.lock().unwrap();
                                    s.consecutive_errors = 0;
                                    let (n, b) = diff_known_ids(&s.known_ids, &snapshot_ids);
                                    s.known_ids = n.clone();
                                    let notify = s.settings.notifications_enabled;
                                    (n, b, notify)
                                };

                                if !brand_new_ids.is_empty() && notify_enabled {
                                    let new_set: HashSet<&String> = brand_new_ids.iter().collect();
                                    let brand_new: Vec<&api::Approval> = approvals
                                        .iter()
                                        .filter(|a| new_set.contains(&a.id))
                                        .collect();
                                    if !brand_new.is_empty() {
                                        notify_new_approvals(&brand_new);
                                    }
                                }

                                // Always refresh tray data; the menu is
                                // cheap to redraw and a noop when ids
                                // match. Push every tick so timing
                                // strings (`time_ago`, `expires_in`) stay
                                // current even when the id set is
                                // unchanged.
                                let data: Vec<ApprovalData> = approvals.iter().map(|a| {
                                    ApprovalData {
                                        agent_name: a.agent.as_ref()
                                            .map(|ag| ag.agent_name.clone())
                                            .unwrap_or_else(|| "Unknown Agent".into()),
                                        agent_id: a.agent_id.clone().unwrap_or_default(),
                                        event_id: a.id.clone(),
                                        action_type: a
                                            .activity_type
                                            .as_deref()
                                            .map(format_label)
                                            .unwrap_or_default(),
                                        verdict: a
                                            .verdict
                                            .and_then(verdict_label)
                                            .map(|s| s.to_string())
                                            .unwrap_or_default(),
                                        trust_tier: a.metadata.as_ref()
                                            .and_then(|m| m.trust_tier)
                                            .map(|t| format!("Tier {}", t))
                                            .unwrap_or_default(),
                                        reason: a.reason.clone().unwrap_or_default(),
                                        time_ago: a.created_at.as_deref().map(time_ago).unwrap_or_default(),
                                        expires_in: a.approval_expired_at.as_deref().map(time_remaining).unwrap_or_default(),
                                        source: approval_source(a),
                                    }
                                }).collect();

                                let header = {
                                    let s = state_poll.lock().unwrap();
                                    tray_header(s.org_id.as_deref(), s.current_env)
                                };
                                let count = data.len();
                                let tray_c = tray_poll.clone();
                                let _ = handle.run_on_main_thread(move || {
                                    let t = tray_c.lock().unwrap();
                                    t.update_menu(Some(&header), &data, None);
                                    t.set_badge(count);
                                });
                                // `new_ids` was already pushed into
                                // `s.known_ids` inside the locked
                                // block; drop the binding so clippy
                                // doesn't flag it as ignored.
                                drop(new_ids);
                            }
                            Err(e) => {
                                let errs = {
                                    let mut s = state_poll.lock().unwrap();
                                    s.consecutive_errors += 1;
                                    s.consecutive_errors
                                };
                                eprintln!("Poll error ({}/3): {}", errs, e);
                                if errs >= 3 {
                                    let header = {
                                        let s = state_poll.lock().unwrap();
                                        tray_header(s.org_id.as_deref(), s.current_env)
                                    };
                                    let err_msg = e.clone();
                                    let tray_c = tray_poll.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        tray_c.lock().unwrap().update_menu(Some(&header), &[], Some(&err_msg));
                                    });
                                }
                            }
                        }

                        // Re-read the polling interval from state every
                        // tick; the Settings window can have flipped it
                        // mid-loop. The wakeup channel still fires for
                        // explicit Refresh, so the worst case is one
                        // tick at the old cadence after the change.
                        let interval_secs = state_poll.lock().unwrap().settings.normalized_poll_secs();
                        match wakeup_rx.recv_timeout(Duration::from_secs(interval_secs)) {
                            Ok(()) => {
                                while wakeup_rx.try_recv().is_ok() {}
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {}
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                thread::sleep(Duration::from_secs(interval_secs));
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn bootstrap(client: &api::ApiClient) -> Result<(String, String), String> {
    // The profile call is best-effort. The Rust SDK's UserProfile
    // marks `sub` and `email` as required (matching the production
    // schema), but the staging deployment currently returns a profile
    // without `sub` so a strict decode 500s the bootstrap. Fall back
    // to the agents-list path for the org id and use a placeholder
    // email so the tray still populates instead of dying on a schema
    // skew the user can't fix.
    resolve_bootstrap(|| client.get_profile(), || client.list_agents())
}

fn notify_new_approvals(approvals: &[&api::Approval]) {
    let (title, body) = if approvals.len() == 1 {
        let a = &approvals[0];
        let agent = a.agent.as_ref().map(|ag| ag.agent_name.as_str()).unwrap_or("Agent");
        let reason = a.reason.as_deref().unwrap_or("");
        let action = a
            .activity_type
            .as_deref()
            .map(format_label)
            .unwrap_or_else(|| "action".into());
        (
            format!("Approval Required: {}", agent),
            if reason.is_empty() { format!("{} needs approval", action) } else { reason.to_string() },
        )
    } else {
        (
            "New Approval Requests".into(),
            format!("{} approvals waiting for review", approvals.len()),
        )
    };

    let _ = notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .show();
}

/// Resolve the API URL the Settings window's read-only "API URL" row
/// renders. Honors `OPENBOX_API_URL` first (mirrors the runtime
/// override `ApiClient::new` applies), then falls back to the SDK's
/// per-env static URL bundle. An empty static URL (e.g. staging in
/// the default ENVIRONMENTS table) returns "<unset>" so the user
/// sees something concrete instead of an empty label.
pub fn display_api_url(env: EnvName) -> String {
    if let Ok(v) = std::env::var("OPENBOX_API_URL") {
        let t = v.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    let cfg = resolve_urls(env);
    if cfg.api_url.is_empty() {
        "<unset>".into()
    } else {
        cfg.api_url.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn diff_known_first_load_emits_no_brand_new() {
        let known: HashSet<String> = HashSet::new();
        let snap = vec!["a".into(), "b".into()];
        let (n, brand) = diff_known_ids(&known, &snap);
        // First load: never spam the user with notifications for the
        // initial backlog.
        assert!(brand.is_empty());
        assert!(n.contains("a") && n.contains("b") && n.len() == 2);
    }

    #[test]
    fn diff_known_detects_new() {
        let mut known = HashSet::new();
        known.insert("a".to_string());
        let snap = vec!["a".into(), "b".into(), "c".into()];
        let (n, brand) = diff_known_ids(&known, &snap);
        let brand_set: HashSet<&String> = brand.iter().collect();
        assert!(brand_set.contains(&"b".to_string()));
        assert!(brand_set.contains(&"c".to_string()));
        assert!(!brand_set.contains(&"a".to_string()));
        assert_eq!(n.len(), 3);
    }

    #[test]
    fn diff_known_handles_removed() {
        let mut known = HashSet::new();
        known.insert("a".to_string());
        known.insert("b".to_string());
        let snap = vec!["a".into()];
        let (n, brand) = diff_known_ids(&known, &snap);
        // Nothing brand-new; "b" decided / expired and dropped from
        // the snapshot. The state's known_ids should shrink to {a}.
        assert!(brand.is_empty());
        assert_eq!(n.len(), 1);
        assert!(n.contains("a"));
    }

    #[test]
    fn pending_decision_drains_to_none() {
        let mut p: Option<(String, String, String)> =
            Some(("ag1".into(), "ev1".into(), "approve".into()));
        let first = take_pending_decision(&mut p);
        assert!(first.is_some());
        assert!(p.is_none());
        // Second tick: nothing left.
        let second = take_pending_decision(&mut p);
        assert!(second.is_none());
    }

    #[test]
    fn settings_drives_poll_interval() {
        // The polling thread reads `settings.normalized_poll_secs()`
        // every tick, so flipping the bucket on a Settings instance
        // must change what the thread would see on the next read.
        let mut s = Settings::default();
        assert_eq!(s.normalized_poll_secs(), 5);
        s.poll_interval_secs = 15;
        assert_eq!(s.normalized_poll_secs(), 15);
        s.poll_interval_secs = 60;
        assert_eq!(s.normalized_poll_secs(), 60);
    }

    #[test]
    fn env_choice_to_name_round_trip() {
        assert_eq!(env_choice_to_name(&EnvChoice::Production), EnvName::Production);
        assert_eq!(env_choice_to_name(&EnvChoice::Staging), EnvName::Staging);
        assert_eq!(env_choice_to_name(&EnvChoice::Local), EnvName::Local);
    }

    // ---- Test fixtures for the polling / decision pipeline ----
    //
    // Construct a minimal `Approval` carrying just the fields the
    // notify path reads. The wire struct has no Default, so build a
    // helper that fills in the optional fields we care about.
    fn approval(id: &str, agent_name: Option<&str>) -> api::Approval {
        api::Approval {
            id: id.into(),
            event_id: None,
            agent_id: None,
            status: None,
            action_type: None,
            activity_type: None,
            verdict: None,
            reason: None,
            created_at: None,
            decided_at: None,
            approval_expired_at: None,
            agent: agent_name.map(|n| openbox_sdk::types::ApprovalAgent {
                agent_name: n.to_string(),
            }),
            metadata: None,
            input: None,
            spans: None,
        }
    }

    fn user_profile(email: &str, org_id: Option<&str>) -> api::UserProfile {
        api::UserProfile {
            sub: "sub-1".into(),
            email: email.into(),
            name: None,
            preferred_username: None,
            email_verified: None,
            org_id: org_id.map(String::from),
        }
    }

    fn agent_with_org(org_id: &str) -> api::Agent {
        api::Agent {
            id: "agent-1".into(),
            agent_name: "test-agent".into(),
            agent_type: None,
            model_name: None,
            description: None,
            organization_id: org_id.into(),
            config: None,
            team_ids: None,
            tags: None,
            icon: None,
            trust_score: None,
            tier: None,
            status: None,
            created_at: None,
            updated_at: None,
        }
    }

    // ---- should_notify ----

    #[test]
    fn should_notify_gates_on_flag() {
        // Brand-new IDs alone aren't enough; the flag must also be
        // on. Two ticks here simulate the cadence: tick 1 has 0 new
        // (no notification), tick 2 has 3 new (notification). The
        // flag flip turns it back off.
        assert!(!should_notify(true, 0));
        assert!(should_notify(true, 3));
        assert!(!should_notify(false, 3));
        assert!(!should_notify(false, 0));
    }

    #[test]
    fn polling_cadence_first_tick_no_notification() {
        // Two-tick simulation: first tick populates known_ids with
        // the initial backlog (no notification per
        // diff_known_first_load_emits_no_brand_new); second tick
        // sees one new id => exactly one notification fires. Mirror
        // the polling loop's actual sequencing.
        let mut known: HashSet<String> = HashSet::new();

        // Tick 1: initial snapshot.
        let snap1 = vec!["a".to_string(), "b".to_string()];
        let (n1, brand1) = diff_known_ids(&known, &snap1);
        known = n1;
        assert!(!should_notify(true, brand1.len()));

        // Tick 2: a new id appears.
        let snap2 = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let (n2, brand2) = diff_known_ids(&known, &snap2);
        known = n2;
        assert_eq!(brand2.len(), 1);
        assert!(should_notify(true, brand2.len()));

        // Notifications disabled -> no fire even with a new id.
        assert!(!should_notify(false, brand2.len()));

        let _ = known;
    }

    // ---- decision dispatch retry ----

    #[test]
    fn decision_retries_on_transient_error() {
        let mut pending: Option<(String, String, String)> = None;
        let decision = ("ag-1".to_string(), "ev-1".to_string(), "approve".to_string());

        // First dispatch fails: re-queue.
        let outcome = apply_decision_result(
            &mut pending,
            decision.clone(),
            Err("transient 503".into()),
        );
        assert_eq!(outcome, DecisionOutcome::Retry);
        assert_eq!(pending, Some(decision.clone()));

        // Next tick pops the queued decision and retries; this time
        // the SDK call succeeds, so the slot drains.
        let popped = take_pending_decision(&mut pending).unwrap();
        let outcome2 = apply_decision_result(&mut pending, popped, Ok(()));
        assert_eq!(outcome2, DecisionOutcome::Drained);
        assert!(pending.is_none());
    }

    #[test]
    fn decision_drains_on_success_first_try() {
        let mut pending: Option<(String, String, String)> = None;
        let decision = ("ag-2".into(), "ev-2".into(), "reject".into());
        let outcome = apply_decision_result(&mut pending, decision, Ok(()));
        assert_eq!(outcome, DecisionOutcome::Drained);
        assert!(pending.is_none());
    }

    // ---- bootstrap fallbacks ----

    #[test]
    fn bootstrap_profile_success_with_org_id() {
        // Profile carries email + orgId; agents_fn must NOT be
        // called (the fallback path is dead code on this branch).
        let profile = user_profile("user@example.com", Some("org-1"));
        let agents_called = std::cell::Cell::new(false);
        let result = resolve_bootstrap(
            || Ok(profile.clone()),
            || {
                agents_called.set(true);
                Ok(vec![agent_with_org("never-used")])
            },
        );
        assert_eq!(result, Ok(("user@example.com".into(), "org-1".into())));
        assert!(!agents_called.get(), "agents_fn must not run when profile carried org_id");
    }

    #[test]
    fn bootstrap_profile_missing_org_falls_back_to_agents() {
        let profile = user_profile("user@example.com", None);
        let result = resolve_bootstrap(
            || Ok(profile.clone()),
            || Ok(vec![agent_with_org("org-from-agents")]),
        );
        assert_eq!(
            result,
            Ok(("user@example.com".into(), "org-from-agents".into()))
        );
    }

    #[test]
    fn bootstrap_profile_failure_uses_unknown_email_and_agents_org() {
        // profile fails; email defaults to "unknown" and orgId
        // resolves through the agents-list call.
        let result = resolve_bootstrap(
            || Err("staging schema skew".into()),
            || Ok(vec![agent_with_org("org-fallback")]),
        );
        assert_eq!(result, Ok(("unknown".into(), "org-fallback".into())));
    }

    #[test]
    fn bootstrap_no_org_anywhere_errors() {
        let profile = user_profile("user@example.com", None);
        let result = resolve_bootstrap(
            || Ok(profile.clone()),
            || Ok(Vec::new()),
        );
        assert!(result.is_err(), "no org in profile or agents -> Err");
    }

    #[test]
    fn bootstrap_email_falls_back_to_preferred_username() {
        let mut profile = user_profile("", Some("org-1"));
        profile.preferred_username = Some("kit@example.com".into());
        let result = resolve_bootstrap(
            || Ok(profile.clone()),
            || Ok(vec![agent_with_org("never-used")]),
        );
        assert_eq!(result, Ok(("kit@example.com".into(), "org-1".into())));
    }

    // ---- settings change mid-poll ----

    #[test]
    fn settings_change_mid_poll_uses_new_interval() {
        // The polling loop reads `state.settings.normalized_poll_secs()`
        // every iteration. Simulate a settings flip mid-tick by
        // mutating the same Settings instance the next read would
        // pick up; the second read returns the new bucket.
        let mut s = Settings::default();
        assert_eq!(s.normalized_poll_secs(), 5);

        // User opens Settings and bumps to 60s.
        s.poll_interval_secs = 60;
        assert_eq!(s.normalized_poll_secs(), 60);

        // The next iteration sees 60. A subsequent flip back to 15
        // is also picked up on the iteration after.
        s.poll_interval_secs = 15;
        assert_eq!(s.normalized_poll_secs(), 15);
    }

    // ---- notify-new filter ----

    #[test]
    fn select_brand_new_filters_to_only_new_ids() {
        // 5 incoming approvals; 2 already known, 3 brand new. The
        // selector hands back exactly the 3 brand-new ones, in input
        // order, regardless of how the brand_new_ids vector is
        // ordered.
        let approvals = vec![
            approval("a", Some("Bob")),
            approval("b", Some("Carol")),
            approval("c", Some("Dave")),
            approval("d", Some("")),
            approval("e", Some("Eve")),
        ];
        let mut known: HashSet<String> = HashSet::new();
        known.insert("a".into());
        known.insert("b".into());
        let snapshot_ids: Vec<String> = approvals.iter().map(|a| a.id.clone()).collect();
        let (_, brand_new_ids) = diff_known_ids(&known, &snapshot_ids);
        assert_eq!(brand_new_ids.len(), 3);

        let selected = select_brand_new(&approvals, &brand_new_ids);
        let ids: Vec<String> = selected.iter().map(|a| a.id.clone()).collect();
        assert_eq!(ids, vec!["c".to_string(), "d".to_string(), "e".to_string()]);
    }

    #[test]
    fn select_brand_new_handles_empty_agent_name() {
        // The notification body composes "Approval Required: <agent>"
        // for the 1-item case; an empty agent name shouldn't drop
        // the row from the selector. The presentation layer
        // substitutes "Agent" for an empty/missing agent.
        let approvals = vec![approval("z", Some(""))];
        let brand_new_ids = vec!["z".to_string()];
        let selected = select_brand_new(&approvals, &brand_new_ids);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].id, "z");
    }

    #[test]
    fn select_brand_new_empty_when_no_overlap() {
        // brand_new_ids contains an id not present in the approvals
        // slice (race: the snapshot already moved past the entry).
        // Selector returns empty, no panic.
        let approvals = vec![approval("a", None)];
        let brand_new_ids = vec!["different".to_string()];
        let selected = select_brand_new(&approvals, &brand_new_ids);
        assert!(selected.is_empty());
    }
}
