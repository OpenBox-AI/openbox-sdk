//! Native history window: NSWindow with a top NSSegmentedControl
//! (Approved / Rejected / Expired), an NSSearchField, a row of
//! NSPopUpButton filter chips (tier, type, date range), an
//! NSTableView inside an NSScrollView, and a "Clear filters" button.
//! No webview, no HTML; every control is a real AppKit instance.
//!
//! Data flow: when the segment changes, kick a refetch on a
//! background thread (via `tauri::AppHandle::run_on_main_thread`
//! plumbing; here we hold the same Tokio runtime the polling thread
//! does). Cache the most recent set of rows for the active segment
//! plus a 30s TTL; the search field and filter chips re-filter
//! locally without re-hitting the backend, so typing in the search
//! box stays responsive even on a slow link.

#![allow(dead_code, unused_unsafe)]

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, ProtocolObject, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSImage, NSImageSymbolConfiguration, NSImageView,
    NSPopUpButton, NSScrollView, NSSearchField, NSSegmentSwitchTracking,
    NSSegmentedControl, NSStackView, NSStackViewDistribution, NSTableColumn, NSTableView,
    NSTableViewDataSource, NSTableViewDelegate, NSTextField, NSUserInterfaceItemIdentifier,
    NSUserInterfaceLayoutOrientation, NSView, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSInteger, NSPoint, NSRect, NSSize, NSString,
};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use openbox_sdk::approvals::format::{format_label, time_ago};

use crate::api;
use crate::AppState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoryStatus {
    Approved,
    Rejected,
    Expired,
}

impl HistoryStatus {
    fn wire(&self) -> &'static str {
        match self {
            HistoryStatus::Approved => "approved",
            HistoryStatus::Rejected => "rejected",
            HistoryStatus::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone)]
pub struct HistoryRow {
    pub agent: String,
    pub action: String,
    pub tier: Option<i32>,
    pub reason: String,
    pub decided_at_text: String,
    /// Raw RFC-3339 timestamp the row was bucketed by (decided_at when
    /// available, else created_at). Kept alongside the formatted
    /// `decided_at_text` so the date-range chip can do an actual
    /// comparison against `chrono::Utc::now()` instead of pattern-
    /// matching the relative-time string.
    pub decided_at_iso: Option<String>,
    pub status: String,
    // Lower-case copies kept for case-insensitive substring search.
    agent_lc: String,
    reason_lc: String,
}

impl HistoryRow {
    fn from_approval(a: &api::Approval, status: &HistoryStatus) -> Self {
        let agent = a
            .agent
            .as_ref()
            .map(|ag| ag.agent_name.clone())
            .unwrap_or_else(|| "Unknown Agent".into());
        let action = a
            .activity_type
            .as_deref()
            .map(format_label)
            .unwrap_or_default();
        let tier = a.metadata.as_ref().and_then(|m| m.trust_tier);
        let reason = a.reason.clone().unwrap_or_default();
        let decided_at_iso = a
            .decided_at
            .clone()
            .or_else(|| a.created_at.clone());
        let decided_at_text = decided_at_iso
            .as_deref()
            .map(time_ago)
            .unwrap_or_default();
        let status_text = match status {
            HistoryStatus::Approved => "Approved",
            HistoryStatus::Rejected => "Rejected",
            HistoryStatus::Expired => "Expired",
        }
        .to_string();
        let agent_lc = agent.to_lowercase();
        let reason_lc = reason.to_lowercase();
        HistoryRow {
            agent,
            action,
            tier,
            reason,
            decided_at_text,
            decided_at_iso,
            status: status_text,
            agent_lc,
            reason_lc,
        }
    }
}

#[derive(Debug, Clone)]
pub enum DateRange {
    AllTime,
    Today,
    Last7,
    Last30,
}

#[derive(Debug, Clone)]
pub struct Filters {
    pub search: String,
    pub tier: Option<i32>,
    pub action_type: Option<String>,
    pub date_range: DateRange,
}

impl Default for Filters {
    fn default() -> Self {
        Filters {
            search: String::new(),
            tier: None,
            action_type: None,
            date_range: DateRange::AllTime,
        }
    }
}

/// Pure filter logic; tested in isolation. Date-range chip is
/// evaluated against the row's stored RFC-3339 `decided_at_iso`. A
/// row whose timestamp is missing or unparseable passes through the
/// date filter when the user picked AllTime, and is dropped for any
/// other date selection (we can't bucket what we can't parse).
pub fn matches(row: &HistoryRow, f: &Filters) -> bool {
    matches_at(row, f, chrono::Utc::now())
}

