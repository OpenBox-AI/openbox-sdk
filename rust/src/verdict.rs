//! Verdict integer → display label. Wire shape on `Approval.verdict`
//! is `int32` (kept as int so analytics / sorting consumers see the
//! number); UI consumers call `verdict_label` to render.

/// Allow: rule passed without intervention.
pub const VERDICT_ALLOW: i32 = 0;
/// Constrain: action allowed but with modified parameters.
pub const VERDICT_CONSTRAIN: i32 = 1;
/// Require Approval: action queued pending human review.
pub const VERDICT_REQUIRE_APPROVAL: i32 = 2;
/// Block: action denied; agent is told no.
pub const VERDICT_BLOCK: i32 = 3;
/// Halt: action denied AND agent is forcibly stopped.
pub const VERDICT_HALT: i32 = 4;

/// Map the wire integer to a stable human-readable label. Returns
/// `None` for unknown verdict numerics; callers fall back to rendering
/// the integer.
pub fn verdict_label(v: i32) -> Option<&'static str> {
    match v {
        VERDICT_ALLOW => Some("Allow"),
        VERDICT_CONSTRAIN => Some("Constrain"),
        VERDICT_REQUIRE_APPROVAL => Some("Require Approval"),
        VERDICT_BLOCK => Some("Block"),
        VERDICT_HALT => Some("Halt"),
        _ => None,
    }
}
