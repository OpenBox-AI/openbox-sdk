mod api;
mod settings;
#[cfg(target_os = "macos")]
mod native_tray;

// Activity-label, verdict, and relative-time formatting all come from
// `openbox_sdk::approvals` so the approver renders a given approval the
// same way mobile and the VS Code extension do. The canonical
// activity-label table itself is spec-emitted into
// `rust/src/core/generated/govern.rs`; the SDK wraps it with a
// title-case fallback for free-form custom-preset activity_types.
use openbox_sdk::approvals::format::{format_label, time_ago, time_remaining};
use openbox_sdk::verdict::verdict_label;

use std::collections::HashSet;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(target_os = "macos")]
use native_tray::{ApprovalData, NativeTray};

struct AppState {
    org_id: Option<String>,
    user_email: Option<String>,
    known_ids: HashSet<String>,
    pending_refresh: bool,
    pending_decide: Option<(String, String, String)>,
    consecutive_errors: u32,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let state = Arc::new(Mutex::new(AppState {
                org_id: None,
                user_email: None,
                known_ids: HashSet::new(),
                pending_refresh: false,
                pending_decide: None,
                consecutive_errors: 0,
            }));

            #[cfg(target_os = "macos")]
            {
                let (wakeup_tx, wakeup_rx) = mpsc::channel::<()>();
                let wakeup_tx_for_menu = wakeup_tx.clone();

                let state_for_tray = state.clone();
                let tray = NativeTray::new(
                    include_bytes!("../icons/tray-icon@2x.png"),
                    "OpenBox Approver",
                    move |action_id| {
                        let mut s = state_for_tray.lock().unwrap();
                        if action_id == "quit" {
                            std::process::exit(0);
                        } else if action_id == "refresh" {
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
                    let client = match api::ApiClient::new() {
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
                            s.pending_decide.take()
                        };

                        if let Some((agent_id, event_id, action)) = decide {
                            if let Err(e) = client.decide_approval(&agent_id, &event_id, &action) {
                                eprintln!("Decision failed: {}", e);
                            }
                        }

                        match client.get_org_approvals(&org_id) {
                            Ok(approvals) => {
                                let new_ids: HashSet<String> = approvals.iter().map(|a| a.id.clone()).collect();
                                state_poll.lock().unwrap().consecutive_errors = 0;

                                let mut s = state_poll.lock().unwrap();
                                if !s.known_ids.is_empty() {
                                    let brand_new: Vec<_> = approvals.iter()
                                        .filter(|a| !s.known_ids.contains(&a.id))
                                        .collect();
                                    if !brand_new.is_empty() {
                                        notify_new_approvals(&brand_new);
                                    }
                                }
                                let changed = s.known_ids != new_ids;
                                s.known_ids = new_ids;
                                drop(s);

                                if changed {
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
                                }
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

                        // Re-read the polling interval from on-disk
                        // settings every tick so a Settings-window
                        // change picks up by the next iteration. The
                        // load is a tiny JSON read; the cost is far
                        // below the seconds-scale interval.
                        let interval_secs = settings::load().normalized_poll_secs();
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