/// Same as [`matches`], but lets the caller pin the "now" anchor.
/// The production code path always passes `Utc::now()`; tests pass a
/// fixed instant so boundary cases (`Today` at midnight rollover,
/// `Last 7` at exactly 7d ago, etc.) are deterministic. Splitting the
/// helper out keeps the production call sites a single arg call while
/// still letting tests skip the wall-clock dependency.
pub fn matches_at(
    row: &HistoryRow,
    f: &Filters,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    let q = f.search.trim().to_lowercase();
    if !q.is_empty() && !row.agent_lc.contains(&q) && !row.reason_lc.contains(&q) {
        return false;
    }
    if let Some(t) = f.tier {
        if row.tier != Some(t) {
            return false;
        }
    }
    if let Some(at) = &f.action_type {
        if !at.is_empty() && row.action != *at {
            return false;
        }
    }
    if !date_range_matches(row.decided_at_iso.as_deref(), &f.date_range, now) {
        return false;
    }
    true
}

/// Compare `iso` against the chip-selected window. AllTime always
/// passes; the bounded chips compare seconds-since-epoch against
/// `now` and require a parseable timestamp. Today is "since the most
/// recent UTC midnight"; Last7 / Last30 are "within the last N*86400
/// seconds" (rolling window, not calendar days). The rolling-window
/// choice mirrors what the iOS app does and avoids surprises around
/// timezone offsets.
pub fn date_range_matches(
    iso: Option<&str>,
    range: &DateRange,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    if matches!(range, DateRange::AllTime) {
        return true;
    }
    let Some(s) = iso else {
        return false;
    };
    let Ok(ts) = chrono::DateTime::parse_from_rfc3339(s) else {
        return false;
    };
    let ts_utc = ts.with_timezone(&chrono::Utc);
    match range {
        DateRange::AllTime => true,
        DateRange::Today => {
            // Most-recent UTC midnight as a `DateTime<Utc>`.
            let day = now.date_naive().and_hms_opt(0, 0, 0).unwrap();
            let midnight = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
                day,
                chrono::Utc,
            );
            ts_utc >= midnight && ts_utc <= now
        }
        DateRange::Last7 => {
            let cutoff = now - chrono::Duration::days(7);
            ts_utc >= cutoff && ts_utc <= now
        }
        DateRange::Last30 => {
            let cutoff = now - chrono::Duration::days(30);
            ts_utc >= cutoff && ts_utc <= now
        }
    }
}

/// Trust-tier color tokens for the history table's Tier column.
/// Mirrors `ts/src/approvals/tier.ts` so the approver's shield matches
/// the iOS card and the VS Code panel. Tier 4+ green (low risk),
/// 3 blue (default brand), 2 orange (caution), 1 red (high risk),
/// missing/unknown gray. Returns an `NSColor` rather than a hex
/// string because the only consumer here hands it to
/// `NSImageSymbolConfiguration::configurationWithHierarchicalColor`.
fn tier_color(tier: Option<i32>) -> Retained<NSColor> {
    unsafe {
        match tier {
            Some(t) if t >= 4 => NSColor::systemGreenColor(),
            Some(3) => NSColor::systemBlueColor(),
            Some(2) => NSColor::systemOrangeColor(),
            Some(1) => NSColor::systemRedColor(),
            _ => NSColor::systemGrayColor(),
        }
    }
}

/// Distinct action-type labels in display order. Used to populate
/// the "Type" filter chip from the loaded data.
pub fn distinct_actions(rows: &[HistoryRow]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for r in rows {
        if !r.action.is_empty() && seen.insert(r.action.clone()) {
            out.push(r.action.clone());
        }
    }
    out.sort();
    out
}

struct HistoryCtx {
    window: Retained<NSWindow>,
    table: Retained<NSTableView>,
    search: Retained<NSSearchField>,
    segment: Retained<NSSegmentedControl>,
    tier_popup: Retained<NSPopUpButton>,
    type_popup: Retained<NSPopUpButton>,
    date_popup: Retained<NSPopUpButton>,
    state: Arc<Mutex<AppState>>,
    rows: Arc<Mutex<Vec<HistoryRow>>>,
    filtered: Arc<Mutex<Vec<HistoryRow>>>,
    filters: Arc<Mutex<Filters>>,
    current_status: Arc<Mutex<HistoryStatus>>,
    last_fetch: Arc<Mutex<Option<Instant>>>,
    data_source: Retained<AnyObject>,
}

unsafe impl Send for HistoryCtx {}
unsafe impl Sync for HistoryCtx {}

struct UnsafeStatic<T>(T);
unsafe impl<T> Send for UnsafeStatic<T> {}
unsafe impl<T> Sync for UnsafeStatic<T> {}

static CTX: OnceLock<UnsafeStatic<Mutex<Option<HistoryCtx>>>> = OnceLock::new();

fn ctx_cell() -> &'static Mutex<Option<HistoryCtx>> {
    &CTX.get_or_init(|| UnsafeStatic(Mutex::new(None))).0
}

static TARGET_HOLD: OnceLock<UnsafeStatic<Mutex<Vec<Retained<AnyObject>>>>> = OnceLock::new();
fn hold_target(t: Retained<AnyObject>) {
    let cell = TARGET_HOLD.get_or_init(|| UnsafeStatic(Mutex::new(Vec::new())));
    cell.0.lock().unwrap().push(t);
}

