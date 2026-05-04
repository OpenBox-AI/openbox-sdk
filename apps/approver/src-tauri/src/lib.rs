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

struct AppState {
    org_id: Option<String>,
    user_email: Option<String>,
    known_ids: HashSet<String>,
    pending_refresh: bool,
    pending_decide: Option<(String, String, String)>,
    consecutive_errors: u32,
    settings: Settings,
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
            }));

            #[cfg(target_os = "macos")]
            {
                let (wakeup_tx, wakeup_rx) = mpsc::channel::<()>();
                let wakeup_tx_for_menu = wakeup_tx.clone();

                let state_for_tray = state.clone();
                let handle_for_actions = app.handle().clone();

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
                            let _ = handle_for_actions.run_on_main_thread(move || {
                                settings_window::show(state_w, wakeup_w);
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

                let state_poll = state.clone();
                let tray_poll = tray.clone();
                let handle = app.handle().clone();

                thread::spawn(move || {
                    let env = env_choice_to_name(&initial_settings.env);
                    let client = match api::ApiClient::for_env(env) {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("Failed to initialize: {}", e);
                            let tray_c = tray_poll.clone();
                            let _ = handle.run_on_main_thread(move || {
                                tray_c.lock().unwrap().update_menu(None, &[], Some(&e));
                            });
                            return;
                        }
                    };

                    let (user_email, org_id) = match bootstrap(&client) {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("Bootstrap failed: {}", e);
                            let tray_c = tray_poll.clone();
                            let _ = handle.run_on_main_thread(move || {
                                tray_c.lock().unwrap().update_menu(None, &[], Some(&e));
                            });
                            return;
                        }
                    };

                    {
                        let mut s = state_poll.lock().unwrap();
                        s.org_id = Some(org_id.clone());
                        s.user_email = Some(user_email.clone());
                    }

                    {
                        let email = user_email.clone();
                        let tray_c = tray_poll.clone();
                        let _ = handle.run_on_main_thread(move || {
                            tray_c.lock().unwrap().update_menu(Some(&email), &[], None);
                        });
                    }

                    loop {
                        let decide = {
                            let mut s = state_poll.lock().unwrap();
                            s.pending_refresh = false;
                            take_pending_decision(&mut s.pending_decide)
                        };

                        if let Some((agent_id, event_id, action)) = decide {
                            if let Err(e) = client.decide_approval(&agent_id, &event_id, &action) {
                                eprintln!("Decision failed: {}", e);
                            }
                        }

                        match client.get_org_approvals(&org_id) {
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
