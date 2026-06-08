// ts/src/test-utils/span-builder.ts
function hex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
var SPAN_TYPES = [
  "llm",
  "file_read",
  "file_write",
  "shell",
  "http",
  "db",
  "mcp"
];
function buildTestPayload(opts) {
  const workflowId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  const spanId = hex(16);
  const traceId = hex(32);
  const nowNs = Date.now() * 1e6;
  const { activityType: defaultActivityType, activityInput, span } = buildSpan(opts, spanId, traceId, nowNs);
  return {
    source: "workflow-telemetry",
    event_type: "ActivityStarted",
    workflow_id: workflowId,
    run_id: runId,
    workflow_type: "TestWorkflow",
    activity_id: activityId,
    activity_type: opts.activityType || defaultActivityType,
    task_queue: "cli-test",
    attempt: 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    hook_trigger: opts.hookTrigger ?? false,
    activity_input: [activityInput],
    spans: [span],
    span_count: 1
  };
}
function buildSpan(opts, spanId, traceId, nowNs) {
  const base = {
    span_id: spanId,
    trace_id: traceId,
    parent_span_id: null,
    kind: "CLIENT",
    stage: "started",
    start_time: nowNs,
    end_time: null,
    duration_ns: null,
    status: { code: "OK", description: null },
    events: [],
    error: null
  };
  switch (opts.type) {
    case "llm": {
      const input = { prompt: opts.prompt || "test prompt" };
      return {
        activityType: "PromptSubmission",
        activityInput: input,
        span: {
          ...base,
          name: "llm.chat.completion",
          hook_type: "function_call",
          semantic_type: "llm_completion",
          attributes: {
            "gen_ai.system": "openai",
            "gen_ai.model": opts.model || "gpt-4",
            // WORKAROUND: Core only detects LLM via HTTP POST to known domains.
            // Remove once Core honors gen_ai.system. See session.go:381.
            "http.method": "POST",
            "http.url": "https://api.openai.com/v1/chat/completions"
          },
          function: "LLMCall",
          module: "activity",
          args: input,
          result: null
        }
      };
    }
    case "file_read": {
      const filePath = opts.filePath || "/tmp/test.txt";
      const input = { file_path: filePath, content: opts.content || "" };
      return {
        activityType: "FileRead",
        activityInput: input,
        span: {
          ...base,
          name: "file.read",
          kind: "INTERNAL",
          hook_type: "file_operation",
          semantic_type: "file_read",
          attributes: {
            "file.path": filePath,
            "file.operation": "read"
          },
          file_path: filePath,
          file_mode: "r",
          file_operation: "read"
        }
      };
    }
    case "file_write": {
      const filePath = opts.filePath || "/tmp/test.txt";
      const input = { file_path: filePath, content: opts.content || "" };
      return {
        activityType: "FileEdit",
        activityInput: input,
        span: {
          ...base,
          name: "file.write",
          kind: "INTERNAL",
          hook_type: "file_operation",
          semantic_type: "file_write",
          attributes: {
            "file.path": filePath,
            "file.operation": "write"
          },
          file_path: filePath,
          file_mode: "w",
          file_operation: "write"
        }
      };
    }
    case "shell": {
      const command = opts.command || "echo hello";
      const input = { command, cwd: opts.cwd || "/tmp" };
      return {
        activityType: "ShellExecution",
        activityInput: input,
        span: {
          ...base,
          name: "ShellExecution",
          kind: "INTERNAL",
          hook_type: "function_call",
          semantic_type: "internal",
          attributes: {
            "shell.command": command,
            "shell.cwd": opts.cwd || "/tmp"
          },
          function: "ShellExecution",
          module: "activity",
          args: input,
          result: null
        }
      };
    }
    case "http": {
      const method = (opts.method || "POST").toUpperCase();
      const url = opts.url || "https://api.example.com/action";
      const input = { http_method: method, http_url: url };
      return {
        activityType: "HTTPRequest",
        activityInput: input,
        span: {
          ...base,
          name: `${method} ${url}`,
          hook_type: "http_request",
          semantic_type: `http_${method.toLowerCase()}`,
          attributes: {
            "http.method": method,
            "http.url": url
          },
          http_method: method,
          http_url: url,
          request_body: null,
          response_body: null,
          request_headers: null,
          response_headers: null,
          http_status_code: null
        }
      };
    }
    case "db": {
      const system = opts.dbSystem || "postgresql";
      const operation = (opts.dbOperation || "SELECT").toUpperCase();
      const statement = opts.dbStatement || "SELECT * FROM users";
      const input = { db_system: system, db_operation: operation, db_statement: statement };
      return {
        activityType: "DatabaseQuery",
        activityInput: input,
        span: {
          ...base,
          name: `${operation} ${statement.split(" ").slice(0, 3).join(" ")}`,
          hook_type: "db_query",
          semantic_type: `database_${operation.toLowerCase()}`,
          attributes: {
            "db.system": system,
            "db.operation": operation,
            "db.statement": statement
          },
          db_system: system,
          db_name: null,
          db_operation: operation,
          db_statement: statement,
          server_address: null,
          server_port: null,
          rowcount: null
        }
      };
    }
    case "mcp": {
      const toolName = opts.toolName || "search";
      const serverName = opts.server || "mcp-server";
      const input = { server: serverName, tool_name: toolName, tool_input: opts.toolInput || "" };
      return {
        activityType: "MCPToolCall",
        activityInput: input,
        span: {
          ...base,
          name: `tool.${toolName}`,
          hook_type: "function_call",
          semantic_type: "llm_tool_call",
          attributes: {
            "gen_ai.system": "mcp",
            // WORKAROUND: same as LLM; Core needs http.method/url
            "http.method": "POST",
            "http.url": "https://api.openai.com/v1/chat/completions"
          },
          function: `mcp.${toolName}`,
          module: "activity",
          args: input,
          result: null
        }
      };
    }
  }
}