// ---------- NSTableViewDataSource impl (manual) ----------
//
// `define_class!` can't encode the return type of
// `tableView:objectValueForTableColumn:row:` (which is
// `Option<Retained<AnyObject>>`), because `AnyObject` doesn't
// implement `Encode`. We hand-roll the class with `ClassBuilder`
// and unsafe extern "C" methods. The class has no instance state;
// all data flows through the static `CTX` cell.

fn get_data_source_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"OBHistoryDataSource", superclass).unwrap();
        unsafe {
            builder.add_method(
                sel!(numberOfRowsInTableView:),
                number_of_rows
                    as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject) -> NSInteger,
            );
            builder.add_method(
                sel!(tableView:objectValueForTableColumn:row:),
                object_value
                    as unsafe extern "C" fn(
                        *const AnyObject,
                        Sel,
                        *const AnyObject,
                        *const AnyObject,
                        NSInteger,
                    ) -> *mut AnyObject,
            );
        }
        builder.register()
    })
}

unsafe extern "C" fn number_of_rows(
    _this: *const AnyObject,
    _sel: Sel,
    _table: *const AnyObject,
) -> NSInteger {
    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    if let Some(ctx) = guard.as_ref() {
        ctx.filtered.lock().unwrap().len() as NSInteger
    } else {
        0
    }
}

// ---------- NSTableViewDelegate impl (view-based for the tier
// column, plain text elsewhere) ----------
//
// The Tier column gets a colored shield SF Symbol next to the tier
// number, matching the iOS app's `tierColor` mapping. Every other
// column hands back a plain NSTextField, which is what AppKit would
// have created automatically. We can't rely on the auto-created
// NSTableCellView because we never wired up Interface Builder; this
// delegate is the smallest path to a custom view per row.
fn get_delegate_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"OBHistoryDelegate", superclass).unwrap();
        unsafe {
            builder.add_method(
                sel!(tableView:viewForTableColumn:row:),
                view_for_column
                    as unsafe extern "C" fn(
                        *const AnyObject,
                        Sel,
                        *const AnyObject,
                        *const AnyObject,
                        NSInteger,
                    ) -> *mut AnyObject,
            );
        }
        builder.register()
    })
}

unsafe extern "C" fn view_for_column(
    _this: *const AnyObject,
    _sel: Sel,
    _table: *const AnyObject,
    column: *const AnyObject,
    row: NSInteger,
) -> *mut AnyObject {
    if column.is_null() {
        return std::ptr::null_mut();
    }
    let ident_obj: *const AnyObject = unsafe { msg_send![column, identifier] };
    if ident_obj.is_null() {
        return std::ptr::null_mut();
    }
    let id_str = unsafe { (&*(ident_obj as *const NSString)).to_string() };

    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    let Some(ctx) = guard.as_ref() else { return std::ptr::null_mut() };
    let rows = ctx.filtered.lock().unwrap();
    let Some(r) = rows.get(row as usize) else { return std::ptr::null_mut() };
    let r = r.clone();
    drop(rows);
    drop(guard);

    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    if id_str == "tier" {
        let view = build_tier_cell(mtm, r.tier);
        let ptr: *mut AnyObject =
            Retained::autorelease_return(view) as *mut AnyObject;
        return ptr;
    }

    let text = match id_str.as_str() {
        "agent" => r.agent,
        "action" => r.action,
        "reason" => r.reason,
        "decided" => r.decided_at_text,
        "status" => r.status,
        _ => String::new(),
    };
    let tf = NSTextField::labelWithString(&NSString::from_str(&text), mtm);
    unsafe {
        tf.setSelectable(false);
    }
    let ptr: *mut AnyObject = Retained::autorelease_return(tf) as *mut AnyObject;
    ptr
}

/// Build the tier-column cell: a horizontal NSStackView with a small
/// colored shield NSImageView followed by the tier number ("1", "2",
/// etc.) in a plain NSTextField. The shield is `shield.fill` from the
/// SF Symbols catalog, tinted via
/// `NSImageSymbolConfiguration::configurationWithHierarchicalColor`
/// so the symbol picks up its system-aware fill plus the optional
/// secondary stroke. A `None` tier collapses to a gray shield with no
/// number, matching the empty-string behavior the cell-based path
/// used to render.
fn build_tier_cell(mtm: MainThreadMarker, tier: Option<i32>) -> Retained<NSStackView> {
    let stack = NSStackView::new(mtm);
    unsafe {
        stack.setOrientation(NSUserInterfaceLayoutOrientation::Horizontal);
        stack.setSpacing(4.0);
        stack.setAlignment(objc2_app_kit::NSLayoutAttribute::CenterY);
    }

    let symbol_name = NSString::from_str("shield.fill");
    let raw_image = unsafe {
        NSImage::imageWithSystemSymbolName_accessibilityDescription(&symbol_name, None)
    };
    if let Some(img) = raw_image {
        let color = tier_color(tier);
        let cfg = unsafe {
            NSImageSymbolConfiguration::configurationWithHierarchicalColor(&color)
        };
        let tinted = unsafe { img.imageWithSymbolConfiguration(&cfg) }.unwrap_or(img);
        let iv = unsafe { NSImageView::imageViewWithImage(&tinted, mtm) };
        unsafe {
            stack.addArrangedSubview(as_view(&*iv));
        }
    }

    let label_text = match tier {
        Some(t) => format!("{}", t),
        None => String::new(),
    };
    let tf = NSTextField::labelWithString(&NSString::from_str(&label_text), mtm);
    unsafe {
        tf.setSelectable(false);
        stack.addArrangedSubview(as_view(&*tf));
    }
    stack
}

