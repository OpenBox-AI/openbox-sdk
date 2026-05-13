//! Unified main window: Pending / History / Settings tabs.
//!
//! Approach: window contains a vertical NSStackView with a header
//! (NSVisualEffectView holding the NSSegmentedControl) and a content
//! container view. The segmented control's action removes the
//! current subview from the content container and inserts the new
//! one, pinned to all four edges. No NSTabView; swapping is direct
//! and the AppKit relationships stay obvious.
//!
//! Materials: the window's content view is an NSVisualEffectView
//! with the `WindowBackground` material so the macOS Tahoe
//! liquid-glass material shows through the entire window. The
//! header strip uses `HeaderView` material so the segmented control
//! sits on a slightly more opaque accent material like System
//! Settings' / Mail's chrome.

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSBackingStoreType, NSButton, NSColor, NSLayoutConstraint,
    NSSegmentedControl, NSSegmentSwitchTracking, NSStackView, NSStackViewDistribution,
    NSTextField, NSUserInterfaceLayoutOrientation, NSView, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowStyleMask, NSWindowTitleVisibility,
};
// macOS 26 Tahoe's `NSGlassEffectView` isn't exposed by
// objc2-app-kit 0.3.2 yet; we look the class up dynamically and
// instantiate via msg_send. On macOS < 26 the class is `NULL` and
// `glass_effect_wrap` falls back to `NSVisualEffectView::HudWindow`
// (the closest visual analogue available pre-Tahoe).
use objc2_foundation::{MainThreadMarker, NSArray, NSPoint, NSRect, NSSize, NSString};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use crate::api::ApiClient;
use crate::{history_window, settings_window, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Pending,
    History,
    Settings,
}

impl Tab {
    fn index(self) -> isize {
        match self {
            Tab::Pending => 0,
            Tab::History => 1,
            Tab::Settings => 2,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Tab::Pending => "Pending",
            Tab::History => "History",
            Tab::Settings => "Settings",
        }
    }
}

struct WindowCtx {
    state: Arc<Mutex<AppState>>,
    wakeup: mpsc::Sender<()>,
    client: Arc<Mutex<Option<ApiClient>>>,
    window: Retained<NSWindow>,
    segments: Retained<NSSegmentedControl>,
    /// View that holds whichever tab content is currently visible.
    /// Each tab content view is created once and parked here.
    content_container: Retained<NSView>,
    pending_view: Retained<NSView>,
    history_view: Retained<NSView>,
    settings_view: Retained<NSView>,
    /// AppKit's `setTarget:` stores a non-retaining pointer to the
    /// target object. We have to keep our own Retained handles for
    /// every target instance we register actions against, or the
    /// objects get dealloced as soon as `build()` returns and the
    /// control's action selector never fires (this manifested as
    /// the segmented-control highlight changing but the tab content
    /// never swapping).
    _selector_targets: Vec<Retained<AnyObject>>,
}

unsafe impl Send for WindowCtx {}
unsafe impl Sync for WindowCtx {}

fn ctx_cell() -> &'static Mutex<Option<WindowCtx>> {
    static CELL: OnceLock<Mutex<Option<WindowCtx>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

pub fn show(
    state: Arc<Mutex<AppState>>,
    wakeup: mpsc::Sender<()>,
    client: Arc<Mutex<Option<ApiClient>>>,
    initial_tab: Tab,
) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let cell = ctx_cell();
    {
        let guard = cell.lock().unwrap();
        if let Some(ctx) = guard.as_ref() {
            unsafe { ctx.segments.setSelectedSegment(initial_tab.index()); }
            switch_to(ctx, initial_tab);
            activate_and_focus(&ctx.window);
            return;
        }
    }
    let ctx = build(mtm, state, wakeup, client);
    {
        let mut guard = cell.lock().unwrap();
        unsafe { ctx.segments.setSelectedSegment(initial_tab.index()); }
        switch_to(&ctx, initial_tab);
        activate_and_focus(&ctx.window);
        *guard = Some(ctx);
    }
}

fn activate_and_focus(window: &NSWindow) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    unsafe {
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        window.makeKeyAndOrderFront(Some(window as &AnyObject));
    }
}

