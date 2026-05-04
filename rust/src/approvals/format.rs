//! Rust port of `ts/src/approvals/format.ts`. Mirrors that file
//! function-for-function so a given approval renders the same label,
//! the same one-line summary, and the same relative-time string in
//! every consumer.
//!
//! The canonical activity-label table itself is spec-emitted into
//! `crate::core::canonical_activity_label`; this module wraps it with
//! the title-case fallback formatter the TS side uses for free-form
//! custom-preset activity_types.

use serde_json::Value;

use crate::core::canonical_activity_label;

pub use crate::verdict::verdict_label;

const UPPERCASE_WORDS: &[&str] = &[
    "api", "id", "url", "http", "sql", "db", "ui", "io", "ip", "llm", "mcp", "sdk", "sse", "rpc",
    "sso", "iam", "pii", "json", "xml", "css", "html", "cli", "aws", "gcp", "jwt", "oauth",
];

fn is_uppercase_word(w: &str) -> bool {
    UPPERCASE_WORDS.iter().any(|u| u.eq_ignore_ascii_case(w))
}

pub fn format_label(s: &str) -> String {
    if s.is_empty() {
        return String::new();
    }
    if let Some(label) = canonical_activity_label(s) {
        return label.to_string();
    }

    let mut words: Vec<String> = Vec::new();
    for chunk in s.split('_') {
        for word in split_case_boundaries(chunk) {
            words.push(casemap_word(&word));
        }
    }
    words.join(" ")
}

fn split_case_boundaries(chunk: &str) -> Vec<String> {
    let chars: Vec<char> = chunk.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<String> = vec![String::new()];
    for (i, &c) in chars.iter().enumerate() {
        if i > 0 {
            let prev = chars[i - 1];
            let next = chars.get(i + 1).copied();
            let lower_to_upper = (prev.is_ascii_lowercase() || prev.is_ascii_digit())
                && c.is_ascii_uppercase();
            let acronym_to_word = prev.is_ascii_uppercase()
                && c.is_ascii_uppercase()
                && matches!(next, Some(n) if n.is_ascii_lowercase());
            if lower_to_upper || acronym_to_word {
                out.push(String::new());
            }
        }
        out.last_mut().unwrap().push(c);
    }
    out.into_iter().filter(|w| !w.is_empty()).collect()
}

fn casemap_word(w: &str) -> String {
    if is_uppercase_word(w) {
        return w.to_ascii_uppercase();
    }
    if w.chars().count() > 1 && w == w.to_ascii_uppercase() {
        return w.to_string();
    }
    let mut chars = w.chars();
    match chars.next() {
        Some(first) => {
            let mut s = String::new();
            s.extend(first.to_uppercase());
            s.push_str(&chars.as_str().to_ascii_lowercase());
            s
        }
        None => String::new(),
    }
}

pub fn summarize_input(activity_type: Option<&str>, input: &Value) -> Option<String> {
    let arr = input.as_array()?;
    let first = arr.first()?;
    if first.is_null() {
        return None;
    }
    if !first.is_object() {
        return match first {
            Value::String(s) => Some(s.clone()),
            other => Some(other.to_string()),
        };
    }
    let obj = first.as_object()?;

    let pick = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(Value::String(s)) = obj.get(*k) {
                if !s.is_empty() {
                    return Some(s.clone());
                }
            }
        }
        None
    };

    match activity_type {
        Some("ShellExecution") | Some("ShellOutput") => pick(&["command"]),
        Some("PromptSubmission")
        | Some("UserPromptSubmit")
        | Some("beforeSubmitPrompt")
        | Some("LLMCompleted")
        | Some("AgentResponse")
        | Some("AgentThinking")
        | Some("on_llm_start")
        | Some("on_llm_end")
        | Some("on_chat_model_start") => pick(&["prompt", "message", "text", "content"]),
        Some("FileRead") | Some("FileEdit") | Some("FileDelete") | Some("beforeReadFile")
        | Some("afterFileEdit") => pick(&["file_path", "path"]),
        Some("HTTPRequest") => {
            let method = pick(&["method", "http_method"]);
            let url = pick(&["url", "http_url"]);
            match (method, url) {
                (Some(m), Some(u)) => Some(format!("{} {}", m, u)),
                (_, Some(u)) => Some(u),
                (Some(m), None) => Some(m),
                (None, None) => None,
            }
        }
        Some("MCPToolCall")
        | Some("MCPToolResponse")
        | Some("beforeMCPExecution")
        | Some("afterMCPExecution") => {
            let server = pick(&["server", "mcp_server"]);
            let tool = pick(&["tool_name", "tool", "name"]);
            match (server, tool) {
                (Some(s), Some(t)) => Some(format!("{}.{}", s, t)),
                (_, Some(t)) => Some(t),
                (Some(s), None) => Some(s),
                (None, None) => None,
            }
        }
        Some("PreToolUse")
        | Some("PostToolUse")
        | Some("preToolUse")
        | Some("postToolUse")
        | Some("ToolStarted")
        | Some("ToolCompleted")
        | Some("on_tool_start")
        | Some("on_tool_end") => pick(&["tool_name", "tool", "name", "command", "description"]),
        Some("AgentSpawn") | Some("subagentStop") | Some("SubagentStop") => {
            pick(&["agent_type", "task", "description"])
        }
        _ => pick(&["description", "name", "title", "summary", "command", "message"]).or_else(
            || {
                let serialized = serde_json::to_string(&Value::Object(obj.clone())).ok()?;
                Some(truncate(&serialized, 200))
            },
        ),
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}

pub fn time_ago(date_str: &str) -> String {
    let Some(diff) = seconds_since(date_str, true) else {
        return String::new();
    };
    if diff < 60 {
        "just now".into()
    } else if diff < 3600 {
        format!("{}m ago", diff / 60)
    } else if diff < 86_400 {
        format!("{}h ago", diff / 3600)
    } else {
        format!("{}d ago", diff / 86_400)
    }
}

pub fn time_remaining(date_str: &str) -> String {
    let Some(diff) = seconds_since(date_str, false) else {
        return String::new();
    };
    if diff <= 0 {
        return "expired".into();
    }
    let diff = diff as u64;
    if diff < 60 {
        format!("{}s", diff)
    } else if diff < 3600 {
        format!("{}m {}s", diff / 60, diff % 60)
    } else {
        format!("{}h {}m", diff / 3600, (diff % 3600) / 60)
    }
}

fn seconds_since(date_str: &str, as_age: bool) -> Option<i64> {
    if date_str.is_empty() {
        return None;
    }
    let ts = chrono::DateTime::parse_from_rfc3339(date_str).ok()?.timestamp();
    let now = chrono::Utc::now().timestamp();
    Some(if as_age { now - ts } else { ts - now })
}