unsafe extern "C" fn object_value(
    _this: *const AnyObject,
    _sel: Sel,
    _table: *const AnyObject,
    column: *const AnyObject,
    row: NSInteger,
) -> *mut AnyObject {
    if column.is_null() {
        return std::ptr::null_mut();
    }
    let ident_obj: *const AnyObject = unsafe { msg_send![column, identifier] };
    if ident_obj.is_null() {
        return std::ptr::null_mut();
    }
    let id_str = unsafe { (&*(ident_obj as *const NSString)).to_string() };

    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    let Some(ctx) = guard.as_ref() else { return std::ptr::null_mut() };
    let rows = ctx.filtered.lock().unwrap();
    let Some(r) = rows.get(row as usize) else { return std::ptr::null_mut() };
    let text = match id_str.as_str() {
        "agent" => r.agent.clone(),
        "action" => r.action.clone(),
        "tier" => r.tier.map(|t| format!("Tier {t}")).unwrap_or_default(),
        "reason" => r.reason.clone(),
        "decided" => r.decided_at_text.clone(),
        "status" => r.status.clone(),
        _ => String::new(),
    };
    let s = NSString::from_str(&text);
    // Return autoreleased so AppKit retains via the property-list
    // coercion path; matching the typical objc objectValue:
    // contract.
    let ptr: *mut AnyObject = Retained::autorelease_return(s) as *mut AnyObject;
    ptr
}

// ---------- Action target ----------

fn get_action_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").unwrap();
        let mut builder = ClassBuilder::new(c"OBHistoryActions", superclass).unwrap();
        unsafe {
            builder.add_method(
                sel!(segmentChanged:),
                segment_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(searchChanged:),
                search_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(tierChanged:),
                tier_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(typeChanged:),
                type_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(dateChanged:),
                date_changed as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
            builder.add_method(
                sel!(clearFilters:),
                clear_filters as unsafe extern "C" fn(*const AnyObject, Sel, *const AnyObject),
            );
        }
        builder.register()
    })
}

unsafe extern "C" fn segment_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    let new_status = with_ctx(|ctx| {
        let idx = unsafe { ctx.segment.selectedSegment() };
        let s = match idx {
            0 => HistoryStatus::Approved,
            1 => HistoryStatus::Rejected,
            _ => HistoryStatus::Expired,
        };
        *ctx.current_status.lock().unwrap() = s.clone();
        *ctx.last_fetch.lock().unwrap() = None; // force refetch
        s
    });
    if let Some(s) = new_status {
        kick_refetch(s);
    }
}

unsafe extern "C" fn search_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let s = unsafe { ctx.search.stringValue() };
        ctx.filters.lock().unwrap().search = s.to_string();
        recompute_filtered(ctx);
        unsafe { ctx.table.reloadData() };
    });
}

unsafe extern "C" fn tier_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let idx = unsafe { ctx.tier_popup.indexOfSelectedItem() };
        ctx.filters.lock().unwrap().tier = match idx {
            0 => None,
            n => Some(n as i32),
        };
        recompute_filtered(ctx);
        unsafe { ctx.table.reloadData() };
    });
}

unsafe extern "C" fn type_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let title_opt = unsafe { ctx.type_popup.titleOfSelectedItem() };
        let v = title_opt.map(|s| s.to_string()).unwrap_or_default();
        ctx.filters.lock().unwrap().action_type = if v.is_empty() || v == "All" { None } else { Some(v) };
        recompute_filtered(ctx);
        unsafe { ctx.table.reloadData() };
    });
}

unsafe extern "C" fn date_changed(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        let idx = unsafe { ctx.date_popup.indexOfSelectedItem() };
        ctx.filters.lock().unwrap().date_range = match idx {
            0 => DateRange::AllTime,
            1 => DateRange::Today,
            2 => DateRange::Last7,
            _ => DateRange::Last30,
        };
        recompute_filtered(ctx);
        unsafe { ctx.table.reloadData() };
    });
}