fn switch_to(ctx: &WindowCtx, tab: Tab) {
    let target: &NSView = match tab {
        Tab::Pending => &ctx.pending_view,
        Tab::History => &ctx.history_view,
        Tab::Settings => &ctx.settings_view,
    };
    unsafe {
        // Detach whatever's currently in the container, then attach
        // the new tab view and pin it to all four edges.
        let subviews = ctx.content_container.subviews();
        for v in &subviews {
            v.removeFromSuperview();
        }
        target.setTranslatesAutoresizingMaskIntoConstraints(false);
        ctx.content_container.addSubview(target);
        let cs = NSArray::from_retained_slice(&[
            target
                .topAnchor()
                .constraintEqualToAnchor(&ctx.content_container.topAnchor()),
            target
                .bottomAnchor()
                .constraintEqualToAnchor(&ctx.content_container.bottomAnchor()),
            target
                .leadingAnchor()
                .constraintEqualToAnchor(&ctx.content_container.leadingAnchor()),
            target
                .trailingAnchor()
                .constraintEqualToAnchor(&ctx.content_container.trailingAnchor()),
        ]);
        NSLayoutConstraint::activateConstraints(&cs);
    }
}

fn build(
    mtm: MainThreadMarker,
    state: Arc<Mutex<AppState>>,
    wakeup: mpsc::Sender<()>,
    client: Arc<Mutex<Option<ApiClient>>>,
) -> WindowCtx {
    // Window
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(720.0, 480.0));
    let mask = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Miniaturizable
        | NSWindowStyleMask::Resizable
        | NSWindowStyleMask::FullSizeContentView;
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
        window.setTitle(&NSString::from_str("OpenBox"));
        window.setReleasedWhenClosed(false);
        window.center();
        window.setTitlebarAppearsTransparent(true);
        window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
        window.setMovableByWindowBackground(true);
    }

    // Window-wide backdrop: WindowBackground material picks up the
    // macOS Tahoe liquid-glass look on Tahoe / falls back to the
    // older translucent material on prior systems.
    let backdrop = unsafe {
        let v = NSVisualEffectView::new(mtm);
        v.setMaterial(NSVisualEffectMaterial::WindowBackground);
        v.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        v.setState(NSVisualEffectState::FollowsWindowActiveState);
        v
    };

    // Header (chrome strip with the segmented control).
    let header = unsafe {
        let v = NSVisualEffectView::new(mtm);
        v.setMaterial(NSVisualEffectMaterial::HeaderView);
        v.setBlendingMode(NSVisualEffectBlendingMode::WithinWindow);
        v.setState(NSVisualEffectState::FollowsWindowActiveState);
        v
    };

    let target_class = get_target_class();
    let target: Retained<AnyObject> = unsafe { msg_send![target_class, new] };
    // Tracking starts with the segmented-control target; tab content
    // builders append their own button targets via the shared vector
    // so every NSObject we hand to setTarget: stays alive.
    let mut selector_targets: Vec<Retained<AnyObject>> = vec![target.clone()];
    let labels = NSArray::from_retained_slice(&[
        NSString::from_str(Tab::Pending.label()),
        NSString::from_str(Tab::History.label()),
        NSString::from_str(Tab::Settings.label()),
    ]);
    let segments_any: Retained<AnyObject> = unsafe {
        let cls = AnyClass::get(c"NSSegmentedControl").unwrap();
        msg_send![
            cls,
            segmentedControlWithLabels: &*labels,
            trackingMode: NSSegmentSwitchTracking::SelectOne,
            target: &*target,
            action: sel!(segmentChanged:),
        ]
    };
    let segments: Retained<NSSegmentedControl> = unsafe { Retained::cast_unchecked(segments_any) };
    // Wrap the segmented control in a liquid-glass pill (macOS 26
    // NSGlassEffectView; falls back to HudWindow material pre-Tahoe).
    let segments_view_ref: &NSView = unsafe { cast_segs(&segments) };
    let segments_glass = glass_effect_wrap(mtm, segments_view_ref, 14.0);

    // Build all three tab content views up-front; we keep them in
    // memory and swap which one is in the content container.
    let pending_view = build_pending_content(mtm);
    let history_view = build_history_content(mtm, state.clone(), &mut selector_targets);
    let settings_view = build_settings_content(
        mtm,
        state.clone(),
        wakeup.clone(),
        client.clone(),
        &mut selector_targets,
    );

    // Content container: empty NSView, gets the active tab's view
    // pinned to its edges via `switch_to`.
    let content_container = unsafe {
        let v = NSView::new(mtm);
        v.setTranslatesAutoresizingMaskIntoConstraints(false);
        v
    };

    // Compose: backdrop > [header, content_container].
    let backdrop_view: &NSView = unsafe { cast_view(&backdrop) };
    let header_view: &NSView = unsafe { cast_view(&header) };
    let segs_pill: &NSView = &segments_glass;

    unsafe {
        backdrop_view.setTranslatesAutoresizingMaskIntoConstraints(false);
        header_view.setTranslatesAutoresizingMaskIntoConstraints(false);
        segs_pill.setTranslatesAutoresizingMaskIntoConstraints(false);

        backdrop_view.addSubview(header_view);
        backdrop_view.addSubview(&content_container);
        header_view.addSubview(segs_pill);

        let header_constraints = NSArray::from_retained_slice(&[
            header_view.topAnchor().constraintEqualToAnchor(&backdrop_view.topAnchor()),
            header_view.leadingAnchor().constraintEqualToAnchor(&backdrop_view.leadingAnchor()),
            header_view.trailingAnchor().constraintEqualToAnchor(&backdrop_view.trailingAnchor()),
            header_view.heightAnchor().constraintEqualToConstant(56.0),
        ]);
        NSLayoutConstraint::activateConstraints(&header_constraints);

        let segs_constraints = NSArray::from_retained_slice(&[
            segs_pill.centerXAnchor().constraintEqualToAnchor(&header_view.centerXAnchor()),
            segs_pill.centerYAnchor().constraintEqualToAnchor(&header_view.centerYAnchor()),
        ]);
        NSLayoutConstraint::activateConstraints(&segs_constraints);

        let content_constraints = NSArray::from_retained_slice(&[
            content_container.topAnchor().constraintEqualToAnchor(&header_view.bottomAnchor()),
            content_container.leadingAnchor().constraintEqualToAnchor(&backdrop_view.leadingAnchor()),
            content_container.trailingAnchor().constraintEqualToAnchor(&backdrop_view.trailingAnchor()),
            content_container.bottomAnchor().constraintEqualToAnchor(&backdrop_view.bottomAnchor()),
        ]);
        NSLayoutConstraint::activateConstraints(&content_constraints);

        window.setContentView(Some(backdrop_view));
    }

    WindowCtx {
        state,
        wakeup,
        client,
        window,
        segments,
        content_container,
        pending_view,
        history_view,
        settings_view,
        _selector_targets: selector_targets,
    }
}

