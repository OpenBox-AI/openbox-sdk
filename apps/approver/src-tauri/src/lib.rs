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
use openbox_sdk::env::{resolve_urls, EnvName};
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
    pub user_email: Option<String>,
    pub known_ids: HashSet<String>,
    pub pending_refresh: bool,
    pub pending_decide: Option<(String, String, String)>,
    pub consecutive_errors: u32,
    pub settings: Settings,
    /// Flips to `true` when the Settings window swaps the API client
    /// to a new env. The polling thread checks this each iteration
    /// before fetching: when set, it re-runs bootstrap (profile +
    /// fallback agents-list) against the new client and clears the
    /// flag. `known_ids` is reset on the same hop so a stale ID set
    /// from the old env doesn't leak into the new env's "brand new"
    /// diff and spam notifications on the first post-switch tick.
    pub needs_bootstrap: bool,
}

/// Diff the current pending-approvals snapshot against the cached
/// `known_ids`. Returns `(new_ids_set, brand_new_ids_vec)`. Pulled out
/// of the polling loop so unit tests can exercise the dedupe logic
/// without needing an SDK client. The polling thread feeds two
/// successive snapshots through this and decides whether to fire the
/// notification path.
pub fn diff_known_ids(known: &HashSet<String>, snapshot: &[String]) -> (HashSet<String>, Vec<String>) {
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

/// Drain the queued decision off `AppState`. Mirrors the inline pop
/// the polling loop runs every tick, but factored out so a test can
/// confirm the queue empties correctly across consecutive ticks.
pub fn take_pending_decision(
    pending: &mut Option<(String, String, String)>,
) -> Option<(String, String, String)> {
    pending.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
                let initial_env = env_choice_to_name(&initial_settings.env);
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
                                    drop(s);
                                    let email_for_tray = email.clone().unwrap_or_default();
                                    let tray_c = tray_poll.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        tray_c.lock().unwrap().update_menu(Some(&email_for_tray), &[], None);
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

                        let (decide, org_id, user_email) = {
                            let mut s = state_poll.lock().unwrap();
                            s.pending_refresh = false;
                            (
                                take_pending_decision(&mut s.pending_decide),
                                s.org_id.clone(),
                                s.user_email.clone(),
                            )
                        };

                        let Some(org_id) = org_id else {
                            // Bootstrap hasn't produced an org yet;
                            // try again on the next tick.
                            let interval_secs = state_poll.lock().unwrap().settings.normalized_poll_secs();
                            let _ = wakeup_rx.recv_timeout(Duration::from_secs(interval_secs));
                            continue;
                        };
                        let user_email = user_email.unwrap_or_default();

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
                                    }
                                }).collect();

                                let email = user_email.clone();
                                let count = data.len();
                                let tray_c = tray_poll.clone();
                                let _ = handle.run_on_main_thread(move || {
                                    let t = tray_c.lock().unwrap();
                                    t.update_menu(Some(&email), &data, None);
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
                                    let email = user_email.clone();
                                    let err_msg = e.clone();
                                    let tray_c = tray_poll.clone();
                                    let _ = handle.run_on_main_thread(move || {
                                        tray_c.lock().unwrap().update_menu(Some(&email), &[], Some(&err_msg));
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
    let (email, profile_org_id) = match client.get_profile() {
        Ok(p) => {
            let e = if !p.email.is_empty() {
                p.email.clone()
            } else if let Some(u) = p.preferred_username.clone() {
                u
            } else if !p.sub.is_empty() {
                p.sub.clone()
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
        let agents = client.list_agents()?;
        agents
            .first()
            .map(|a| a.organization_id.clone())
            .ok_or("No organization found")?
    };

    Ok((email, org_id))
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
}
