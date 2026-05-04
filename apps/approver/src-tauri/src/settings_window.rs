//! Native settings panel. A single shared NSWindow holds an
//! NSStackView of NSPopUpButton / NSSwitch / NSSegmentedControl
//! sections plus a read-only "Account" block. Every control writes
//! changes back through the shared `AppState` mutex and persists via
//! `settings::save` on the same selector tick. There is no Apply
//! button: the iOS-style live-write model is the macOS Big Sur+
//! convention for preferences panes (see Reminders.app, Mail.app).
//!
//! The window instance is built lazily on first `show()` and kept
//! alive forever after; subsequent `show()` calls only call
//! `makeKeyAndOrderFront`. The user's "X" button calls `orderOut`
//! which keeps the controls (and their bound state) intact.
//!
//! Env switching is wired via a hot-reload signal: when the env
//! popup changes value, the polling thread is told (via the wakeup
//! channel) to break its current sleep and re-bootstrap. The signal
//! plus the handful of control callbacks all run on the AppKit main
//! thread, so no extra synchronization is needed beyond the
//! `Mutex<AppState>` that already guards the cross-thread fields.

#![allow(dead_code, unused_unsafe)]

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::{
    NSBackingStoreType, NSControlStateValueOff, NSControlStateValueOn, NSPopUpButton,
    NSSegmentedControl, NSSegmentSwitchTracking, NSStackView, NSStackViewDistribution,
    NSSwitch, NSTextField, NSUserInterfaceLayoutOrientation, NSView, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSPoint, NSRect, NSSize, NSString,
};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use crate::api::ApiClient;
use crate::settings::{self, EnvChoice, Settings};
use crate::{display_api_url, env_choice_to_name, AppState};

/// Cast any AppKit subclass pointer down to an `&NSView`. AppKit
/// uses pure single inheritance from NSView, so the pointer
/// representation is identical; we just hand the same `*const ()`
/// to a more general type. Used to feed varied control types into
/// `addArrangedSubview` without manually walking the deref chain.
fn as_view(p: &impl objc2::Message) -> &NSView {
    unsafe { &*(p as *const _ as *const NSView) }
}

/// Bag of references the action selectors need. Persisted in a
/// process-global so the runtime-built objc class can reach Rust
/// state via static lookup keyed on the target object pointer.
struct WindowCtx {
    state: Arc<Mutex<AppState>>,
    wakeup: mpsc::Sender<()>,
    /// Live API client handle the polling thread reads through. The
    /// env-change selector pre-validates the new env by building a
    /// fresh `ApiClient`, then locks this slot and swaps the inner
    /// `Some(client)`. On a build failure (no recorded API key for
    /// the new env), the slot is left untouched and the popup is
    /// reverted to the previous selection.
    client: Arc<Mutex<Option<ApiClient>>>,
    env_popup: Retained<NSPopUpButton>,
    notif_switch: Retained<NSSwitch>,
    poll_segments: Retained<NSSegmentedControl>,
    account_email: Retained<NSTextField>,
    account_org: Retained<NSTextField>,
    account_env: Retained<NSTextField>,
    account_url: Retained<NSTextField>,
    window: Retained<NSWindow>,
}

// SAFETY: All fields are Send-or-only-touched-on-main-thread. The
// `Retained<...>` AppKit handles are unsafe to access off main, but
// every access in this module first hops onto the main thread via
// `run_on_main_thread` from lib.rs. Storing the bag in a static
// requires Send; we promise the AppKit pointers are only read on
// main.
unsafe impl Send for WindowCtx {}
unsafe impl Sync for WindowCtx {}

/// The retained AppKit handles inside [`WindowCtx`] are `!Send` /
/// `!Sync` from objc2's view, but we only ever touch them on the
/// AppKit main thread, so the static-storage / cross-thread
/// constraints are upheld manually. The wrapper makes that promise
/// explicit at the type level so `OnceLock` is happy.
struct UnsafeStatic<T>(T);
unsafe impl<T> Send for UnsafeStatic<T> {}
unsafe impl<T> Sync for UnsafeStatic<T> {}

static CTX: OnceLock<UnsafeStatic<Mutex<Option<WindowCtx>>>> = OnceLock::new();

fn ctx_cell() -> &'static Mutex<Option<WindowCtx>> {
    &CTX.get_or_init(|| UnsafeStatic(Mutex::new(None))).0
}

static TARGET_HOLD: OnceLock<UnsafeStatic<Mutex<Vec<Retained<AnyObject>>>>> = OnceLock::new();