unsafe extern "C" fn clear_filters(_this: *const AnyObject, _sel: Sel, _sender: *const AnyObject) {
    with_ctx(|ctx| {
        *ctx.filters.lock().unwrap() = Filters::default();
        unsafe {
            ctx.search.setStringValue(&NSString::from_str(""));
            ctx.tier_popup.selectItemAtIndex(0);
            ctx.type_popup.selectItemAtIndex(0);
            ctx.date_popup.selectItemAtIndex(0);
        }
        recompute_filtered(ctx);
        unsafe { ctx.table.reloadData() };
    });
}

fn with_ctx<F: FnOnce(&HistoryCtx) -> R, R>(f: F) -> Option<R> {
    let cell = ctx_cell();
    let guard = cell.lock().unwrap();
    guard.as_ref().map(f)
}

fn recompute_filtered(ctx: &HistoryCtx) {
    let rows = ctx.rows.lock().unwrap().clone();
    let filters = ctx.filters.lock().unwrap().clone();
    let out: Vec<HistoryRow> = rows.into_iter().filter(|r| matches(r, &filters)).collect();
    *ctx.filtered.lock().unwrap() = out;
}

fn rebuild_type_popup(ctx: &HistoryCtx) {
    let rows = ctx.rows.lock().unwrap().clone();
    let actions = distinct_actions(&rows);
    unsafe {
        ctx.type_popup.removeAllItems();
        ctx.type_popup.addItemWithTitle(&NSString::from_str("All"));
        for a in actions {
            ctx.type_popup.addItemWithTitle(&NSString::from_str(&a));
        }
        ctx.type_popup.selectItemAtIndex(0);
    }
    ctx.filters.lock().unwrap().action_type = None;
}

fn kick_refetch(status: HistoryStatus) {
    // Clone what the worker thread needs out of the static, then run
    // the SDK call off-main. The polling thread already holds an
    // ApiClient but it's owned over there; building a fresh one
    // keeps this reload loop independent of the polling cadence.
    let (org_id, env) = match with_ctx(|ctx| {
        let s = ctx.state.lock().unwrap();
        (s.org_id.clone(), s.current_env)
    }) {
        Some(v) => v,
        None => return,
    };
    let org_id = match org_id {
        Some(o) => o,
        None => return,
    };

    thread::spawn(move || {
        let client = match api::ApiClient::for_env(env) {
            Ok(c) => c,
            Err(_) => return,
        };
        let approvals = client.list_decided(&org_id, status.wire()).unwrap_or_default();
        let new_rows: Vec<HistoryRow> = approvals
            .iter()
            .map(|a| HistoryRow::from_approval(a, &status))
            .collect();

        // Push the new rows back to the UI on main.
        let cell = ctx_cell();
        // We can't call the AppKit reload from here safely, so we
        // dispatch via the main run loop. tauri's app handle isn't
        // accessible from this thread without plumbing; instead we
        // use Grand Central Dispatch via msg_send.
        let mtm_main = unsafe { MainThreadMarker::new_unchecked() };
        let _ = mtm_main; // type-only marker

        // Use dispatch_async on the main queue via libdispatch through
        // the Cocoa NSOperationQueue.
        let block = move || {
            let guard = cell.lock().unwrap();
            if let Some(ctx) = guard.as_ref() {
                *ctx.rows.lock().unwrap() = new_rows.clone();
                *ctx.last_fetch.lock().unwrap() = Some(Instant::now());
                rebuild_type_popup(ctx);
                recompute_filtered(ctx);
                unsafe { ctx.table.reloadData() };
            }
        };
        run_on_main(block);
    });
}

fn run_on_main<F: FnOnce() + Send + 'static>(f: F) {
    use objc2_foundation::NSOperationQueue;
    use block2::RcBlock;
    use std::cell::Cell;
    use std::rc::Rc;
    // `addOperationWithBlock:` retains its block and may invoke it
    // any number of times in principle, but for the main-queue fast
    // path it always fires exactly once. block2 still demands `Fn`
    // at the type level, so we wrap a one-shot in an Option behind
    // a `Cell` and panic if the block is somehow invoked twice; in
    // practice that contradiction has never been observed against
    // NSOperationQueue.
    let slot: Rc<Cell<Option<F>>> = Rc::new(Cell::new(Some(f)));
    let block = RcBlock::new(move || {
        if let Some(f) = slot.take() {
            f();
        }
    });
    unsafe {
        let q = NSOperationQueue::mainQueue();
        q.addOperationWithBlock(&block);
    }
}

// ---------- Helpers ----------

fn as_view(p: &impl objc2::Message) -> &NSView {
    unsafe { &*(p as *const _ as *const NSView) }
}

fn label(mtm: MainThreadMarker, text: &str) -> Retained<NSTextField> {
    let f = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    f.setSelectable(false);
    f
}

fn make_popup(
    mtm: MainThreadMarker,
    target: &AnyObject,
    sel: Sel,
    items: &[&str],
) -> Retained<NSPopUpButton> {
    let p = NSPopUpButton::new(mtm);
    unsafe {
        for it in items {
            p.addItemWithTitle(&NSString::from_str(it));
        }
        let _: () = msg_send![&p, setTarget: target];
        let _: () = msg_send![&p, setAction: sel];
        p.selectItemAtIndex(0);
    }
    p
}

