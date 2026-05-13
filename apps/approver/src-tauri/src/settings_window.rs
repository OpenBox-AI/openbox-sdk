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
    NSApplication, NSBackingStoreType, NSBox, NSBoxType, NSControlStateValueOff,
    NSControlStateValueOn, NSFont, NSGridView, NSGridCellPlacement, NSGridRowAlignment,
    NSLayoutAttribute, NSPopUpButton, NSSegmentedControl, NSSegmentSwitchTracking,
    NSStackView, NSStackViewDistribution, NSSwitch, NSTextField, NSTitlePosition,
    NSUserInterfaceLayoutOrientation, NSView, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowStyleMask, NSWindowTitleVisibility,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSPoint, NSRect, NSSize, NSString,
};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use crate::api::ApiClient;
use crate::settings::{self, EnvChoice, Settings};
use crate::{display_api_url, env_choice_to_name, AppState};
use openbox_sdk::env::EnvName;

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
        let new_env = env_choice_to_name(&new_choice);
        let prev_env = ctx.state.lock().unwrap().current_env;
        if prev_env == new_env {
            return;
        }

        // Pre-validate the new env BEFORE persisting the choice. If
        // the user picks an env that has no recorded X-API-Key the
        // build returns Err with a CLI hint; surface that as an
        // alert and revert the popup so the live client (still on
        // the previous env) keeps polling without a glitch.
        match ApiClient::for_env(new_env) {
            Ok(new_client) => {
                // Persist to ~/.openbox/config so the CLI / MCP /
                // hooks / extension all converge on the new env on
                // their next invocation. The approver no longer
                // keeps a per-app env copy.
                if let Err(e) = openbox_sdk::env::write_global_env(new_env) {
                    eprintln!("write_global_env failed: {}", e);
                }
                // Reapply ~/.openbox/config into std::env so the
                // current process sees the new env on any subsequent
                // env::var() lookup (per-env URL overrides, etc.).
                let _ = openbox_sdk::env::apply_env_source();
                {
                    let mut s = ctx.state.lock().unwrap();
                    s.current_env = new_env;
                    // Reset the diff cache so the next post-swap
                    // poll doesn't fire spurious "brand new" notifs
                    // for IDs that simply belong to the new env.
                    s.known_ids.clear();
                    // Tell the polling thread to re-bootstrap on its
                    // next iteration: profile + agents-list run
                    // against the new client to refresh org_id.
                    s.needs_bootstrap = true;
                    s.org_id = None;
                    s.user_email = None;
                }
                // Persist the non-env UI prefs (notifications,
                // poll interval). Env intentionally omitted; it
                // lives in ~/.openbox/config now.
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
                // Revert the popup selection; the persisted config
                // and the live client both stay on prev_env.
                let prev_idx = match prev_env {
                    EnvName::Production => 0,
                    EnvName::Staging => 1,
                    EnvName::Local => 2,
                };
                unsafe {
                    ctx.env_popup.selectItemAtIndex(prev_idx);
                }
                run_alert(
                    "Cannot switch environment",
                    &format!(
                        "{}\n\nReverted to {}.",
                        e,
                        prev_env.as_str()
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
    let env_name = s.current_env;
    let org = s.org_id.clone().unwrap_or_else(|| "<unknown>".into());
    drop(s);

    unsafe {
        // The Account section is rendered as label-control rows
        // ("Auth", "Org", ...) so the value field carries ONLY the
        // value, not a duplicated "Label: value" string.
        ctx.account_email.setStringValue(&NSString::from_str("org X-API-Key"));
        ctx.account_org.setStringValue(&NSString::from_str(&org));
        ctx.account_env.setStringValue(&NSString::from_str(env_name.as_str()));
        ctx.account_url.setStringValue(&NSString::from_str(&display_api_url(env_name)));
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
            activate_and_focus(&ctx.window);
            return;
        }
    }

    let ctx = build_window(mtm, state, wakeup, client);
    {
        let mut guard = cell.lock().unwrap();
        update_account_labels(&ctx);
        activate_and_focus(&ctx.window);
        *guard = Some(ctx);
    }
}

/// Bring the app to the foreground and focus the given window. The
/// approver runs with `NSApplicationActivationPolicyAccessory` so
/// `makeKeyAndOrderFront` alone shows the window but leaves the
/// previously-active app holding keyboard focus; the window then
/// looks unresponsive to clicks (every event routes to the other
/// app's frontmost window). `activate(ignoringOtherApps:)` flips
/// the active-app bit so the new window owns input.
fn activate_and_focus(window: &NSWindow) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    unsafe {
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        window.makeKeyAndOrderFront(Some(window as &AnyObject));
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
        // Sit the toolbar / title-bar onto the content area so the
        // visual-effect background extends edge-to-edge for a native
        // macOS preferences feel.
        window.setTitlebarAppearsTransparent(true);
        window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
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

    // ---- Form layout: NSGridView per section, NSBox grouping,
    //      NSVisualEffectView background for the native preferences
    //      "liquid glass" look that macOS Tahoe uses on its own
    //      settings panes.
    let debug = openbox_sdk::env::is_debug_mode();

    let outer = NSStackView::new(mtm);
    unsafe {
        outer.setOrientation(NSUserInterfaceLayoutOrientation::Vertical);
        // Stretch each arranged subview to the stack's full width so
        // all section boxes share the same left/right edge instead of
        // each box sizing itself to its content (which produced the
        // ragged look in the prior screenshot).
        outer.setAlignment(NSLayoutAttribute::CenterX);
        outer.setSpacing(18.0);
        // FillEqually would force same-height boxes; Fill lets them
        // size to content while the alignment above pins width.
        outer.setDistribution(NSStackViewDistribution::Fill);
        outer.setEdgeInsets(objc2_foundation::NSEdgeInsets {
            top: 28.0,
            left: 24.0,
            bottom: 24.0,
            right: 24.0,
        });
    }

    // Bind every label up-front so the Retained<NSTextField> handles
    // outlive the `&NSView` references the grid borrows. Without
    // these bindings the temporaries drop at the end of the line and
    // Rust rejects the row tuple.
    let env_form_label = labeled_field(mtm, "Environment");
    let notif_form_label = labeled_field(mtm, "Notify on new approvals");
    let poll_form_label = labeled_field(mtm, "Refresh interval");
    let auth_form_label = labeled_field(mtm, "Auth");
    let org_form_label = labeled_field(mtm, "Org");
    let active_env_form_label = labeled_field(mtm, "Active env");
    let api_url_form_label = labeled_field(mtm, "API URL");

    // Helper: add a box as a full-width arranged subview. Pinning
    // leading and trailing to the outer stack keeps every section
    // edge-aligned regardless of grid content width (the Account
    // section's wider labels would otherwise push it out to the
    // right).
    let outer_view_for_pin: &NSView = as_view(&*outer);
    let pin_full_width = |b: &NSBox| unsafe {
        let v: &NSView = as_view(b);
        v.setTranslatesAutoresizingMaskIntoConstraints(false);
        outer.addArrangedSubview(v);
        use objc2_app_kit::NSLayoutConstraint;
        let leading = v
            .leadingAnchor()
            .constraintEqualToAnchor(&outer_view_for_pin.leadingAnchor());
        let trailing = v
            .trailingAnchor()
            .constraintEqualToAnchor(&outer_view_for_pin.trailingAnchor());
        let cs = NSArray::from_retained_slice(&[leading, trailing]);
        NSLayoutConstraint::activateConstraints(&cs);
    };

    if debug {
        let env_box = section_box(mtm, "Environment");
        let env_grid = form_grid(mtm, &[
            (as_view(&*env_form_label), as_view(&*env_popup)),
        ]);
        set_box_content(&env_box, as_view(&*env_grid));
        pin_full_width(&env_box);
    }

    let notif_box = section_box(mtm, "Notifications");
    let notif_grid = form_grid(mtm, &[
        (as_view(&*notif_form_label), as_view(&*notif_switch)),
    ]);
    set_box_content(&notif_box, as_view(&*notif_grid));
    pin_full_width(&notif_box);

    let poll_box = section_box(mtm, "Polling");
    let poll_grid = form_grid(mtm, &[
        (as_view(&*poll_form_label), as_view(&*poll_segments)),
    ]);
    set_box_content(&poll_box, as_view(&*poll_grid));
    pin_full_width(&poll_box);

    let account_box = section_box(mtm, "Account");
    let mut account_rows: Vec<(&NSView, &NSView)> = vec![
        (as_view(&*auth_form_label), as_view(&*account_email)),
        (as_view(&*org_form_label), as_view(&*account_org)),
    ];
    if debug {
        account_rows.push((as_view(&*active_env_form_label), as_view(&*account_env)));
        account_rows.push((as_view(&*api_url_form_label), as_view(&*account_url)));
    }
    let account_grid = form_grid(mtm, &account_rows);
    set_box_content(&account_box, as_view(&*account_grid));
    pin_full_width(&account_box);

    // Wrap the form in a visual-effect view so the background picks up
    // the macOS window-background material; on Tahoe this surfaces
    // the translucent / liquid-glass look automatically.
    let effect = unsafe {
        let v = NSVisualEffectView::new(mtm);
        v.setMaterial(NSVisualEffectMaterial::WindowBackground);
        v.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        v.setState(NSVisualEffectState::FollowsWindowActiveState);
        v
    };
    // Pin the outer form stack to the four edges of the visual-effect
    // view via Auto Layout. The earlier approach (autoresizing mask +
    // setFrame from a zero-sized parent) left the form floating in the
    // bottom-half of the window.
    unsafe {
        let effect_view: &NSView = as_view(&*effect);
        let outer_view: &NSView = as_view(&*outer);
        outer_view.setTranslatesAutoresizingMaskIntoConstraints(false);
        effect_view.addSubview(outer_view);

        use objc2_app_kit::NSLayoutConstraint;
        let top = outer_view.topAnchor().constraintEqualToAnchor(&effect_view.topAnchor());
        let bottom = outer_view
            .bottomAnchor()
            .constraintEqualToAnchor(&effect_view.bottomAnchor());
        let leading = outer_view
            .leadingAnchor()
            .constraintEqualToAnchor(&effect_view.leadingAnchor());
        let trailing = outer_view
            .trailingAnchor()
            .constraintEqualToAnchor(&effect_view.trailingAnchor());
        let constraints = NSArray::from_retained_slice(&[top, bottom, leading, trailing]);
        NSLayoutConstraint::activateConstraints(&constraints);

        window.setContentView(Some(effect_view));
    }

    // Initialize control values from current settings + the runtime
    // env (which lives on AppState, not in Settings).
    let (snap, current_env) = {
        let s = state.lock().unwrap();
        (s.settings.clone(), s.current_env)
    };
    init_controls(&env_popup, &notif_switch, &poll_segments, &snap, current_env);

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
    current_env: EnvName,
) {
    let env_idx = match current_env {
        EnvName::Production => 0,
        EnvName::Staging => 1,
        EnvName::Local => 2,
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

/// Build a titled `NSBox` matching the look of a macOS preferences
/// section. The box draws its own border + title; callers feed a
/// content view via `set_box_content`. The border is the system
/// `NSBoxType::Primary` style so the material picks up dark / light
/// + Tahoe's translucent glass automatically.
fn section_box(mtm: MainThreadMarker, title: &str) -> Retained<NSBox> {
    let b = NSBox::new(mtm);
    unsafe {
        b.setTitle(&NSString::from_str(title));
        b.setTitlePosition(NSTitlePosition::AtTop);
        b.setBoxType(NSBoxType::Primary);
        let title_font = NSFont::boldSystemFontOfSize(13.0);
        b.setTitleFont(&title_font);
    }
    b
}

fn set_box_content(b: &NSBox, content: &NSView) {
    unsafe {
        b.setContentView(Some(content));
        b.setContentViewMargins(NSSize::new(12.0, 12.0));
    }
}

/// Two-column form layout. Left column is right-aligned labels (the
/// classic macOS preferences "label : control" form), right column
/// is the controls themselves. NSGridView handles row sizing + col
/// alignment automatically without manual constraint math.
fn form_grid(mtm: MainThreadMarker, rows: &[(&NSView, &NSView)]) -> Retained<NSGridView> {
    let grid = NSGridView::new(mtm);
    unsafe {
        grid.setColumnSpacing(12.0);
        grid.setRowSpacing(10.0);
        grid.setRowAlignment(NSGridRowAlignment::FirstBaseline);
        for (label, control) in rows {
            let arr = NSArray::from_slice(&[*label, *control]);
            grid.addRowWithViews(&arr);
        }
        // Right-align the label column.
        let col = grid.columnAtIndex(0);
        col.setXPlacement(NSGridCellPlacement::Trailing);
    }
    grid
}

/// Label styled to match the macOS preferences right-aligned column.
/// Uses the system's standard control text color so dark / light /
/// the Tahoe glass material all render legibly without manual color
/// overrides.
fn labeled_field(mtm: MainThreadMarker, text: &str) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    unsafe {
        label.setSelectable(false);
        label.setAlignment(objc2_app_kit::NSTextAlignment::Right);
    }
    label
}