fn hold_target(t: Retained<AnyObject>) {
    let cell = TARGET_HOLD.get_or_init(|| UnsafeStatic(Mutex::new(Vec::new())));
    cell.0.lock().unwrap().push(t);
}

fn get_target_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"OBSettingsTarget", superclass).unwrap();
        unsafe {
            builder.add_method(
                sel!(envChanged:),
                env_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(notifChanged:),
                notif_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(pollChanged:),
                poll_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
        }
        builder.register()
    })
}

unsafe extern "C" fn env_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let idx = unsafe { ctx.env_popup.indexOfSelectedItem() };
        let new_choice = match idx {
            0 => EnvChoice::Production,
            1 => EnvChoice::Staging,
            _ => EnvChoice::Local,
        };
        let prev_choice = {
            let s = ctx.state.lock().unwrap();
            s.settings.env.clone()
        };
        if prev_choice == new_choice {
            // Same env re-selected; no work to do beyond the persist
            // path, which is harmless to skip.
            return;
        }

        let new_env = env_choice_to_name(&new_choice);

        // Pre-validate the new env BEFORE persisting the choice. If
        // the user picks an env that has no recorded X-API-Key the
        // build returns Err with a CLI hint; surface that as an
        // alert and revert the popup so the live client (still on
        // the previous env) keeps polling without a glitch.
        match ApiClient::for_env(new_env) {
            Ok(new_client) => {
                // Persist the new env first; the polling thread
                // reads `settings.env` for `for_env` resolution and
                // we don't want a swap that re-bootstraps to read a
                // stale env on the next iteration.
                {
                    let mut s = ctx.state.lock().unwrap();
                    s.settings.env = new_choice.clone();
                    // Reset the diff cache so the next post-swap
                    // poll doesn't fire spurious "brand new" notifs
                    // for IDs that simply belong to the new env.
                    s.known_ids.clear();
                    // Tell the polling thread to re-bootstrap on its
                    // next iteration: profile + agents-list run
                    // against the new client to refresh org_id /
                    // user_email.
                    s.needs_bootstrap = true;
                    s.org_id = None;
                    s.user_email = None;
                }
                let snap = ctx.state.lock().unwrap().settings.clone();
                let _ = settings::save(&snap);

                // Atomic swap: drop the old client and install the
                // new one in the same critical section. The polling
                // loop locks this same Mutex per iteration, so the
                // worst case is one in-flight HTTP call against the
                // old client finishing before the swap takes.
                {
                    let mut slot = ctx.client.lock().unwrap();
                    *slot = Some(new_client);
                }

                update_account_labels(ctx);

                // Best-effort wakeup so the polling thread breaks
                // out of its sleep and the bootstrap + first poll
                // against the new env happens immediately.
                let _ = ctx.wakeup.send(());

                run_alert(
                    "Environment switched",
                    &format!(
                        "Now polling against the {} environment. Tray will refresh in a moment.",
                        new_env.as_str()
                    ),
                );
            }
            Err(e) => {
                // Revert the popup selection; the persisted setting
                // and the live client both stay on prev_choice.
                let prev_idx = match prev_choice {
                    EnvChoice::Production => 0,
                    EnvChoice::Staging => 1,
                    EnvChoice::Local => 2,
                };
                unsafe {
                    ctx.env_popup.selectItemAtIndex(prev_idx);
                }
                run_alert(
                    "Cannot switch environment",
                    &format!(
                        "{}\n\nReverted to {}.",
                        e,
                        prev_choice.as_str()
                    ),
                );
            }
        }
    });
}

unsafe extern "C" fn notif_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let on = unsafe { ctx.notif_switch.state() } == NSControlStateValueOn;
        {
            let mut s = ctx.state.lock().unwrap();
            s.settings.notifications_enabled = on;
        }
        let snap = ctx.state.lock().unwrap().settings.clone();
        let _ = settings::save(&snap);
    });
}

unsafe extern "C" fn poll_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let idx = unsafe { ctx.poll_segments.selectedSegment() };
        let secs: u64 = match idx {
            0 => 5,
            1 => 15,
            _ => 60,
        };
        {
            let mut s = ctx.state.lock().unwrap();
            s.settings.poll_interval_secs = secs;
        }
        let snap = ctx.state.lock().unwrap().settings.clone();
        let _ = settings::save(&snap);
        // Wake the polling thread so it picks up the new interval on
        // the very next iteration instead of finishing the old sleep.
        let _ = ctx.wakeup.send(());
    });
}

fn with_ctx<F: FnOnce(&WindowCtx)>(f: F) {
    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    if let Some(ctx) = guard.as_ref() {
        f(ctx);
    }
}