fn make_button(
    mtm: MainThreadMarker,
    target: &AnyObject,
    sel: Sel,
    title: &str,
) -> Retained<objc2_app_kit::NSButton> {
    use objc2_app_kit::NSButton;
    let b = unsafe {
        NSButton::buttonWithTitle_target_action(
            &NSString::from_str(title),
            Some(target),
            Some(sel),
            mtm,
        )
    };
    b
}

// ---------- Public API ----------

/// Show the history window. Builds it lazily on first call and
/// re-uses the same NSWindow on subsequent calls. Must be invoked on
/// the AppKit main thread.
pub fn show(state: Arc<Mutex<AppState>>) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let cell = ctx_cell();
    {
        let guard = cell.lock().unwrap();
        if let Some(ctx) = guard.as_ref() {
            activate_and_focus(&ctx.window);
            // Fire a refetch on re-show; cached rows might be stale.
            let status = ctx.current_status.lock().unwrap().clone();
            drop(guard);
            kick_refetch(status);
            return;
        }
    }
    let ctx = build(mtm, state);
    let initial_status = ctx.current_status.lock().unwrap().clone();
    {
        let mut guard = cell.lock().unwrap();
        activate_and_focus(&ctx.window);
        *guard = Some(ctx);
    }
    kick_refetch(initial_status);
}

/// Bring the app to the foreground and focus the given window. Same
/// rationale as `settings_window::activate_and_focus` — accessory-
/// policy apps don't grab focus on `makeKeyAndOrderFront` alone.
fn activate_and_focus(window: &NSWindow) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = objc2_app_kit::NSApplication::sharedApplication(mtm);
    unsafe {
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        window.makeKeyAndOrderFront(Some(window as &AnyObject));
    }
}

fn build(mtm: MainThreadMarker, state: Arc<Mutex<AppState>>) -> HistoryCtx {
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(900.0, 600.0));
    let mask = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Resizable
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
        window.setTitle(&NSString::from_str("OpenBox Approver History"));
        window.setReleasedWhenClosed(false);
        window.center();
    }

    let target_class = get_action_class();
    let target: Retained<AnyObject> = unsafe { msg_send![target_class, new] };

    // Top segmented control.
    let seg_labels = NSArray::from_retained_slice(&[
        NSString::from_str("Approved"),
        NSString::from_str("Rejected"),
        NSString::from_str("Expired"),
    ]);
    let segment_any: Retained<AnyObject> = unsafe {
        let cls = AnyClass::get(c"NSSegmentedControl").unwrap();
        msg_send![
            cls,
            segmentedControlWithLabels: &*seg_labels,
            trackingMode: NSSegmentSwitchTracking::SelectOne,
            target: &*target,
            action: sel!(segmentChanged:),
        ]
    };
    let segment: Retained<NSSegmentedControl> =
        unsafe { Retained::cast_unchecked(segment_any) };
    unsafe { segment.setSelectedSegment(0) };

    // Search field.
    let search = NSSearchField::new(mtm);
    unsafe {
        let _: () = msg_send![&search, setTarget: &*target];
        let _: () = msg_send![&search, setAction: sel!(searchChanged:)];
        let _: () = msg_send![&search, setPlaceholderString: &*NSString::from_str("Search agent or reason")];
    }

    // Filter chip popups.
    let tier_popup = make_popup(mtm, &target, sel!(tierChanged:), &[
        "All tiers", "Tier 1", "Tier 2", "Tier 3", "Tier 4",
    ]);
    let type_popup = make_popup(mtm, &target, sel!(typeChanged:), &["All"]);
    let date_popup = make_popup(mtm, &target, sel!(dateChanged:), &[
        "All time", "Today", "Last 7 days", "Last 30 days",
    ]);
    let clear_btn = make_button(mtm, &target, sel!(clearFilters:), "Clear filters");

    let chip_row = NSStackView::new(mtm);
    unsafe {
        chip_row.setOrientation(NSUserInterfaceLayoutOrientation::Horizontal);
        chip_row.setSpacing(8.0);
        chip_row.addArrangedSubview(as_view(&*tier_popup));
        chip_row.addArrangedSubview(as_view(&*type_popup));
        chip_row.addArrangedSubview(as_view(&*date_popup));
        chip_row.addArrangedSubview(as_view(&*clear_btn));
    }

    // Table + columns. Row height bumped from 22pt to 24pt so the
    // colored shield + tier number stack reads at native SF Symbol
    // size without the bottom of the symbol being clipped.
    let table = NSTableView::new(mtm);
    unsafe {
        table.setUsesAlternatingRowBackgroundColors(true);
        table.setRowHeight(24.0);
    }
    add_column(&table, "agent", "Agent", 160.0);
    add_column(&table, "action", "Action", 160.0);
    add_column(&table, "tier", "Tier", 80.0);
    add_column(&table, "reason", "Reason", 240.0);
    add_column(&table, "decided", "Decided", 120.0);
    add_column(&table, "status", "Status", 90.0);

    let data_source: Retained<AnyObject> = unsafe {
        let cls = get_data_source_class();
        msg_send![cls, new]
    };
    unsafe {
        let proto: *const ProtocolObject<dyn NSTableViewDataSource> =
            &*data_source as *const AnyObject as *const ProtocolObject<dyn NSTableViewDataSource>;
        table.setDataSource(Some(&*proto));
    }

    // View-based delegate: returns the colored-shield NSImageView for
    // the Tier column and a plain NSTextField for the rest. Keeping
    // the `objectValue` data source live as a fallback gives AppKit a
    // string for any path (sorting, accessibility) that asks for the
    // raw cell value.
    let delegate: Retained<AnyObject> = unsafe {
        let cls = get_delegate_class();
        msg_send![cls, new]
    };
    unsafe {
        let proto: *const ProtocolObject<dyn NSTableViewDelegate> =
            &*delegate as *const AnyObject as *const ProtocolObject<dyn NSTableViewDelegate>;
        table.setDelegate(Some(&*proto));
    }
    hold_target(delegate);

    let scroll = NSScrollView::new(mtm);
    unsafe {
        scroll.setHasVerticalScroller(true);
        scroll.setHasHorizontalScroller(true);
        scroll.setDocumentView(Some(as_view(&*table)));
    }

    // Vertical container.
    let stack = NSStackView::new(mtm);
    unsafe {
        stack.setOrientation(NSUserInterfaceLayoutOrientation::Vertical);
        stack.setAlignment(objc2_app_kit::NSLayoutAttribute::Leading);
        stack.setSpacing(8.0);
        stack.setDistribution(NSStackViewDistribution::Fill);
        stack.setEdgeInsets(objc2_foundation::NSEdgeInsets {
            top: 12.0,
            left: 12.0,
            bottom: 12.0,
            right: 12.0,
        });
        stack.addArrangedSubview(as_view(&*segment));
        stack.addArrangedSubview(as_view(&*search));
        stack.addArrangedSubview(as_view(&*chip_row));
        stack.addArrangedSubview(as_view(&*scroll));
    }

    unsafe {
        window.setContentView(Some(as_view(&*stack)));
    }

    hold_target(target);

    HistoryCtx {
        window,
        table,
        search,
        segment,
        tier_popup,
        type_popup,
        date_popup,
        state,
        rows: Arc::new(Mutex::new(Vec::new())),
        filtered: Arc::new(Mutex::new(Vec::new())),
        filters: Arc::new(Mutex::new(Filters::default())),
        current_status: Arc::new(Mutex::new(HistoryStatus::Approved)),
        last_fetch: Arc::new(Mutex::new(None)),
        data_source,
    }
}

