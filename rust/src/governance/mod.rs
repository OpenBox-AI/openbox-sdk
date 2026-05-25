//! In-process governance evaluator. Parity with
//! `ts/src/governance/check.ts`. Uses the same wire shape as
//! `crate::core::evaluate_governance`, callable in process so a
//! Rust consumer does not need to spawn `openbox mcp serve` for
//! every governed action.
//!
//! Key resolution mirrors the TypeScript SDK:
//!
//!   1. The explicit `api_key` argument (highest priority; useful
//!      for tests).
//!   2. The `OPENBOX_API_KEY` environment variable (CI and
//!      hook-handler convention).
//!   3. The per-agent runtime-key cache; the disk lookup is the
//!      caller's responsibility (see `crate::env`).
//!
//! All three sources accept only an agent runtime-key (`obx_live_*`
//! or `obx_test_*`). The org-level `X-API-Key` (`obx_key_*`) is
//! rejected because the core evaluator runs OPA against the agent's
//! policies, not the organization's.

use serde_json::{json, Value};

use crate::core::OpenBoxCoreClient;
use crate::env::resolve_connection;
use crate::error::ApiError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpanType {
    Llm,
    FileRead,
    FileWrite,
    Shell,
    Http,
    Db,
    Mcp,
}

impl SpanType {
    pub fn activity_type(self) -> &'static str {
        match self {
            SpanType::Llm => "PromptSubmission",
            SpanType::FileRead => "FileRead",
            SpanType::FileWrite => "FileEdit",
            SpanType::Shell => "ShellExecution",
            SpanType::Http => "HTTPRequest",
            SpanType::Db => "DatabaseQuery",
            SpanType::Mcp => "MCPToolCall",
        }
    }
}

pub struct CheckGovernanceOptions {
    /// Agent id. Required when `api_key` is not supplied so the
    /// per-agent runtime-key cache can satisfy the resolution.
    pub agent_id: Option<String>,
    pub span_type: SpanType,
    /// Action input. Examples: `{prompt}`,
    /// `{file_path, content}`, `{command}`.
    pub activity_input: Value,
    /// Override the runtime API key. Skips the env and cache lookups.
    pub api_key: Option<String>,
    /// Override the core base URL. Defaults to OPENBOX_CORE_URL or
    /// OPENBOX_STACK_URL-derived core URL.
    pub core_url: Option<String>,
}

fn hex(len: usize) -> String {
    // Non-cryptographic random hex. Identifiers only need to be
    // unique per span or payload, not unguessable. A system-time
    // nanosecond seed mixed with an atomic counter is sufficient.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let seed = ns ^ COUNTER.fetch_add(1, Ordering::Relaxed).wrapping_mul(2862933555777941757);
    let mut x = seed;
    let mut s = String::with_capacity(len);
    for _ in 0..len {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        s.push(std::char::from_digit(((x >> 60) & 0xf) as u32, 16).unwrap());
    }
    s
}