fn run_alert(title: &str, body: &str) {
    use objc2_app_kit::NSAlert;
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let alert = NSAlert::new(mtm);
    unsafe {
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(body));
        let _ = alert.runModal();
    }
}

fn update_account_labels(ctx: &WindowCtx) {
    let s = ctx.state.lock().unwrap();
    let env_name = env_choice_to_name(&s.settings.env);
    let email = s.user_email.clone().unwrap_or_else(|| "<unknown>".into());
    let org = s.org_id.clone().unwrap_or_else(|| "<unknown>".into());
    drop(s);

    unsafe {
        ctx.account_email.setStringValue(&NSString::from_str(&format!("Signed in as {email}")));
        ctx.account_org.setStringValue(&NSString::from_str(&format!("Org: {org}")));
        ctx.account_env.setStringValue(&NSString::from_str(&format!("Active env: {}", env_name.as_str())));
        ctx.account_url.setStringValue(&NSString::from_str(&format!("API URL: {}", display_api_url(env_name))));
    }
}

/// Show the settings window. Builds it on first call; subsequent
/// calls just bring it to front. Must be called on the AppKit main
/// thread. The `client` handle is the same `Arc<Mutex<...>>` the
/// polling thread reads through; the env-change handler swaps a
/// freshly-built `ApiClient` into it so an env switch doesn't
/// require a relaunch.
pub fn show(
    state: Arc<Mutex<AppState>>,
    wakeup: mpsc::Sender<()>,
    client: Arc<Mutex<Option<ApiClient>>>,
) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };

    let cell = ctx_cell();
    {
        let guard = cell.lock().unwrap();
        if let Some(ctx) = guard.as_ref() {
            update_account_labels(ctx);
            unsafe {
                ctx.window
                    .makeKeyAndOrderFront(Some(&*ctx.window as &AnyObject));
            }
            return;
        }
    }

    let ctx = build_window(mtm, state, wakeup, client);
    {
        let mut guard = cell.lock().unwrap();
        update_account_labels(&ctx);
        unsafe {
            ctx.window
                .makeKeyAndOrderFront(Some(&*ctx.window as &AnyObject));
        }
        *guard = Some(ctx);
    }
}