fn add_column(table: &NSTableView, id: &str, title: &str, width: f64) {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let ident = NSString::from_str(id);
    let ui_id: &NSUserInterfaceItemIdentifier =
        unsafe { &*(&*ident as *const NSString as *const NSUserInterfaceItemIdentifier) };
    let alloc = mtm.alloc::<NSTableColumn>();
    let col = unsafe { NSTableColumn::initWithIdentifier(alloc, ui_id) };
    unsafe {
        col.setTitle(&NSString::from_str(title));
        col.setWidth(width);
    }
    table.addTableColumn(&col);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(agent: &str, action: &str, tier: Option<i32>, reason: &str) -> HistoryRow {
        HistoryRow {
            agent: agent.into(),
            action: action.into(),
            tier,
            reason: reason.into(),
            decided_at_text: "".into(),
            decided_at_iso: None,
            status: "Approved".into(),
            agent_lc: agent.to_lowercase(),
            reason_lc: reason.to_lowercase(),
        }
    }

    fn row_at(iso: &str) -> HistoryRow {
        let mut r = row("Agent", "Run Shell", Some(2), "");
        r.decided_at_iso = Some(iso.into());
        r
    }

    fn parse_utc(s: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn matches_default_passes_all() {
        let r = row("Bob", "Send Email", Some(2), "ship it");
        assert!(matches(&r, &Filters::default()));
    }

    #[test]
    fn matches_search_substring_case_insensitive_agent() {
        let r = row("Buildbot Prod", "Run Shell", Some(1), "");
        let mut f = Filters::default();
        f.search = "PROD".into();
        assert!(matches(&r, &f));
    }

    #[test]
    fn matches_search_substring_case_insensitive_reason() {
        let r = row("Bob", "Send Email", Some(2), "Reset Customer Password");
        let mut f = Filters::default();
        f.search = "password".into();
        assert!(matches(&r, &f));
    }

    #[test]
    fn matches_search_misses() {
        let r = row("Bob", "Send Email", Some(2), "ship it");
        let mut f = Filters::default();
        f.search = "missing".into();
        assert!(!matches(&r, &f));
    }

    #[test]
    fn matches_tier_filter() {
        let r = row("Bob", "X", Some(3), "");
        let mut f = Filters::default();
        f.tier = Some(2);
        assert!(!matches(&r, &f));
        f.tier = Some(3);
        assert!(matches(&r, &f));
    }

    #[test]
    fn matches_action_type_filter() {
        let r = row("Bob", "Send Email", Some(2), "");
        let mut f = Filters::default();
        f.action_type = Some("Run Shell".into());
        assert!(!matches(&r, &f));
        f.action_type = Some("Send Email".into());
        assert!(matches(&r, &f));
    }

    #[test]
    fn distinct_actions_dedupes_and_sorts() {
        let rows = vec![
            row("a", "Run Shell", None, ""),
            row("b", "Send Email", None, ""),
            row("c", "Run Shell", None, ""),
            row("d", "", None, ""),
        ];
        let v = distinct_actions(&rows);
        assert_eq!(v, vec!["Run Shell".to_string(), "Send Email".to_string()]);
    }

    #[test]
    fn history_status_wire_strings() {
        assert_eq!(HistoryStatus::Approved.wire(), "approved");
        assert_eq!(HistoryStatus::Rejected.wire(), "rejected");
        assert_eq!(HistoryStatus::Expired.wire(), "expired");
    }

    // ---- Date-range chip tests ----
    //
    // All anchored on a fixed `now` so the bucket boundaries are
    // deterministic. `now = 2026-05-04T12:00:00Z`.
    fn fixed_now() -> chrono::DateTime<chrono::Utc> {
        parse_utc("2026-05-04T12:00:00Z")
    }

    #[test]
    fn date_range_all_time_passes_missing_iso() {
        // AllTime must NOT require a parseable iso. Rows with no
        // timestamp still show up in the AllTime bucket.
        assert!(date_range_matches(None, &DateRange::AllTime, fixed_now()));
    }

    #[test]
    fn date_range_bounded_drops_missing_iso() {
        // Bounded buckets need a parseable timestamp; missing => out.
        assert!(!date_range_matches(None, &DateRange::Today, fixed_now()));
        assert!(!date_range_matches(None, &DateRange::Last7, fixed_now()));
        assert!(!date_range_matches(None, &DateRange::Last30, fixed_now()));
    }

    #[test]
    fn date_range_today_includes_today() {
        // Same UTC day, earlier in the day.
        assert!(date_range_matches(
            Some("2026-05-04T03:30:00Z"),
            &DateRange::Today,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_today_includes_midnight_boundary() {
        // Exactly UTC midnight is included (>= midnight).
        assert!(date_range_matches(
            Some("2026-05-04T00:00:00Z"),
            &DateRange::Today,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_today_excludes_yesterday() {
        // 11:59:59 the day before midnight is NOT today.
        assert!(!date_range_matches(
            Some("2026-05-03T23:59:59Z"),
            &DateRange::Today,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_last7_includes_exactly_7_days_ago() {
        // 7d ago to the second is the inclusive cutoff.
        assert!(date_range_matches(
            Some("2026-04-27T12:00:00Z"),
            &DateRange::Last7,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_last7_excludes_just_past_7_days() {
        // One second past 7d is out.
        assert!(!date_range_matches(
            Some("2026-04-27T11:59:59Z"),
            &DateRange::Last7,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_last30_includes_recent() {
        assert!(date_range_matches(
            Some("2026-04-30T12:00:00Z"),
            &DateRange::Last30,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_last30_excludes_31_days_ago() {
        // 30d + 1d back is out.
        assert!(!date_range_matches(
            Some("2026-04-03T11:59:59Z"),
            &DateRange::Last30,
            fixed_now(),
        ));
    }

    #[test]
    fn date_range_unparseable_iso_drops_for_bounded() {
        assert!(!date_range_matches(
            Some("not a date"),
            &DateRange::Today,
            fixed_now(),
        ));
        assert!(date_range_matches(
            Some("not a date"),
            &DateRange::AllTime,
            fixed_now(),
        ));
    }

    #[test]
    fn matches_at_combines_all_filters() {
        // Tier 2 + correct action + within Last 7 days + matching
        // search, all four constraints satisfied at once.
        let mut r = row_at("2026-05-01T10:00:00Z");
        r.agent = "Buildbot".into();
        r.agent_lc = "buildbot".into();
        r.action = "Run Shell".into();
        let mut f = Filters {
            search: "build".into(),
            tier: Some(2),
            action_type: Some("Run Shell".into()),
            date_range: DateRange::Last7,
        };
        assert!(matches_at(&r, &f, fixed_now()));
        // Flip the date range to Today; the row is from 3 days ago,
        // so it must drop out.
        f.date_range = DateRange::Today;
        assert!(!matches_at(&r, &f, fixed_now()));
    }
}