// ts/src/test-utils/fixtures.ts
var counter = 0;
var ts = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;
function makeCreateAgentDto(teamIds, overrides = {}) {
  return {
    agent_name: `test-agent-${ts()}`,
    description: "E2E test agent, auto cleanup",
    icon: "robot",
    agent_type: "temporal",
    team_ids: teamIds,
    tags: ["e2e-test"],
    attestation_mode: "kms",
    aivss_config: {
      base_security: {
        attack_vector: 2,
        attack_complexity: 1,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 2,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3
      },
      impact: {
        confidentiality_impact: 2,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1
      }
    },
    goal_alignment_config: {
      alignment_threshold: 70,
      drift_detection_action: "alert_only",
      evaluation_frequency: "every_action",
      llama_firewall_model: "gpt-4o-mini"
    },
    ...overrides
  };
}
function makeCreateGuardrailDto(overrides = {}) {
  return {
    name: `test-guardrail-${ts()}`,
    guardrail_type: "1",
    description: "E2E test guardrail",
    processing_stage: "1",
    params: {},
    settings: {},
    trust_impact: "medium",
    ...overrides
  };
}
function makeCreatePolicyDto(overrides = {}) {
  return {
    name: `test-policy-${ts()}`,
    description: "E2E test policy",
    rego_code: 'package openbox.policy\ndefault decision = {"verdict": "allow", "reason": ""}',
    input: {},
    trust_impact: "low",
    ...overrides
  };
}
function makeCreateBehaviorRuleDto(overrides = {}) {
  return {
    rule_name: `test-rule-${ts()}`,
    description: "E2E test behavior rule",
    priority: 50,
    trigger: "http_post",
    states: ["http_get"],
    time_window: 300,
    verdict: 3,
    // BLOCK
    reject_message: "Blocked by E2E test rule",
    trust_impact: "low",
    ...overrides
  };
}
function makeUpdateAgentDto(overrides = {}) {
  return {
    description: `Updated by E2E test at ${(/* @__PURE__ */ new Date()).toISOString()}`,
    ...overrides
  };
}
function makeGovernanceEvent(overrides = {}) {
  return {
    event_type: "ActivityStarted",
    workflow_id: `test-wf-${ts()}`,
    workflow_type: "e2e-test",
    run_id: `test-run-${ts()}`,
    activity_id: `act-${ts()}`,
    activity_type: "tool_call",
    activity_input: [{ tool: "web_search", args: { query: "test" } }],
    source: "workflow-telemetry",
    task_queue: "temporal",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...overrides
  };
}
function makeUpdateAivssConfigDto(overrides = {}) {
  return {
    aivss_config: {
      base_security: {
        attack_vector: 3,
        attack_complexity: 2,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 3,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3
      },
      impact: {
        confidentiality_impact: 3,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1
      }
    },
    reason: "E2E test reconfiguration",
    ...overrides
  };
}
function makeGoalAlignmentConfigDto(overrides = {}) {
  return {
    alignment_threshold: 70,
    drift_detection_action: "alert_only",
    evaluation_frequency: "every_action",
    ...overrides
  };
}
export {
  SPAN_TYPES,
  buildTestPayload,
  makeCreateAgentDto,
  makeCreateBehaviorRuleDto,
  makeCreateGuardrailDto,
  makeCreatePolicyDto,
  makeGoalAlignmentConfigDto,
  makeGovernanceEvent,
  makeUpdateAgentDto,
  makeUpdateAivssConfigDto
};
