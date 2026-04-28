// build.rs - generates a Rust client from the OpenBox backend OpenAPI spec.
//
// This crate lives inside the openbox-sdk monorepo, so the spec is just
// a sibling at ../specs/backend.json - same file the TypeScript SDK
// generates its `Backend` namespace types from. One source of truth,
// two language outputs.
//
// Consumers (e.g. openbox-approver) pin this whole monorepo by git tag:
//
//     [dependencies]
//     openbox-sdk = { git = "https://github.com/OpenBox-AI/openbox-sdk", tag = "v0.1.0-alpha.1" }
//
// Cargo finds the workspace root, then this `rust/` member by package
// name. The git tag pins both the spec snapshot and the codegen
// pipeline together - language versions stay in lockstep.
//
// Output goes to OUT_DIR (Cargo's standard build cache) and is included
// from src/lib.rs via `include!`. We don't check the generated file in
// - the spec is the single source of truth.

use std::fs;
use std::path::PathBuf;

fn main() {
    let spec_path = "../specs/backend.json";
    println!("cargo:rerun-if-changed={}", spec_path);
    println!("cargo:rerun-if-changed=build.rs");

    let raw = fs::read_to_string(spec_path)
        .unwrap_or_else(|e| panic!("read {}: {}", spec_path, e));
    let mut json: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("parse {} as JSON: {}", spec_path, e));

    // Patch the spec in-flight: backend.json is auto-generated from
    // NestJS, and 13 endpoints are missing `@ApiParam` decorators on
    // their path parameters (e.g. `/organization/{organizationId}/members`
    // declares the {organizationId} placeholder in the path string but
    // doesn't list it under `parameters`). openapi-typescript on the TS
    // side is lenient and just inlines the path string; progenitor on
    // the Rust side strictly requires every `{x}` to have a matching
    // `parameters[].name == x, in: path` entry. We inject the missing
    // entries here rather than mutating the upstream spec - keeps the
    // openbox-sdk repo as the unmodified source of truth and contains
    // the workaround to this crate.
    inject_missing_path_params(&mut json);

    let spec: openapiv3::OpenAPI = serde_json::from_value(json)
        .unwrap_or_else(|e| panic!("parse {} as OpenAPI 3.0: {}", spec_path, e));

    let mut generator = progenitor::Generator::default();
    let tokens = generator
        .generate_tokens(&spec)
        .unwrap_or_else(|e| panic!("progenitor codegen failed: {}", e));
    let ast = syn::parse2::<syn::File>(tokens)
        .unwrap_or_else(|e| panic!("parse generated tokens: {}", e));
    let pretty = prettyplease::unparse(&ast);

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR not set by cargo");
    let out_path = PathBuf::from(&out_dir).join("backend_codegen.rs");
    fs::write(&out_path, pretty)
        .unwrap_or_else(|e| panic!("write {:?}: {}", out_path, e));
}

/// Walk every path in the spec; for any `{placeholder}` in the path
/// string that isn't declared in the operation's `parameters` array,
/// inject a synthetic entry: `{ name, in: "path", required: true,
/// schema: { type: "string" } }`. Mirrors what NestJS would have
/// produced if `@ApiParam` were declared.
///
/// Also strips out non-path parameters whose snake_case'd name collides
/// with a path placeholder's snake_case'd name. backend.json has 3
/// endpoints that redundantly declare a query param matching their
/// path param (e.g. `/organization/{organizationId}/approvals` lists
/// both the `{organizationId}` placeholder and a query `organization_id`)
/// - progenitor folds both into a single Rust ident `organization_id`,
/// which produces a function with two args of the same name. The query
/// version is redundant (server uses the path param) so we drop it.
fn inject_missing_path_params(json: &mut serde_json::Value) {
    let paths = match json.get_mut("paths").and_then(|v| v.as_object_mut()) {
        Some(p) => p,
        None => return,
    };
    for (path, methods) in paths.iter_mut() {
        let placeholders = extract_placeholders(path);
        if placeholders.is_empty() {
            continue;
        }
        let placeholder_idents: Vec<String> =
            placeholders.iter().map(|s| to_snake(s)).collect();
        let methods = match methods.as_object_mut() {
            Some(m) => m,
            None => continue,
        };
        for (method, op) in methods.iter_mut() {
            if !is_http_method(method) {
                continue;
            }
            let op = match op.as_object_mut() {
                Some(o) => o,
                None => continue,
            };
            let params = op
                .entry("parameters".to_string())
                .or_insert_with(|| serde_json::Value::Array(Vec::new()));
            let arr = match params.as_array_mut() {
                Some(a) => a,
                None => continue,
            };
            // 1) Drop redundant non-path params whose snake_case name
            //    collides with a path placeholder.
            arr.retain(|p| {
                let in_loc = p.get("in").and_then(|v| v.as_str()).unwrap_or("");
                if in_loc == "path" {
                    return true;
                }
                let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let snake = to_snake(name);
                !placeholder_idents.contains(&snake)
            });
            // 2) Inject any missing path-param declarations.
            for placeholder in &placeholders {
                let already = arr.iter().any(|p| {
                    p.get("name").and_then(|v| v.as_str()) == Some(placeholder.as_str())
                        && p.get("in").and_then(|v| v.as_str()) == Some("path")
                });
                if already {
                    continue;
                }
                arr.push(serde_json::json!({
                    "name": placeholder,
                    "in": "path",
                    "required": true,
                    "schema": { "type": "string" }
                }));
            }
        }
    }
}

fn to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            out.push('_');
        }
        out.extend(ch.to_lowercase());
    }
    out
}

fn extract_placeholders(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end) = path[i + 1..].find('}') {
                out.push(path[i + 1..i + 1 + end].to_string());
                i += end + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn is_http_method(s: &str) -> bool {
    matches!(
        s,
        "get" | "post" | "put" | "patch" | "delete" | "options" | "head" | "trace"
    )
}
