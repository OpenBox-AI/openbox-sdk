//! Native macOS tray icon using NSStatusItem + NSMenu directly.
//! Uses a single NSMenu object: only its items are modified, never replaced.

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel, AllocAnyThread};
use objc2_app_kit::{NSImage, NSMenu, NSMenuItem, NSStatusBar, NSVariableStatusItemLength};
use objc2_foundation::{MainThreadMarker, NSData, NSSize, NSString};
use std::sync::{Arc, Mutex, OnceLock};

type ActionCallback = Arc<Mutex<Box<dyn Fn(&str) + Send + 'static>>>;
static CALLBACK: OnceLock<ActionCallback> = OnceLock::new();

fn get_target_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"OBMenuTarget", superclass).unwrap();
        unsafe {
            builder.add_method(
                sel!(menuAction:),
                menu_action as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
        }
        builder.register()
    })
}

unsafe extern "C" fn menu_action(_this: *const AnyObject, _sel: Sel, sender: *const AnyObject) {
    if sender.is_null() { return; }
    unsafe {
        let rep: *const AnyObject = msg_send![sender, representedObject];
        if rep.is_null() { return; }
        let nsstr = &*(rep as *const NSString);
        let id_str = nsstr.to_string();
        if let Some(cb) = CALLBACK.get() {
            if let Ok(f) = cb.lock() {
                f(&id_str);
            }
        }
    }
}

pub struct NativeTray {
    /// The ONE menu: never replaced, only its items are swapped.
    menu: Retained<NSMenu>,
    status_item: Retained<AnyObject>,
    /// True when the tray icon image loaded successfully. When true,
    /// the button title is icon-only (empty) at 0 pending and shows
    /// the pending count otherwise. When false, the icon is missing,
    /// so a literal "OpenBox" label anchors the menu-bar slot to
    /// non-zero width regardless of count.
    image_attached: bool,
    target: Retained<AnyObject>,
    mtm: MainThreadMarker,
}