fn build_span(span_type: SpanType, input: &Value) -> Value {
    let base = json!({
        "span_id": hex(16),
        "trace_id": hex(32),
        "parent_span_id": Value::Null,
        "kind": "CLIENT",
        "stage": "started",
        "start_time": chrono_millis() * 1_000_000_i64,
        "end_time": Value::Null,
        "duration_ns": Value::Null,
        "status": { "code": "OK", "description": Value::Null },
        "events": [],
        "error": Value::Null,
    });
    let mut span = base.as_object().unwrap().clone();
    match span_type {
        SpanType::Llm => {
            span.insert("name".into(), json!("llm.chat.completion"));
            span.insert("hook_type".into(), json!("function_call"));
            span.insert("semantic_type".into(), json!("llm_completion"));
            span.insert(
                "attributes".into(),
                json!({
                    "gen_ai.system": "openai",
                    "http.method": "POST",
                    "http.url": "https://api.openai.com/v1/chat/completions",
                }),
            );
            span.insert("function".into(), json!("LLMCall"));
            span.insert("module".into(), json!("activity"));
            span.insert("args".into(), input.clone());
            span.insert("result".into(), Value::Null);
        }
        SpanType::FileRead | SpanType::FileWrite => {
            let op = if span_type == SpanType::FileRead { "read" } else { "write" };
            let name = if span_type == SpanType::FileRead { "file.read" } else { "file.write" };
            let file_path = input.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            span.insert("name".into(), json!(name));
            span.insert("kind".into(), json!("INTERNAL"));
            span.insert("hook_type".into(), json!("file_operation"));
            span.insert(
                "semantic_type".into(),
                json!(if span_type == SpanType::FileRead { "file_read" } else { "file_write" }),
            );
            span.insert(
                "attributes".into(),
                json!({ "file.path": file_path, "file.operation": op }),
            );
            span.insert("file_path".into(), json!(file_path));
            span.insert(
                "file_mode".into(),
                json!(if span_type == SpanType::FileRead { "r" } else { "w" }),
            );
            span.insert("file_operation".into(), json!(op));
        }
        SpanType::Shell => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let cwd = input.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            span.insert("name".into(), json!("ShellExecution"));
            span.insert("kind".into(), json!("INTERNAL"));
            span.insert("hook_type".into(), json!("function_call"));
            span.insert("semantic_type".into(), json!("internal"));
            span.insert(
                "attributes".into(),
                json!({ "shell.command": cmd, "shell.cwd": cwd }),
            );
            span.insert("function".into(), json!("ShellExecution"));
            span.insert("module".into(), json!("activity"));
            span.insert("args".into(), input.clone());
            span.insert("result".into(), Value::Null);
        }
        SpanType::Http => {
            let method = input
                .get("method")
                .and_then(|v| v.as_str())
                .map(str::to_ascii_uppercase)
                .unwrap_or_else(|| "POST".to_string());
            let url = input
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://api.example.com");
            span.insert("name".into(), json!(format!("{} {}", method, url)));
            span.insert("hook_type".into(), json!("http_request"));
            span.insert(
                "attributes".into(),
                json!({ "http.method": method, "http.url": url }),
            );
            span.insert("http_method".into(), json!(method));
            span.insert("http_url".into(), json!(url));
            span.insert("request_body".into(), Value::Null);
            span.insert("response_body".into(), Value::Null);
        }
        SpanType::Db => {
            let op = input
                .get("operation")
                .and_then(|v| v.as_str())
                .map(str::to_ascii_uppercase)
                .unwrap_or_else(|| "SELECT".to_string());
            let system = input
                .get("system")
                .and_then(|v| v.as_str())
                .unwrap_or("postgresql");
            let statement = input.get("statement").and_then(|v| v.as_str()).unwrap_or("");
            span.insert("name".into(), json!(op.clone()));
            span.insert("hook_type".into(), json!("db_query"));
            span.insert(
                "attributes".into(),
                json!({ "db.system": system, "db.operation": op }),
            );
            span.insert("db_system".into(), json!(system));
            span.insert("db_operation".into(), json!(op));
            span.insert("db_statement".into(), json!(statement));
        }
        SpanType::Mcp => {
            let tool = input.get("tool").and_then(|v| v.as_str()).unwrap_or("");
            span.insert("name".into(), json!("MCPToolCall"));
            span.insert("kind".into(), json!("INTERNAL"));
            span.insert("hook_type".into(), json!("function_call"));
            span.insert("semantic_type".into(), json!("internal"));
            span.insert("attributes".into(), json!({ "mcp.tool": tool }));
            span.insert("function".into(), json!("MCPToolCall"));
            span.insert("module".into(), json!("activity"));
            span.insert("args".into(), input.clone());
            span.insert("result".into(), Value::Null);
        }
    }
    Value::Object(span)
}

fn chrono_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_runtime_key(k: &str) -> bool {
    k.starts_with("obx_live_") || k.starts_with("obx_test_")
}

fn resolve_api_key(opts: &CheckGovernanceOptions) -> Result<String, ApiError> {
    let candidates: [Option<String>; 2] = [
        opts.api_key.clone(),
        std::env::var("OPENBOX_API_KEY").ok(),
    ];
    let key = candidates
        .into_iter()
        .flatten()
        .find(|k| is_runtime_key(k));
    key.ok_or_else(|| {
        ApiError::Config(format!(
            "No agent runtime key for {}. Pass api_key, set OPENBOX_API_KEY to obx_live_*/obx_test_*, or supply a runtime key from the agent-keys cache.",
            opts.agent_id.as_deref().unwrap_or("(unset)")
        ))
    })
}

fn resolve_core_url(core_override: Option<String>) -> Result<String, ApiError> {
    if let Some(u) = core_override {
        return Ok(u);
    }
    resolve_connection()
        .map(|connection| connection.core_url)
        .map_err(ApiError::Config)
}

/// Evaluates an action against an agent's governance rules.
/// Returns the core verdict envelope
/// (`{ verdict, reason?, approval_id?, ... }`).
///
/// A `verdict` of `0` is allow; any other value is gated.
/// `approval_id` is set when the verdict materializes an approval
/// row server-side.
pub async fn check_governance(opts: CheckGovernanceOptions) -> Result<Value, ApiError> {
    let api_key = resolve_api_key(&opts)?;
    let core_url = resolve_core_url(opts.core_url.clone())?;
    let span = build_span(opts.span_type, &opts.activity_input);
    let payload = json!({
        "source": "sdk",
        "event_type": "ActivityStarted",
        "workflow_id": hex(32),
        "run_id": hex(32),
        "workflow_type": "SdkCheck",
        "task_queue": "sdk",
        "activity_id": hex(32),
        "activity_type": opts.span_type.activity_type(),
        "activity_input": [opts.activity_input],
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "hook_trigger": true,
        "spans": [span],
        "span_count": 1,
        "attempt": 1,
    });
    let client = OpenBoxCoreClient::new(core_url, api_key);
    // The generated `evaluate_governance` wrapper requires a typed
    // `GovernanceEventPayload`. The payload already has the right
    // JSON shape, so route through the lower-level `request_post`
    // with a raw `Value`. The path mirrors `OpenboxCore.evaluate`
    // in the spec.
    client
        .request_post::<Value, Value, Value>("/evaluate", Some(&payload), None)
        .await
}