// --- Selector target ---

fn get_target_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"OBMainWindowTarget", superclass).unwrap();
        unsafe {
            builder.add_method(
                sel!(segmentChanged:),
                segment_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(openHistory:),
                open_history as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(openSettings:),
                open_settings as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
        }
        builder.register()
    })
}

unsafe extern "C" fn segment_changed(
    _this: *const AnyObject,
    _sel: Sel,
    _sender: *const AnyObject,
) {
    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    let Some(ctx) = guard.as_ref() else { return };
    let idx = unsafe { ctx.segments.selectedSegment() };
    let tab = match idx {
        0 => Tab::Pending,
        1 => Tab::History,
        _ => Tab::Settings,
    };
    switch_to(ctx, tab);
}

unsafe extern "C" fn open_history(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    let Some(ctx) = guard.as_ref() else { return };
    let state_c = ctx.state.clone();
    drop(guard);
    history_window::show(state_c);
}

unsafe extern "C" fn open_settings(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    let Some(ctx) = guard.as_ref() else { return };
    let state_c = ctx.state.clone();
    let wakeup_c = ctx.wakeup.clone();
    let client_c = ctx.client.clone();
    drop(guard);
    settings_window::show(state_c, wakeup_c, client_c);
}

// --- Tab content builders ---

fn build_pending_content(mtm: MainThreadMarker) -> Retained<NSView> {
    let host = unsafe { NSView::new(mtm) };
    let label = NSTextField::labelWithString(
        &NSString::from_str(
            "Pending approvals will appear here.\nThe menu-bar tray shows the same list today; the inline view ships next.",
        ),
        mtm,
    );
    unsafe {
        label.setSelectable(false);
        label.setAlignment(objc2_app_kit::NSTextAlignment::Center);
        let c = NSColor::secondaryLabelColor();
        label.setTextColor(Some(&c));
        let bv: &NSView = unsafe { cast_label(&label) };
        bv.setTranslatesAutoresizingMaskIntoConstraints(false);
        host.addSubview(bv);
        let cs = NSArray::from_retained_slice(&[
            bv.centerXAnchor().constraintEqualToAnchor(&host.centerXAnchor()),
            bv.centerYAnchor().constraintEqualToAnchor(&host.centerYAnchor()),
        ]);
        NSLayoutConstraint::activateConstraints(&cs);
    }
    host
}