impl NativeTray {
    pub fn new(icon_bytes: &[u8], tooltip: &str, callback: impl Fn(&str) + Send + 'static) -> Self {
        let _ = CALLBACK.set(Arc::new(Mutex::new(Box::new(callback))));
        let mtm = unsafe { MainThreadMarker::new_unchecked() };

        let target_class = get_target_class();
        let target: Retained<AnyObject> = unsafe { msg_send![target_class, new] };

        unsafe {
            let status_bar = NSStatusBar::systemStatusBar();
            let status_item: Retained<AnyObject> = msg_send![
                &*status_bar, statusItemWithLength: NSVariableStatusItemLength
            ];

            // Set icon
            let mut image_attached = false;
            let data = NSData::with_bytes(icon_bytes);
            if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                image.setTemplate(true);
                image.setSize(NSSize::new(18.0, 18.0));
                let button: Option<Retained<AnyObject>> = msg_send![&status_item, button];
                if let Some(button) = button {
                    let _: () = msg_send![&button, setImage: &*image];
                    image_attached = true;
                }
            }

            // Initial title: empty when the icon loaded (icon-only
            // until we get a pending count from the first poll). If
            // the icon failed to decode we fall back to the "OpenBox"
            // literal so the slot still has visible width — without
            // it, the tray was reported missing on Macs where the
            // template image overflowed the menu-bar notch.
            let button: Option<Retained<AnyObject>> = msg_send![&status_item, button];
            if let Some(button) = button {
                let title = if image_attached { "" } else { "OpenBox" };
                let _: () = msg_send![&button, setTitle: &*NSString::from_str(title)];
                let tip = NSString::from_str(tooltip);
                let _: () = msg_send![&button, setToolTip: &*tip];
            }

            // Create the ONE menu that lives forever
            let menu = NSMenu::new(mtm);
            let _: () = msg_send![&menu, setAutoenablesItems: Bool::NO];

            // Initial items
            Self::add_disabled_item_to(&menu, "OpenBox Approver", mtm);
            menu.addItem(&NSMenuItem::separatorItem(mtm));
            Self::add_disabled_item_to(&menu, "No Pending Approvals", mtm);
            menu.addItem(&NSMenuItem::separatorItem(mtm));
            Self::add_action_item_to(&menu, &target, "Open OpenBox...", "open_window", mtm);
            Self::add_action_item_to(&menu, &target, "Show History...", "show_history", mtm);
            Self::add_action_item_to(&menu, &target, "Settings...", "show_settings", mtm);
            menu.addItem(&NSMenuItem::separatorItem(mtm));
            Self::add_action_item_to(&menu, &target, "Refresh", "refresh", mtm);
            Self::add_action_item_to(&menu, &target, "Quit", "quit", mtm);

            // Set menu ONCE: never called again.
            let _: () = msg_send![&status_item, setMenu: &*menu];

            NativeTray {
                menu,
                status_item,
                image_attached,
                target,
                mtm,
            }
        }
    }

    /// Update menu contents in-place. The NSMenu object stays the same;
    /// if the menu is currently displayed, it updates live without closing.
    ///
    /// `header` is the top disabled menu item — typically the org id
    /// and active env (`Org openbox.local · local`). The approver
    /// authenticates with an org X-API-Key, not a user-bound
    /// credential, so a "Signed in as <email>" line was misleading.
    pub fn update_menu(
        &self,
        header: Option<&str>,
        approvals: &[ApprovalData],
        error: Option<&str>,
    ) {
        let mtm = self.mtm;

        // Sync the button title with the pending count. Icon-only
        // when 0 (icon already conveys "OpenBox"); shows the count
        // alongside the icon when >0 so the menu bar has an at-a-
        // glance signal. Width-anchor concern: when the icon is
        // missing (image_attached==false), keep "OpenBox" as the
        // literal label so the slot does not collapse.
        unsafe {
            let button: Option<Retained<AnyObject>> = msg_send![&self.status_item, button];
            if let Some(button) = button {
                let title = if !self.image_attached {
                    "OpenBox".to_string()
                } else if approvals.is_empty() {
                    String::new()
                } else {
                    format!("{}", approvals.len())
                };
                let _: () = msg_send![&button, setTitle: &*NSString::from_str(&title)];
            }
        }

        // Remove all existing items
        unsafe { let _: () = msg_send![&self.menu, removeAllItems]; }

        // Header. Caller composes the line; this method just renders
        // it. Falls back to the app name when no header is supplied
        // (cold-start, before the first poll resolves the org id).
        let header_text = header.unwrap_or("OpenBox Approver");
        Self::add_disabled_item_to(&self.menu, header_text, mtm);
        self.menu.addItem(&NSMenuItem::separatorItem(mtm));

        // Content
        if let Some(err) = error {
            Self::add_disabled_item_to(&self.menu, &format!("Error: {}", err), mtm);
        } else if approvals.is_empty() {
            Self::add_disabled_item_to(&self.menu, "No Pending Approvals", mtm);
        } else {
            Self::add_disabled_item_to(
                &self.menu,
                &format!("Pending Approvals ({})", approvals.len()),
                mtm,
            );

            for approval in approvals {
                self.menu.addItem(&NSMenuItem::separatorItem(mtm));

                // Agent name plus a source chip as the bold
                // header. The source identifies the originating
                // host (for example `cursor` or `claude-code`)
                // and is omitted when unknown.
                let header = match &approval.source {
                    Some(src) => format!("  [{}] {}", src, approval.agent_name),
                    None => format!("  {}", approval.agent_name),
                };
                Self::add_disabled_item_to(&self.menu, &header, mtm);

                // Details inline, no submenu.
                if !approval.trust_tier.is_empty() || !approval.action_type.is_empty() {
                    let mut detail = String::from("  ");
                    if !approval.trust_tier.is_empty() {
                        detail.push_str(&approval.trust_tier);
                    }
                    if !approval.action_type.is_empty() {
                        if detail.len() > 2 { detail.push_str(" · "); }
                        detail.push_str(&approval.action_type);
                    }
                    Self::add_disabled_item_to(&self.menu, &detail, mtm);
                }
                if !approval.verdict.is_empty() {
                    Self::add_disabled_item_to(&self.menu, &format!("  Verdict: {}", approval.verdict), mtm);
                }
                if !approval.reason.is_empty() {
                    // Truncate long reasons to fit menu width
                    let reason = if approval.reason.len() > 60 {
                        format!("{}...", &approval.reason[..57])
                    } else {
                        approval.reason.clone()
                    };
                    Self::add_disabled_item_to(&self.menu, &format!("  {}", reason), mtm);
                }
                if !approval.time_ago.is_empty() || !approval.expires_in.is_empty() {
                    let mut timing = String::from("  ");
                    if !approval.time_ago.is_empty() {
                        timing.push_str(&approval.time_ago);
                    }
                    if !approval.expires_in.is_empty() {
                        if timing.len() > 2 { timing.push_str(" · "); }
                        timing.push_str(&format!("expires {}", approval.expires_in));
                    }
                    Self::add_disabled_item_to(&self.menu, &timing, mtm);
                }

                // Approve / Reject as top-level clickable items
                Self::add_action_item_to(&self.menu, &self.target, "  ✓ Approve",
                    &format!("approve:{}:{}", approval.agent_id, approval.event_id), mtm);
                Self::add_action_item_to(&self.menu, &self.target, "  ✗ Reject",
                    &format!("reject:{}:{}", approval.agent_id, approval.event_id), mtm);
            }
        }

        // Auxiliary actions (history + settings) sit between the
        // pending list and the operational footer (Refresh / Quit).
        // These open real NSWindow surfaces; menu-bar menus aren't
        // the right place for the search field + filter chips a
        // history view needs.
        self.menu.addItem(&NSMenuItem::separatorItem(mtm));
        Self::add_action_item_to(&self.menu, &self.target, "Open OpenBox...", "open_window", mtm);
        Self::add_action_item_to(&self.menu, &self.target, "Show History...", "show_history", mtm);
        Self::add_action_item_to(&self.menu, &self.target, "Settings...", "show_settings", mtm);

        // Bottom
        self.menu.addItem(&NSMenuItem::separatorItem(mtm));
        Self::add_action_item_to(&self.menu, &self.target, "Refresh", "refresh", mtm);
        Self::add_action_item_to(&self.menu, &self.target, "Quit", "quit", mtm);
    }

    pub fn set_badge(&self, count: usize) {
        unsafe {
            let button: Option<Retained<AnyObject>> = msg_send![&self.status_item, button];
            if let Some(button) = button {
                // Icon-only at 0 pending (the icon already conveys
                // "OpenBox"). Show the count beside the icon when
                // >0 so the menu bar carries an at-a-glance signal.
                // When the icon failed to load, anchor with "OpenBox"
                // so the slot keeps non-zero width on macs that
                // collapse icon-less menu-bar items.
                let text = if !self.image_attached {
                    if count > 0 { format!("OpenBox {}", count) } else { "OpenBox".to_string() }
                } else if count > 0 {
                    format!("{}", count)
                } else {
                    String::new()
                };
                let _: () = msg_send![&button, setTitle: &*NSString::from_str(&text)];
            }
        }
    }

    fn add_disabled_item_to(menu: &NSMenu, title: &str, mtm: MainThreadMarker) {
        let item = NSMenuItem::new(mtm);
        item.setTitle(&NSString::from_str(title));
        item.setEnabled(false);
        menu.addItem(&item);
    }

    fn add_action_item_to(menu: &NSMenu, target: &AnyObject, title: &str, action_id: &str, mtm: MainThreadMarker) {
        let item = NSMenuItem::new(mtm);
        item.setTitle(&NSString::from_str(title));
        item.setEnabled(true);
        unsafe {
            let _: () = msg_send![&item, setTarget: target];
            let _: () = msg_send![&item, setAction: sel!(menuAction:)];
            let id_str = NSString::from_str(action_id);
            let _: () = msg_send![&item, setRepresentedObject: &*id_str];
        }
        menu.addItem(&item);
    }
}

unsafe impl Send for NativeTray {}
unsafe impl Sync for NativeTray {}

pub struct ApprovalData {
    pub agent_name: String,
    pub agent_id: String,
    pub event_id: String,
    pub action_type: String,
    pub verdict: String,
    pub trust_tier: String,
    pub reason: String,
    pub time_ago: String,
    pub expires_in: String,
    /// Originating host (for example `cursor` or `claude-code`).
    /// `None` when the approval's spans carry neither `module` nor
    /// `gen_ai.system`; the approver renders nothing in that case
    /// rather than guessing.
    pub source: Option<String>,
}