fn build_window(
    mtm: MainThreadMarker,
    state: Arc<Mutex<AppState>>,
    wakeup: mpsc::Sender<()>,
    client: Arc<Mutex<Option<ApiClient>>>,
) -> WindowCtx {
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(480.0, 360.0));
    let mask = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Miniaturizable;
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            mtm.alloc(),
            frame,
            mask,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    unsafe {
        window.setTitle(&NSString::from_str("OpenBox Approver Settings"));
        window.setReleasedWhenClosed(false);
        window.center();
    }

    // Build the runtime target that hosts our action selectors.
    let target_class = get_target_class();
    let target: Retained<AnyObject> = unsafe { msg_send![target_class, new] };

    // ---- Env section ----
    let env_label = labeled(mtm, "Environment");
    let env_popup = NSPopUpButton::new(mtm);
    unsafe {
        env_popup.addItemWithTitle(&NSString::from_str("Production"));
        env_popup.addItemWithTitle(&NSString::from_str("Staging"));
        env_popup.addItemWithTitle(&NSString::from_str("Local"));
        let _: () = msg_send![&env_popup, setTarget: &*target];
        let _: () = msg_send![&env_popup, setAction: sel!(envChanged:)];
    }

    // ---- Notifications section ----
    let notif_label = labeled(mtm, "Notifications");
    let notif_switch = NSSwitch::new(mtm);
    let notif_caption = caption(mtm, "Notify on new approvals");
    unsafe {
        let _: () = msg_send![&notif_switch, setTarget: &*target];
        let _: () = msg_send![&notif_switch, setAction: sel!(notifChanged:)];
    }
    let notif_row = horizontal_row(mtm, &[as_view(&*notif_caption), as_view(&*notif_switch)]);

    // ---- Poll-interval section ----
    let poll_label = labeled(mtm, "Refresh interval");
    let labels = NSArray::from_retained_slice(&[
        NSString::from_str("5s"),
        NSString::from_str("15s"),
        NSString::from_str("60s"),
    ]);
    let poll_segments_any: Retained<AnyObject> = unsafe {
        let cls = AnyClass::get(c"NSSegmentedControl").unwrap();
        msg_send![
            cls,
            segmentedControlWithLabels: &*labels,
            trackingMode: NSSegmentSwitchTracking::SelectOne,
            target: &*target,
            action: sel!(pollChanged:),
        ]
    };
    let poll_segments: Retained<NSSegmentedControl> =
        unsafe { Retained::cast_unchecked(poll_segments_any) };

    // ---- Account section (read-only) ----
    let account_label = labeled(mtm, "Account");
    let account_email = readonly_text(mtm, "Signed in as ...");
    let account_org = readonly_text(mtm, "Org: ...");
    let account_env = readonly_text(mtm, "Active env: ...");
    let account_url = readonly_text(mtm, "API URL: ...");

    // ---- Vertical stack ----
    let stack = NSStackView::new(mtm);
    unsafe {
        stack.setOrientation(NSUserInterfaceLayoutOrientation::Vertical);
        stack.setAlignment(objc2_app_kit::NSLayoutAttribute::Leading);
        stack.setSpacing(8.0);
        stack.setDistribution(NSStackViewDistribution::Fill);
        stack.setEdgeInsets(objc2_foundation::NSEdgeInsets {
            top: 16.0,
            left: 20.0,
            bottom: 16.0,
            right: 20.0,
        });

        stack.addArrangedSubview(as_view(&*env_label));
        stack.addArrangedSubview(as_view(&*env_popup));
        let sp1 = spacer(mtm);
        stack.addArrangedSubview(&sp1);
        stack.addArrangedSubview(as_view(&*notif_label));
        stack.addArrangedSubview(as_view(&*notif_row));
        let sp2 = spacer(mtm);
        stack.addArrangedSubview(&sp2);
        stack.addArrangedSubview(as_view(&*poll_label));
        stack.addArrangedSubview(as_view(&*poll_segments));
        let sp3 = spacer(mtm);
        stack.addArrangedSubview(&sp3);
        stack.addArrangedSubview(as_view(&*account_label));
        stack.addArrangedSubview(as_view(&*account_email));
        stack.addArrangedSubview(as_view(&*account_org));
        stack.addArrangedSubview(as_view(&*account_env));
        stack.addArrangedSubview(as_view(&*account_url));
    }

    unsafe {
        window.setContentView(Some(as_view(&*stack)));
    }

    // Initialize control values from current settings.
    let snap = state.lock().unwrap().settings.clone();
    init_controls(&env_popup, &notif_switch, &poll_segments, &snap);

    hold_target(target);

    WindowCtx {
        state,
        wakeup,
        client,
        env_popup,
        notif_switch,
        poll_segments,
        account_email,
        account_org,
        account_env,
        account_url,
        window,
    }
}

fn init_controls(
    env_popup: &NSPopUpButton,
    notif_switch: &NSSwitch,
    poll_segments: &NSSegmentedControl,
    s: &Settings,
) {
    let env_idx = match s.env {
        EnvChoice::Production => 0,
        EnvChoice::Staging => 1,
        EnvChoice::Local => 2,
    };
    unsafe {
        env_popup.selectItemAtIndex(env_idx);
        notif_switch.setState(if s.notifications_enabled {
            NSControlStateValueOn
        } else {
            NSControlStateValueOff
        });
        let seg = match s.normalized_poll_secs() {
            5 => 0,
            15 => 1,
            _ => 2,
        };
        poll_segments.setSelectedSegment(seg);
    }
}

fn labeled(mtm: MainThreadMarker, text: &str) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    unsafe {
        // Bold-ish header: the system font isn't trivially bumped on
        // labelWithString, so we just rely on NSColor + spacing for
        // section separation. Plain labelWithString reads as a
        // section header at the size used here.
        label.setSelectable(false);
    }
    label
}

fn caption(mtm: MainThreadMarker, text: &str) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    unsafe {
        label.setSelectable(false);
    }
    label
}

fn readonly_text(mtm: MainThreadMarker, placeholder: &str) -> Retained<NSTextField> {
    let f = NSTextField::labelWithString(&NSString::from_str(placeholder), mtm);
    unsafe {
        f.setSelectable(true);
        f.setEditable(false);
    }
    f
}

fn spacer(mtm: MainThreadMarker) -> Retained<NSView> {
    let v = NSView::new(mtm);
    v.setFrameSize(NSSize::new(1.0, 8.0));
    v
}

fn horizontal_row(mtm: MainThreadMarker, views: &[&NSView]) -> Retained<NSStackView> {
    let stack = NSStackView::new(mtm);
    unsafe {
        stack.setOrientation(NSUserInterfaceLayoutOrientation::Horizontal);
        stack.setSpacing(12.0);
        for v in views {
            stack.addArrangedSubview(v);
        }
    }
    let _ = Bool::YES; // suppress unused-import for Bool when feature drift
    stack
}