fn build_history_content(
    mtm: MainThreadMarker,
    _state: Arc<Mutex<AppState>>,
    selector_targets: &mut Vec<Retained<AnyObject>>,
) -> Retained<NSView> {
    let host = unsafe { NSView::new(mtm) };
    let stack = build_launch_stack(mtm, "Show History", "openHistory:", selector_targets);
    unsafe {
        let sv: &NSView = unsafe { cast_stack(&stack) };
        sv.setTranslatesAutoresizingMaskIntoConstraints(false);
        host.addSubview(sv);
        let cs = NSArray::from_retained_slice(&[
            sv.centerXAnchor().constraintEqualToAnchor(&host.centerXAnchor()),
            sv.centerYAnchor().constraintEqualToAnchor(&host.centerYAnchor()),
        ]);
        NSLayoutConstraint::activateConstraints(&cs);
    }
    host
}

fn build_settings_content(
    mtm: MainThreadMarker,
    _state: Arc<Mutex<AppState>>,
    _wakeup: mpsc::Sender<()>,
    _client: Arc<Mutex<Option<ApiClient>>>,
    selector_targets: &mut Vec<Retained<AnyObject>>,
) -> Retained<NSView> {
    let host = unsafe { NSView::new(mtm) };
    let stack = build_launch_stack(mtm, "Open Settings", "openSettings:", selector_targets);
    unsafe {
        let sv: &NSView = unsafe { cast_stack(&stack) };
        sv.setTranslatesAutoresizingMaskIntoConstraints(false);
        host.addSubview(sv);
        let cs = NSArray::from_retained_slice(&[
            sv.centerXAnchor().constraintEqualToAnchor(&host.centerXAnchor()),
            sv.centerYAnchor().constraintEqualToAnchor(&host.centerYAnchor()),
        ]);
        NSLayoutConstraint::activateConstraints(&cs);
    }
    host
}

fn build_launch_stack(
    mtm: MainThreadMarker,
    button_title: &str,
    action_sel: &str,
    selector_targets: &mut Vec<Retained<AnyObject>>,
) -> Retained<NSStackView> {
    let stack = NSStackView::new(mtm);
    unsafe {
        stack.setOrientation(NSUserInterfaceLayoutOrientation::Vertical);
        stack.setSpacing(12.0);
        stack.setDistribution(NSStackViewDistribution::Fill);
    }

    let caption = NSTextField::labelWithString(
        &NSString::from_str("Open the detailed view in its own window."),
        mtm,
    );
    unsafe {
        caption.setSelectable(false);
        caption.setAlignment(objc2_app_kit::NSTextAlignment::Center);
        let c = NSColor::secondaryLabelColor();
        caption.setTextColor(Some(&c));
    }

    let target_class = get_target_class();
    let btn_target: Retained<AnyObject> = unsafe { msg_send![target_class, new] };
    // setTarget: doesn't retain; keep the target alive by parking
    // it on the long-lived selector_targets vector.
    selector_targets.push(btn_target.clone());
    let btn = unsafe {
        let b = NSButton::new(mtm);
        b.setTitle(&NSString::from_str(button_title));
        b.setBezelStyle(objc2_app_kit::NSBezelStyle::Push);
        let _: () = msg_send![&b, setTarget: &*btn_target];
        // Action name passed as &str; build a Sel from it.
        use objc2::sel;
        let sel_obj = match action_sel {
            "openHistory:" => sel!(openHistory:),
            "openSettings:" => sel!(openSettings:),
            _ => sel!(openHistory:),
        };
        let _: () = msg_send![&b, setAction: sel_obj];
        b
    };

    unsafe {
        let cv: &NSView = unsafe { cast_label(&caption) };
        let bv: &NSView = unsafe { cast_button(&btn) };
        stack.addArrangedSubview(cv);
        stack.addArrangedSubview(bv);
    }
    stack
}

