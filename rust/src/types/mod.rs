//! Re-export the spec-emitted bindings for the types package. This file
//! is the only hand-written file in this module; everything else is
//! emitted from `specs/typespec/` via `npm run specs:compile`.

pub mod generated;

pub use generated::*;