/// Wrap a control in an `NSGlassEffectView` (macOS 26 Tahoe) so it
/// renders inside a liquid-glass pill. Falls back to an
/// `NSVisualEffectView` with `HudWindow` material on older systems.
/// `corner` is the corner-radius for the glass shape.
fn glass_effect_wrap(
    mtm: MainThreadMarker,
    control: &NSView,
    corner: f64,
) -> Retained<NSView> {
    use objc2::runtime::AnyClass;
    if let Some(cls) = AnyClass::get(c"NSGlassEffectView") {
        unsafe {
            let raw: *mut AnyObject = msg_send![cls, alloc];
            let glass: Retained<AnyObject> = Retained::from_raw(msg_send![raw, init]).unwrap();
            let _: () = msg_send![&*glass, setCornerRadius: corner];
            let _: () = msg_send![&*glass, setContentView: control];
            // Cast NSGlassEffectView (subclass of NSView) down to NSView.
            let v: &NSView = &*((&*glass as *const AnyObject) as *const NSView);
            // Hand back a Retained<NSView> that keeps the glass alive.
            // The original `glass` Retained drops here, but the inner
            // pointer is the same NSView identity, so we re-retain.
            let view: Retained<NSView> = Retained::retain(v as *const NSView as *mut NSView).unwrap();
            return view;
        }
    }
    // Pre-Tahoe fallback: HudWindow material gives a similar
    // floating-glass look on older macOS.
    let v = unsafe {
        let v = NSVisualEffectView::new(mtm);
        v.setMaterial(NSVisualEffectMaterial::HUDWindow);
        v.setBlendingMode(NSVisualEffectBlendingMode::WithinWindow);
        v.setState(NSVisualEffectState::FollowsWindowActiveState);
        v.setWantsLayer(true);
        let layer: *mut AnyObject = msg_send![&v, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setCornerRadius: corner];
        }
        v
    };
    unsafe {
        let backdrop: &NSView = cast_view(&v);
        control.setTranslatesAutoresizingMaskIntoConstraints(false);
        backdrop.addSubview(control);
        let cs = NSArray::from_retained_slice(&[
            control
                .topAnchor()
                .constraintEqualToAnchor(&backdrop.topAnchor())
                .let_pin(2.0),
            control
                .bottomAnchor()
                .constraintEqualToAnchor(&backdrop.bottomAnchor())
                .let_pin(-2.0),
            control
                .leadingAnchor()
                .constraintEqualToAnchor(&backdrop.leadingAnchor())
                .let_pin(6.0),
            control
                .trailingAnchor()
                .constraintEqualToAnchor(&backdrop.trailingAnchor())
                .let_pin(-6.0),
        ]);
        NSLayoutConstraint::activateConstraints(&cs);
        Retained::retain(backdrop as *const NSView as *mut NSView).unwrap()
    }
}

// Helper extension to attach a constant to a constraint inline.
trait PinExt {
    fn let_pin(self, c: f64) -> Self;
}
impl PinExt for Retained<NSLayoutConstraint> {
    fn let_pin(self, c: f64) -> Self {
        unsafe {
            self.setConstant(c);
        }
        self
    }
}

// --- View casts (objc2 doesn't auto-deref Retained<Class> -> &NSView) ---

unsafe fn cast_view(v: &Retained<NSVisualEffectView>) -> &NSView {
    unsafe { &*(&**v as *const NSVisualEffectView as *const NSView) }
}
unsafe fn cast_segs(v: &Retained<NSSegmentedControl>) -> &NSView {
    unsafe { &*(&**v as *const NSSegmentedControl as *const NSView) }
}
unsafe fn cast_label(v: &Retained<NSTextField>) -> &NSView {
    unsafe { &*(&**v as *const NSTextField as *const NSView) }
}
unsafe fn cast_button(v: &Retained<NSButton>) -> &NSView {
    unsafe { &*(&**v as *const NSButton as *const NSView) }
}
unsafe fn cast_stack(v: &Retained<NSStackView>) -> &NSView {
    unsafe { &*(&**v as *const NSStackView as *const NSView) }
}
