// ts/src/core-client/generated/govern.ts
var CANONICAL_ACTIVITY_LABELS = Object.freeze({ "AGENT_STEP": "Agent Step", "ActivityTaskCanceled": "Activity Task Canceled", "ActivityTaskCompleted": "Activity Task Completed", "ActivityTaskFailed": "Activity Task Failed", "ActivityTaskScheduled": "Activity Task Scheduled", "ActivityTaskStarted": "Activity Task Started", "ActivityTaskTimedOut": "Activity Task Timed Out", "AgentAction": "Agent Action", "AgentExecutionCompleted": "Agent Execution Completed", "AgentExecutionStarted": "Agent Execution Started", "AgentSpawn": "Agent Spawn", "CHUNKING": "Chunking", "CallToolsNode": "Call Tools Node", "ChildWorkflowExecutionCompleted": "Child Workflow Execution Completed", "ChildWorkflowExecutionInitiated": "Child Workflow Execution Initiated", "CrewKickoffCompleted": "Crew Kickoff Completed", "CrewKickoffStarted": "Crew Kickoff Started", "EMBEDDING": "Embedding", "EXCEPTION": "Exception", "End": "End", "FUNCTION_CALL": "Function Call", "FileDelete": "File Delete", "FileEdit": "File Edit", "FileRead": "File Read", "HTTPRequest": "HTTP Request", "HandoffMessage": "Handoff Message", "LLM": "LLM", "LLMCallCompleted": "LLM Call Completed", "LLMCallStarted": "LLM Call Started", "LLMCompleted": "LLM Completed", "MCPToolCall": "MCP Tool Call", "MarkerRecorded": "Marker Recorded", "MemoryQueryEvent": "Memory Query", "ModelRequestNode": "Model Request Node", "MultiModalMessage": "Multi-Modal Message", "Notification": "Notification", "OperationCompleted": "Operation Completed", "OperationStarted": "Operation Started", "PermissionRequest": "Permission Request", "PostToolUse": "Post-Tool Use", "PreCompact": "Pre-Compact", "PreSyncHookStarted": "Pre-Sync Hook Started", "PreSyncHookSucceeded": "Pre-Sync Hook Succeeded", "PreToolUse": "Pre-Tool Use", "PromptSubmission": "Prompt Submission", "QUERY": "Query", "RERANKING": "Reranking", "RETRIEVE": "Retrieve", "ResourceUpdated": "Resource Updated", "SUB_QUESTION": "Sub-Question", "SYNTHESIZE": "Synthesize", "ShellExecution": "Shell Execution", "Stop": "Stop", "StopMessage": "Stop Message", "SubagentStart": "Subagent Start", "SubagentStop": "Subagent Stop", "SyncStatusChanged": "Sync Status Changed", "TaskCompleted": "Task Completed", "TaskStart": "Task Start", "TaskStarted": "Task Started", "TextMessage": "Text Message", "TimerFired": "Timer Fired", "TimerStarted": "Timer Started", "ToolCallExecutionEvent": "Tool Call Execution", "ToolCallRequestEvent": "Tool Call Request", "ToolCompleted": "Tool Completed", "ToolStarted": "Tool Started", "ToolUsageError": "Tool Usage Error", "ToolUsageFinished": "Tool Usage Finished", "ToolUsageStarted": "Tool Usage Started", "UserInputRequestedEvent": "User Input Requested", "UserPromptNode": "User Prompt Node", "UserPromptSubmit": "User Prompt Submit", "WorkflowExecutionSignaled": "Workflow Execution Signaled", "afterAgentResponse": "After Agent Response", "afterAgentThought": "After Agent Thought", "afterFileEdit": "After File Edit", "afterMCPExecution": "After MCP Execution", "afterShellExecution": "After Shell Execution", "agentStop": "Agent Stop", "auto_function_invocation_post": "Auto Function Invocation Post", "auto_function_invocation_pre": "Auto Function Invocation Pre", "beforeMCPExecution": "Before MCP Execution", "beforeReadFile": "Before Read File", "beforeShellExecution": "Before Shell Execution", "beforeSubmitPrompt": "Before Submit Prompt", "checkpoint": "Checkpoint", "custom_event": "Custom Event", "error": "Error", "error-trigger": "Error Trigger", "errorOccurred": "Error Occurred", "function_invocation_post": "Function Invocation Post", "function_invocation_pre": "Function Invocation Pre", "incident.acknowledged": "Incident Acknowledged", "incident.annotated": "Incident Annotated", "incident.delegated": "Incident Delegated", "incident.escalated": "Incident Escalated", "incident.priority_updated": "Incident Priority Updated", "incident.reassigned": "Incident Reassigned", "incident.reopened": "Incident Reopened", "incident.resolved": "Incident Resolved", "incident.triggered": "Incident Triggered", "incident.unacknowledged": "Incident Unacknowledged", "interrupt": "Interrupt", "node-post-execute": "Node Post-Execute", "node-pre-execute": "Node Pre-Execute", "node_end": "Node End", "node_start": "Node Start", "onAbort": "Abort", "onError": "Error", "onFinish": "Finish", "onStepFinish": "Step Finish", "on_agent_action": "Agent Action", "on_agent_finish": "Agent Finish", "on_chain_end": "Chain End", "on_chain_start": "Chain Start", "on_chat_model_start": "Chat Model Start", "on_execute_callback": "Execute Callback", "on_failure_callback": "Failure Callback", "on_llm_end": "LLM End", "on_llm_error": "LLM Error", "on_llm_start": "LLM Start", "on_retriever_end": "Retriever End", "on_retriever_start": "Retriever Start", "on_retry_callback": "Retry Callback", "on_skipped_callback": "Skipped Callback", "on_success_callback": "Success Callback", "on_tool_end": "Tool End", "on_tool_error": "Tool Error", "on_tool_start": "Tool Start", "output_validator": "Output Validator", "payment_order.approved": "Payment Order Approved", "payment_order.begin_processing": "Payment Order Begin Processing", "payment_order.failed": "Payment Order Failed", "payment_order.reconciled": "Payment Order Reconciled", "payment_reference.created": "Payment Reference Created", "postToolUse": "Post-Tool Use", "preToolUse": "Pre-Tool Use", "prompt_render_post": "Prompt Render Post", "prompt_render_pre": "Prompt Render Pre", "sla_miss_callback": "SLA Miss Callback", "subagentStop": "Subagent Stop", "task_end": "Task End", "task_start": "Task Start", "tool-call": "Tool Call", "tool-result": "Tool Result", "tool_retry": "Tool Retry", "userPromptSubmitted": "User Prompt Submitted", "workflow-step-finish": "Workflow Step Finish", "workflow-step-progress": "Workflow Step Progress", "workflow-step-start": "Workflow Step Start" });
function randomUUID() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
var SessionAlreadyTerminatedError = class extends Error {
  constructor() {
    super("[govern] session already terminated; create a new govern() scope to continue.");
    this.name = "SessionAlreadyTerminatedError";
  }
};
var BaseGovernedSession = class {
  workflowId;
  runId;
  workflowType;
  taskQueue;
  core;
  approvalPollIntervalMs;
  approvalPollMaxIntervalMs;
  approvalPollBackoffFactor;
  approvalPollJitter;
  approvalMaxWaitMs;
  inlineApproval;
  opened = false;
  finalized = false;
  autoOpenSuppressed;
  inFlight = /* @__PURE__ */ new Set();
  activityStartsMs = /* @__PURE__ */ new Map();
  exitHandlerCleanup = [];
  onPendingApproval;
  onApprovalResolved;
  awaitExternalDecision;
  constructor(config) {
    this.core = config.core;
    this.workflowId = config.workflowId ?? randomUUID();
    this.runId = config.runId ?? randomUUID();
    this.workflowType = config.workflowType ?? "governed_agent";
    this.taskQueue = config.taskQueue ?? "generic";
    this.approvalPollIntervalMs = config.approvalPollIntervalMs ?? 500;
    this.approvalPollMaxIntervalMs = config.approvalPollMaxIntervalMs ?? 5e3;
    this.approvalPollBackoffFactor = config.approvalPollBackoffFactor ?? 1.5;
    this.approvalPollJitter = config.approvalPollJitter ?? 0.25;
    this.approvalMaxWaitMs = config.approvalMaxWaitMs ?? 6e4;
    this.inlineApproval = config.inlineApproval === true;
    this.autoOpenSuppressed = config.attached === true;
    this.onPendingApproval = config.onPendingApproval;
    this.onApprovalResolved = config.onApprovalResolved;
    this.awaitExternalDecision = config.awaitExternalDecision;
    if (config.registerExitHandlers !== false) {
      this.installExitHandlers();
    }
  }
  /** True once `begin()` has been called. */
  get isOpen() {
    return this.opened && !this.finalized;
  }
  /** True after a terminal event (Workflow{Completed,Failed}) fired. */
  get isTerminated() {
    return this.finalized;
  }
  /**
   * Fire WorkflowStarted. Idempotent; safe to call multiple times,
   * only the first emits. Public so harness-owned consumers (claude-hooks,
   * cursor-hooks) can drive lifecycle when the workflow spans processes.
   * `govern()` calls this automatically before the body runs;
   * `govern.attach()` does NOT; caller decides when (if ever).
   *
   * Backward-compat alias: `begin()`.
   */
  async workflowStarted() {
    if (this.opened) return;
    this.opened = true;
    await this.emit({ event_type: "WorkflowStarted" });
  }
  /** @deprecated use `workflowStarted()`; same behavior. */
  async begin() {
    return this.workflowStarted();
  }
  /**
   * Fire WorkflowCompleted. Idempotent. Same public/cross-process
   * rationale as `workflowStarted`. `govern()` calls this on the
   * happy-path return from the body; `govern.attach()` does NOT.
   *
   * Backward-compat alias: `complete()`.
   */
  async workflowCompleted() {
    if (this.finalized) return void 0;
    this.finalized = true;
    try {
      return await this.emit({ event_type: "WorkflowCompleted", status: "completed" });
    } finally {
      this.cleanupExitHandlers();
    }
  }
  /** @deprecated use `workflowCompleted()`; same behavior. */
  async complete() {
    return this.workflowCompleted();
  }
  /**
   * Fire WorkflowFailed with an error payload. Idempotent. `govern()`
   * calls this if the body throws or if a process-exit handler fires;
   * `govern.attach()` does NOT; caller invokes explicitly on harness-
   * signaled session failure.
   *
   * Backward-compat alias: `fail()`.
   */
  async workflowFailed(error) {
    if (this.finalized) return void 0;
    this.finalized = true;
    try {
      return await this.emit({
        event_type: "WorkflowFailed",
        status: "failed",
        error: errorInfoFrom(error)
      });
    } finally {
      this.cleanupExitHandlers();
    }
  }
  /** @deprecated use `workflowFailed()`; same behavior. */
  async fail(error) {
    return this.workflowFailed(error);
  }
  /**
   * Public escape for firing arbitrary (eventType, activityType, payload)
   * tuples beyond what the bound preset's typed methods cover. Used by
   * runtime adapters (claude-hooks / cursor-hooks) when one hook event
   * needs to dispatch to multiple activity_types based on internal
   * routing; e.g. Claude's PreToolUse hook fires FileRead, FileEdit,
   * ShellExecution etc. depending on `tool_name`.
   *
   * Mirrors the `custom` preset's free-form `activity()`. Same lifecycle
   * invariants (workflow open, paired Start/Complete, idempotent terminal).
   */
  async activity(eventType, activityType, payload) {
    return this.runActivity(eventType, activityType, payload);
  }
  /**
   * Split-stage activity for callers that must run business logic between
   * the input gate and the output gate (e.g. governed tools that gate the
   * produced artifact). Emits ActivityStarted and returns the gate verdict
   * plus a `complete()` bound to the same activity id, so the pair cannot
   * drift apart. Stopped starts (block/halt) and pending approvals are
   * canonically left unpaired; the caller resolves them via the workflow
   * terminal or approval resume (ActivityCompleted with this activity id).
   */
  async openActivity(activityType, payload) {
    if (this.finalized) throw new SessionAlreadyTerminatedError();
    if (!this.opened && !this.autoOpenSuppressed) await this.begin();
    const activityId = payload.activityId ?? randomUUID();
    const startTime = payload.startTime ?? Date.now();
    this.activityStartsMs.set(activityId, startTime);
    this.inFlight.add(activityId);
    try {
      const verdict = await this.emitWithSpanHook({
        event_type: "ActivityStarted",
        activity_id: activityId,
        activity_type: activityType,
        activity_input: payload.input,
        start_time: startTime,
        spans: payload.spans
      });
      verdict.activityId = activityId;
      if (verdict.arm !== "allow" && verdict.arm !== "constrain") {
        this.activityStartsMs.delete(activityId);
      }
      return {
        activityId,
        verdict,
        complete: (completionPayload, completionActivityType) => this.runActivity(
          "ActivityCompleted",
          completionActivityType ?? activityType,
          { ...completionPayload, activityId }
        )
      };
    } finally {
      this.inFlight.delete(activityId);
    }
  }
  /**
   * Run one activity through the canonical envelope. Preset classes
   * call this with their fixed (eventType, activityType) tuple; the
   * `custom` preset takes them from the user.
   *
   * Strategy depends on `eventType`:
   *   ActivityStarted   → emit start; pre-stage block → no completion fired.
   *                       Otherwise emit a paired ActivityCompleted.
   *   ActivityCompleted → emit completion only (post-stage observe / gate).
   *   SignalReceived    → fire-and-forget telemetry (no gate).
   */
  async runActivity(eventType, activityType, payload) {
    if (this.finalized) throw new SessionAlreadyTerminatedError();
    if (!this.opened && !this.autoOpenSuppressed) await this.begin();
    const activityId = payload.activityId ?? randomUUID();
    const startTime = payload.startTime ?? Date.now();
    this.inFlight.add(activityId);
    try {
      if (eventType === "SignalReceived") {
        const signalVerdict = await this.emit({
          event_type: "SignalReceived",
          activity_id: activityId,
          activity_type: activityType,
          activity_input: payload.input,
          signal_name: payload.signalName,
          signal_args: payload.signalArgs,
          spans: payload.spans
        });
        signalVerdict.activityId = activityId;
        return signalVerdict;
      }
      if (eventType === "ActivityStarted") {
        this.activityStartsMs.set(activityId, startTime);
        const startedVerdict = await this.emitWithSpanHook({
          event_type: "ActivityStarted",
          activity_id: activityId,
          activity_type: activityType,
          activity_input: payload.input,
          start_time: startTime,
          spans: payload.spans
        });
        startedVerdict.activityId = activityId;
        if (startedVerdict.arm === "constrain") {
          try {
            await this.emitCompleted(activityId, activityType, payload);
          } catch {
          }
          return startedVerdict;
        }
        if (startedVerdict.arm !== "allow") {
          this.activityStartsMs.delete(activityId);
          if (startedVerdict.arm === "require_approval") {
            const approvalId = startedVerdict.approvalId ?? activityId;
            if (this.onPendingApproval) {
              try {
                await this.onPendingApproval({
                  approvalId,
                  governanceEventId: startedVerdict.governanceEventId,
                  activityId,
                  activityType,
                  expiresAt: startedVerdict.approvalExpiresAt,
                  reason: startedVerdict.reason
                });
              } catch {
              }
            }
            if (this.inlineApproval) {
              return startedVerdict;
            }
            const polled = await this.pollApproval(activityId, activityType, startedVerdict);
            polled.activityId = activityId;
            if (this.onApprovalResolved) {
              try {
                await this.onApprovalResolved({
                  approvalId,
                  activityId,
                  activityType,
                  arm: polled.arm
                });
              } catch {
              }
            }
            return polled;
          }
          return startedVerdict;
        }
        return this.emitCompleted(activityId, activityType, payload);
      }
      return this.emitCompleted(activityId, activityType, payload);
    } finally {
      this.inFlight.delete(activityId);
    }
  }
  async emitCompleted(activityId, activityType, payload) {
    const startTime = payload.startTime ?? this.activityStartsMs.get(activityId);
    const endTime = payload.endTime ?? Date.now();
    const durationMs = payload.durationMs ?? (typeof startTime === "number" ? Math.max(0, endTime - startTime) : void 0);
    const completedVerdict = await this.emitWithSpanHook({
      event_type: "ActivityCompleted",
      activity_id: activityId,
      activity_type: activityType,
      status: activityCompletionStatus(activityType),
      activity_input: payload.input,
      activity_output: payload.output,
      start_time: startTime,
      end_time: endTime,
      duration_ms: durationMs,
      spans: payload.spans
    });
    this.activityStartsMs.delete(activityId);
    completedVerdict.activityId = activityId;
    if (completedVerdict.arm === "require_approval") {
      const approvalId = completedVerdict.approvalId ?? activityId;
      if (this.onPendingApproval) {
        try {
          await this.onPendingApproval({
            approvalId,
            governanceEventId: completedVerdict.governanceEventId,
            activityId,
            activityType,
            expiresAt: completedVerdict.approvalExpiresAt,
            reason: completedVerdict.reason
          });
        } catch {
        }
      }
      if (this.inlineApproval) {
        return completedVerdict;
      }
      const polled = await this.pollApproval(activityId, activityType, completedVerdict);
      polled.activityId = activityId;
      if (this.onApprovalResolved) {
        try {
          await this.onApprovalResolved({ approvalId, activityId, activityType, arm: polled.arm });
        } catch {
        }
      }
      return polled;
    }
    return completedVerdict;
  }
  async emitWithSpanHook(event) {
    const hasActivitySpans = (event.event_type === "ActivityStarted" || event.event_type === "ActivityCompleted") && Array.isArray(event.spans) && event.spans.some(isPersistableHookSpan);
    if (!hasActivitySpans) return this.emit(event);
    const baseVerdict = await this.emit({ ...event, spans: void 0 });
    if (baseVerdict.arm !== "allow" && baseVerdict.arm !== "constrain") {
      return baseVerdict;
    }
    const hookVerdict = await this.emit({
      ...event,
      hook_trigger: true
    });
    return stricterVerdict(baseVerdict, hookVerdict);
  }
  async emit(event) {
    const payload = {
      ...event,
      source: "workflow-telemetry",
      workflow_id: this.workflowId,
      run_id: this.runId,
      workflow_type: this.workflowType,
      task_queue: this.taskQueue,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      span_count: event.spans?.length
    };
    const response = await this.core.evaluate(payload);
    return mapVerdict(response);
  }
  async pollApproval(activityId, activityType, initial) {
    const approvalId = initial.approvalId ?? activityId;
    const cfgDeadline = Date.now() + this.approvalMaxWaitMs;
    const srvDeadline = initial.approvalExpiresAt ? new Date(initial.approvalExpiresAt).getTime() : Number.POSITIVE_INFINITY;
    const deadline = Math.min(cfgDeadline, srvDeadline);
    let externalSignaled = false;
    const externalDecision = this.awaitExternalDecision ? this.awaitExternalDecision({
      approvalId,
      governanceEventId: initial.governanceEventId,
      activityId,
      activityType,
      expiresAt: initial.approvalExpiresAt
    }).then(
      (d) => {
        externalSignaled = d === "approve" || d === "reject";
        return d;
      },
      () => void 0
    ) : void 0;
    let nextInterval = this.approvalPollIntervalMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const jittered = applyJitter(nextInterval, this.approvalPollJitter);
      const sleepMs = Math.max(0, Math.min(jittered, remaining));
      if (externalDecision) {
        await Promise.race([sleep(sleepMs), externalDecision]);
      } else {
        await sleep(sleepMs);
      }
      const status = await this.core.pollApproval({
        workflow_id: this.workflowId,
        run_id: this.runId,
        activity_id: activityId
      });
      if (status.action && status.action !== "require_approval") {
        return {
          arm: normalizeArm(status.action),
          approvalId: initial.approvalId,
          governanceEventId: initial.governanceEventId,
          approvalExpiresAt: status.approval_expiration_time,
          reason: status.reason,
          riskScore: initial.riskScore,
          trustTier: initial.trustTier
        };
      }
      nextInterval = externalSignaled ? this.approvalPollIntervalMs : Math.min(
        nextInterval * this.approvalPollBackoffFactor,
        this.approvalPollMaxIntervalMs
      );
    }
    return initial;
  }
  /**
   * Best-effort handlers for process death. SIGINT/SIGTERM/uncaught
   * exceptions get a brief async window to fire WorkflowFailed; `exit`
   * is synchronous-only so we just log a warning. Multiple sessions in
   * the same process each register their own handlers; cleanup on
   * normal completion removes them.
   */
  installExitHandlers() {
    if (typeof process === "undefined" || !process.on) return;
    const failOnSignal = (reason) => async () => {
      if (this.finalized) return;
      try {
        await Promise.race([
          this.fail(new Error(`process_exit:${reason}`)),
          sleep(2e3)
        ]);
      } catch {
      }
    };
    const sigint = failOnSignal("SIGINT");
    const sigterm = failOnSignal("SIGTERM");
    const beforeExit = failOnSignal("beforeExit");
    const uncaught = (err) => {
      void failOnSignal("uncaughtException")();
    };
    const unhandled = (err) => {
      void failOnSignal("unhandledRejection")();
    };
    process.on("SIGINT", sigint);
    process.on("SIGTERM", sigterm);
    process.on("beforeExit", beforeExit);
    process.on("uncaughtException", uncaught);
    process.on("unhandledRejection", unhandled);
    this.exitHandlerCleanup.push(() => {
      process.removeListener("SIGINT", sigint);
      process.removeListener("SIGTERM", sigterm);
      process.removeListener("beforeExit", beforeExit);
      process.removeListener("uncaughtException", uncaught);
      process.removeListener("unhandledRejection", unhandled);
    });
  }
  cleanupExitHandlers() {
    for (const fn of this.exitHandlerCleanup) {
      try {
        fn();
      } catch {
      }
    }
    this.exitHandlerCleanup.length = 0;
  }
};
function activityCompletionStatus(activityType) {
  return /(error|fail|failed|failure|timeout|timedout|cancel|abort)/i.test(activityType) ? "failed" : "completed";
}
function toolActivityTypeFromPayload(payload) {
  const direct = namedToolFromRecord(payload);
  if (direct) return direct;
  for (const item of payload.input ?? []) {
    const name = namedToolFromRecord(item);
    if (name) return name;
  }
  return "ToolCall";
}
function namedToolFromRecord(value) {
  if (!value || typeof value !== "object") return void 0;
  const record = value;
  const direct = firstNonEmptyString(
    record.toolName,
    record.tool_name,
    record.tool,
    record.name
  );
  if (direct) return direct;
  return namedToolFromRecord(record.toolCall) ?? namedToolFromRecord(record.tool_call) ?? namedToolFromRecord(record.call) ?? namedToolFromRecord(record.args);
}
function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return void 0;
}
var AirflowSession = class extends BaseGovernedSession {
  async onExecuteCallback(payload) {
    return this.runActivity("ActivityStarted", "on_execute_callback", payload);
  }
  async onSuccessCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_success_callback", payload);
  }
  async onFailureCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_failure_callback", payload);
  }
  async onRetryCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_retry_callback", payload);
  }
  async slaMissCallback(payload) {
    return this.runActivity("ActivityCompleted", "sla_miss_callback", payload);
  }
  async onSkippedCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_skipped_callback", payload);
  }
};
var ArgocdSession = class extends BaseGovernedSession {
  async operationStarted(payload) {
    return this.runActivity("ActivityStarted", "OperationStarted", payload);
  }
  async operationCompleted(payload) {
    return this.runActivity("ActivityCompleted", "OperationCompleted", payload);
  }
  async resourceUpdated(payload) {
    return this.runActivity("ActivityCompleted", "ResourceUpdated", payload);
  }
  async preSyncHookStarted(payload) {
    return this.runActivity("ActivityStarted", "PreSyncHookStarted", payload);
  }
  async preSyncHookSucceeded(payload) {
    return this.runActivity("ActivityCompleted", "PreSyncHookSucceeded", payload);
  }
  async syncStatusChanged(payload) {
    return this.runActivity("ActivityCompleted", "SyncStatusChanged", payload);
  }
};
var AutogenSession = class extends BaseGovernedSession {
  async textMessage(payload) {
    return this.runActivity("ActivityCompleted", "TextMessage", payload);
  }
  async multiModalMessage(payload) {
    return this.runActivity("ActivityCompleted", "MultiModalMessage", payload);
  }
  async toolCallRequestEvent(payload) {
    return this.runActivity("ActivityStarted", "ToolCallRequestEvent", payload);
  }
  async toolCallExecutionEvent(payload) {
    return this.runActivity("ActivityCompleted", "ToolCallExecutionEvent", payload);
  }
  async memoryQueryEvent(payload) {
    return this.runActivity("ActivityCompleted", "MemoryQueryEvent", payload);
  }
  async userInputRequestedEvent(payload) {
    return this.runActivity("SignalReceived", "UserInputRequestedEvent", payload);
  }
  async handoffMessage(payload) {
    return this.runActivity("SignalReceived", "HandoffMessage", payload);
  }
  async stopMessage(payload) {
    return this.runActivity("ActivityCompleted", "StopMessage", payload);
  }
};
var ClaudeCodeSession = class extends BaseGovernedSession {
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "PreToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "PostToolUse", payload);
  }
  async userPromptSubmit(payload) {
    return this.runActivity("ActivityStarted", "UserPromptSubmit", payload);
  }
  async permissionRequest(payload) {
    return this.runActivity("ActivityStarted", "PermissionRequest", payload);
  }
  async preCompact(payload) {
    return this.runActivity("ActivityStarted", "PreCompact", payload);
  }
  async subagentStop(payload) {
    return this.runActivity("ActivityStarted", "SubagentStop", payload);
  }
  async notification(payload) {
    return this.runActivity("ActivityCompleted", "Notification", payload);
  }
  async stop(payload) {
    return this.runActivity("ActivityCompleted", "Stop", payload);
  }
};
var ClineSession = class extends BaseGovernedSession {
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "PreToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "PostToolUse", payload);
  }
  async userPromptSubmit(payload) {
    return this.runActivity("ActivityStarted", "UserPromptSubmit", payload);
  }
  async taskStart(payload) {
    return this.runActivity("ActivityStarted", "TaskStart", payload);
  }
};
var CodexSession = class extends BaseGovernedSession {
  async userPromptSubmit(payload) {
    return this.runActivity("ActivityStarted", "UserPromptSubmit", payload);
  }
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "PreToolUse", payload);
  }
  async permissionRequest(payload) {
    return this.runActivity("ActivityStarted", "PermissionRequest", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "PostToolUse", payload);
  }
  async stop(payload) {
    return this.runActivity("ActivityCompleted", "Stop", payload);
  }
};
var CopilotSession = class extends BaseGovernedSession {
  async userPromptSubmitted(payload) {
    return this.runActivity("ActivityStarted", "userPromptSubmitted", payload);
  }
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "preToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "postToolUse", payload);
  }
  async agentStop(payload) {
    return this.runActivity("ActivityCompleted", "agentStop", payload);
  }
  async subagentStop(payload) {
    return this.runActivity("ActivityCompleted", "subagentStop", payload);
  }
  async errorOccurred(payload) {
    return this.runActivity("ActivityCompleted", "errorOccurred", payload);
  }
};
var CrewaiSession = class extends BaseGovernedSession {
  async crewKickoffStarted(payload) {
    return this.runActivity("ActivityStarted", "CrewKickoffStarted", payload);
  }
  async crewKickoffCompleted(payload) {
    return this.runActivity("ActivityCompleted", "CrewKickoffCompleted", payload);
  }
  async agentExecutionStarted(payload) {
    return this.runActivity("ActivityStarted", "AgentExecutionStarted", payload);
  }
  async agentExecutionCompleted(payload) {
    return this.runActivity("ActivityCompleted", "AgentExecutionCompleted", payload);
  }
  async taskStarted(payload) {
    return this.runActivity("ActivityStarted", "TaskStarted", payload);
  }
  async taskCompleted(payload) {
    return this.runActivity("ActivityCompleted", "TaskCompleted", payload);
  }
  async toolUsageStarted(payload) {
    return this.runActivity("ActivityStarted", "ToolUsageStarted", payload);
  }
  async toolUsageFinished(payload) {
    return this.runActivity("ActivityCompleted", "ToolUsageFinished", payload);
  }
  async toolUsageError(payload) {
    return this.runActivity("ActivityCompleted", "ToolUsageError", payload);
  }
  async llmCallStarted(payload) {
    return this.runActivity("ActivityStarted", "LLMCallStarted", payload);
  }
  async llmCallCompleted(payload) {
    return this.runActivity("ActivityCompleted", "LLMCallCompleted", payload);
  }
};
var CursorSession = class extends BaseGovernedSession {
  async beforeSubmitPrompt(payload) {
    return this.runActivity("ActivityStarted", "beforeSubmitPrompt", payload);
  }
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "preToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "postToolUse", payload);
  }
  async beforeShellExecution(payload) {
    return this.runActivity("ActivityStarted", "beforeShellExecution", payload);
  }
  async afterShellExecution(payload) {
    return this.runActivity("ActivityCompleted", "afterShellExecution", payload);
  }
  async beforeMCPExecution(payload) {
    return this.runActivity("ActivityStarted", "beforeMCPExecution", payload);
  }
  async afterMCPExecution(payload) {
    return this.runActivity("ActivityCompleted", "afterMCPExecution", payload);
  }
  async beforeReadFile(payload) {
    return this.runActivity("ActivityStarted", "beforeReadFile", payload);
  }
  async afterFileEdit(payload) {
    return this.runActivity("ActivityCompleted", "afterFileEdit", payload);
  }
  async afterAgentResponse(payload) {
    return this.runActivity("ActivityCompleted", "afterAgentResponse", payload);
  }
  async afterAgentThought(payload) {
    return this.runActivity("ActivityCompleted", "afterAgentThought", payload);
  }
};
var CustomSession = class extends BaseGovernedSession {
  /**
   * Run an arbitrary activity. The runtime stamps:
   *   stage="pre"  → event_type=ActivityStarted
   *   stage="post" → event_type=ActivityCompleted
   */
  async activity(activityType, stage, payload) {
    const eventType = stage === "pre" ? "ActivityStarted" : "ActivityCompleted";
    return this.runActivity(eventType, activityType, payload);
  }
};
var DefaultSession = class extends BaseGovernedSession {
  async prompt(payload) {
    return this.runActivity("ActivityStarted", "PromptSubmission", payload);
  }
  async llm(payload) {
    return this.runActivity("ActivityCompleted", "LLMCompleted", payload);
  }
  async tool(payload) {
    return this.runActivity("ActivityStarted", "ToolStarted", payload);
  }
  async toolCompleted(payload) {
    return this.runActivity("ActivityCompleted", "ToolCompleted", payload);
  }
  async read(payload) {
    return this.runActivity("ActivityStarted", "FileRead", payload);
  }
  async write(payload) {
    return this.runActivity("ActivityStarted", "FileEdit", payload);
  }
  async fileDelete(payload) {
    return this.runActivity("ActivityStarted", "FileDelete", payload);
  }
  async shell(payload) {
    return this.runActivity("ActivityStarted", "ShellExecution", payload);
  }
  async httpRequest(payload) {
    return this.runActivity("ActivityStarted", "HTTPRequest", payload);
  }
  async mcpToolCall(payload) {
    return this.runActivity("ActivityStarted", "MCPToolCall", payload);
  }
  async agentSpawn(payload) {
    return this.runActivity("ActivityStarted", "AgentSpawn", payload);
  }
};
var LangchainSession = class extends BaseGovernedSession {
  async onLlmStart(payload) {
    return this.runActivity("ActivityStarted", "on_llm_start", payload);
  }
  async onLlmEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_llm_end", payload);
  }
  async onLlmError(payload) {
    return this.runActivity("ActivityCompleted", "on_llm_error", payload);
  }
  async onChatModelStart(payload) {
    return this.runActivity("ActivityStarted", "on_chat_model_start", payload);
  }
  async onToolStart(payload) {
    return this.runActivity("ActivityStarted", toolActivityTypeFromPayload(payload), payload);
  }
  async onToolEnd(payload) {
    return this.runActivity("ActivityCompleted", toolActivityTypeFromPayload(payload), payload);
  }
  async onToolError(payload) {
    return this.runActivity("ActivityCompleted", "on_tool_error", payload);
  }
  async onChainStart(payload) {
    return this.runActivity("ActivityStarted", "on_chain_start", payload);
  }
  async onChainEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_chain_end", payload);
  }
  async onAgentAction(payload) {
    return this.runActivity("ActivityCompleted", "on_agent_action", payload);
  }
  async onAgentFinish(payload) {
    return this.runActivity("ActivityCompleted", "on_agent_finish", payload);
  }
  async onRetrieverStart(payload) {
    return this.runActivity("ActivityStarted", "on_retriever_start", payload);
  }
  async onRetrieverEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_retriever_end", payload);
  }
};
var LanggraphSession = class extends BaseGovernedSession {
  async nodeStart(payload) {
    return this.runActivity("ActivityStarted", "node_start", payload);
  }
  async nodeEnd(payload) {
    return this.runActivity("ActivityCompleted", "node_end", payload);
  }
  async interrupt(payload) {
    return this.runActivity("SignalReceived", "interrupt", payload);
  }
  async checkpoint(payload) {
    return this.runActivity("SignalReceived", "checkpoint", payload);
  }
  async taskStart(payload) {
    return this.runActivity("ActivityStarted", "task_start", payload);
  }
  async taskEnd(payload) {
    return this.runActivity("ActivityCompleted", "task_end", payload);
  }
  async customEvent(payload) {
    return this.runActivity("SignalReceived", "custom_event", payload);
  }
};
var LlamaindexSession = class extends BaseGovernedSession {
  async chunking(payload) {
    return this.runActivity("ActivityStarted", "CHUNKING", payload);
  }
  async llm(payload) {
    return this.runActivity("ActivityCompleted", "LLM", payload);
  }
  async query(payload) {
    return this.runActivity("ActivityStarted", "QUERY", payload);
  }
  async retrieve(payload) {
    return this.runActivity("ActivityStarted", "RETRIEVE", payload);
  }
  async synthesize(payload) {
    return this.runActivity("ActivityCompleted", "SYNTHESIZE", payload);
  }
  async embedding(payload) {
    return this.runActivity("ActivityStarted", "EMBEDDING", payload);
  }
  async functionCall(payload) {
    return this.runActivity("ActivityStarted", "FUNCTION_CALL", payload);
  }
  async agentStep(payload) {
    return this.runActivity("ActivityCompleted", "AGENT_STEP", payload);
  }
  async reranking(payload) {
    return this.runActivity("ActivityCompleted", "RERANKING", payload);
  }
  async subQuestion(payload) {
    return this.runActivity("ActivityStarted", "SUB_QUESTION", payload);
  }
  async exception(payload) {
    return this.runActivity("ActivityCompleted", "EXCEPTION", payload);
  }
};
var MastraSession = class extends BaseGovernedSession {
  async workflowStepStart(payload) {
    return this.runActivity("ActivityStarted", "workflow-step-start", payload);
  }
  async workflowStepFinish(payload) {
    return this.runActivity("ActivityCompleted", "workflow-step-finish", payload);
  }
  async workflowStepProgress(payload) {
    return this.runActivity("ActivityCompleted", "workflow-step-progress", payload);
  }
  async toolCall(payload) {
    return this.runActivity("ActivityStarted", "tool-call", payload);
  }
  async toolResult(payload) {
    return this.runActivity("ActivityCompleted", "tool-result", payload);
  }
  async error(payload) {
    return this.runActivity("ActivityCompleted", "error", payload);
  }
};
var ModernTreasurySession = class extends BaseGovernedSession {
  async paymentOrderApproved(payload) {
    return this.runActivity("ActivityStarted", "payment_order.approved", payload);
  }
  async paymentOrderBeginProcessing(payload) {
    return this.runActivity("ActivityStarted", "payment_order.begin_processing", payload);
  }
  async paymentOrderFailed(payload) {
    return this.runActivity("ActivityCompleted", "payment_order.failed", payload);
  }
  async paymentOrderReconciled(payload) {
    return this.runActivity("ActivityCompleted", "payment_order.reconciled", payload);
  }
  async paymentReferenceCreated(payload) {
    return this.runActivity("ActivityCompleted", "payment_reference.created", payload);
  }
};
var N8nSession = class extends BaseGovernedSession {
  async nodePreExecute(payload) {
    return this.runActivity("ActivityStarted", "node-pre-execute", payload);
  }
  async nodePostExecute(payload) {
    return this.runActivity("ActivityCompleted", "node-post-execute", payload);
  }
  async errorTrigger(payload) {
    return this.runActivity("ActivityCompleted", "error-trigger", payload);
  }
};
var PagerdutySession = class extends BaseGovernedSession {
  async incidentTriggered(payload) {
    return this.runActivity("ActivityStarted", "incident.triggered", payload);
  }
  async incidentAcknowledged(payload) {
    return this.runActivity("ActivityCompleted", "incident.acknowledged", payload);
  }
  async incidentEscalated(payload) {
    return this.runActivity("ActivityCompleted", "incident.escalated", payload);
  }
  async incidentReassigned(payload) {
    return this.runActivity("ActivityCompleted", "incident.reassigned", payload);
  }
  async incidentDelegated(payload) {
    return this.runActivity("ActivityCompleted", "incident.delegated", payload);
  }
  async incidentPriorityUpdated(payload) {
    return this.runActivity("ActivityCompleted", "incident.priority_updated", payload);
  }
  async incidentResolved(payload) {
    return this.runActivity("ActivityCompleted", "incident.resolved", payload);
  }
  async incidentReopened(payload) {
    return this.runActivity("ActivityCompleted", "incident.reopened", payload);
  }
  async incidentUnacknowledged(payload) {
    return this.runActivity("ActivityCompleted", "incident.unacknowledged", payload);
  }
  async incidentAnnotated(payload) {
    return this.runActivity("ActivityCompleted", "incident.annotated", payload);
  }
};
var PydanticAiSession = class extends BaseGovernedSession {
  async userPromptNode(payload) {
    return this.runActivity("ActivityStarted", "UserPromptNode", payload);
  }
  async modelRequestNode(payload) {
    return this.runActivity("ActivityStarted", "ModelRequestNode", payload);
  }
  async callToolsNode(payload) {
    return this.runActivity("ActivityCompleted", "CallToolsNode", payload);
  }
  async end(payload) {
    return this.runActivity("ActivityCompleted", "End", payload);
  }
  async outputValidator(payload) {
    return this.runActivity("ActivityCompleted", "output_validator", payload);
  }
  async toolRetry(payload) {
    return this.runActivity("ActivityCompleted", "tool_retry", payload);
  }
};
var SemanticKernelSession = class extends BaseGovernedSession {
  async functionInvocationPre(payload) {
    return this.runActivity("ActivityStarted", "function_invocation_pre", payload);
  }
  async functionInvocationPost(payload) {
    return this.runActivity("ActivityCompleted", "function_invocation_post", payload);
  }
  async promptRenderPre(payload) {
    return this.runActivity("ActivityStarted", "prompt_render_pre", payload);
  }
  async promptRenderPost(payload) {
    return this.runActivity("ActivityCompleted", "prompt_render_post", payload);
  }
  async autoFunctionInvocationPre(payload) {
    return this.runActivity("ActivityStarted", "auto_function_invocation_pre", payload);
  }
  async autoFunctionInvocationPost(payload) {
    return this.runActivity("ActivityCompleted", "auto_function_invocation_post", payload);
  }
};
var TemporalSession = class extends BaseGovernedSession {
  async activityTaskScheduled(payload) {
    return this.runActivity("ActivityStarted", "ActivityTaskScheduled", payload);
  }
  async activityTaskStarted(payload) {
    return this.runActivity("ActivityStarted", "ActivityTaskStarted", payload);
  }
  async activityTaskCompleted(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskCompleted", payload);
  }
  async activityTaskFailed(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskFailed", payload);
  }
  async activityTaskTimedOut(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskTimedOut", payload);
  }
  async activityTaskCanceled(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskCanceled", payload);
  }
  async childWorkflowExecutionInitiated(payload) {
    return this.runActivity("ActivityStarted", "ChildWorkflowExecutionInitiated", payload);
  }
  async childWorkflowExecutionCompleted(payload) {
    return this.runActivity("ActivityCompleted", "ChildWorkflowExecutionCompleted", payload);
  }
  async workflowExecutionSignaled(payload) {
    return this.runActivity("SignalReceived", "WorkflowExecutionSignaled", payload);
  }
  async markerRecorded(payload) {
    return this.runActivity("SignalReceived", "MarkerRecorded", payload);
  }
  async timerStarted(payload) {
    return this.runActivity("SignalReceived", "TimerStarted", payload);
  }
  async timerFired(payload) {
    return this.runActivity("SignalReceived", "TimerFired", payload);
  }
};
var VercelAiSession = class extends BaseGovernedSession {
  async onStepFinish(payload) {
    return this.runActivity("ActivityCompleted", "onStepFinish", payload);
  }
  async onFinish(payload) {
    return this.runActivity("ActivityCompleted", "onFinish", payload);
  }
  async onError(payload) {
    return this.runActivity("ActivityCompleted", "onError", payload);
  }
  async onAbort(payload) {
    return this.runActivity("ActivityCompleted", "onAbort", payload);
  }
};
var presets = {
  airflow: AirflowSession,
  argocd: ArgocdSession,
  autogen: AutogenSession,
  claudeCode: ClaudeCodeSession,
  cline: ClineSession,
  codex: CodexSession,
  copilot: CopilotSession,
  crewai: CrewaiSession,
  cursor: CursorSession,
  custom: CustomSession,
  default: DefaultSession,
  langchain: LangchainSession,
  langgraph: LanggraphSession,
  llamaindex: LlamaindexSession,
  mastra: MastraSession,
  modernTreasury: ModernTreasurySession,
  n8n: N8nSession,
  pagerduty: PagerdutySession,
  pydanticAi: PydanticAiSession,
  semanticKernel: SemanticKernelSession,
  temporal: TemporalSession,
  vercelAi: VercelAiSession
};
async function govern(config, body) {
  const { preset: Ctor, ...sessionConfig } = config;
  const session = new Ctor(sessionConfig);
  try {
    await session.workflowStarted();
    const result = await body(session);
    await session.workflowCompleted();
    return result;
  } catch (err) {
    await session.workflowFailed(err);
    throw err;
  }
}
function governAttach(config) {
  const { preset: Ctor, ...rest } = config;
  return new Ctor({
    ...rest,
    registerExitHandlers: rest.registerExitHandlers ?? false,
    attached: true
  });
}
((govern2) => {
  govern2.attach = governAttach;
})(govern || (govern = {}));
function mapVerdict(response) {
  return {
    arm: normalizeArm(response.verdict ?? response.action ?? "allow"),
    approvalId: response.approval_id,
    // Cross-reference key for matching this verdict against the
    // backend's persisted Approval row (whose `event_id` field equals
    // the response's `governance_event_id`). The backend currently
    // omits `approval_id` from /governance/evaluate responses, so this
    // is the one stable identifier consumers can use to dedup against
    // the dashboard's pending-approvals list.
    governanceEventId: response.governance_event_id,
    approvalExpiresAt: response.approval_expiration_time,
    reason: response.reason,
    riskScore: response.risk_score ?? 0,
    trustTier: response.trust_tier ?? void 0,
    guardrailsResult: mapGuardrailsResult(response.guardrails_result),
    ageResult: response.age_result
  };
}
function mapGuardrailsResult(raw) {
  if (!raw) return void 0;
  return {
    inputType: raw.input_type ?? "activity_input",
    redactedInput: raw.redacted_input,
    validationPassed: raw.validation_passed !== false,
    reasons: (raw.reasons ?? []).map((r) => ({
      type: String(r.type ?? ""),
      field: r.field,
      reason: String(r.reason ?? "")
    })),
    fieldResults: (raw.results ?? []).flatMap((g) => (g.results ?? []).map((fr) => ({
      field: String(fr.field ?? ""),
      status: normalizeGuardrailFieldStatus(fr.status),
      reason: fr.reason
    })))
  };
}
function normalizeGuardrailFieldStatus(value) {
  switch (value) {
    case "allowed":
    case "allow":
      return "allowed";
    case "blocked":
    case "block":
      return "blocked";
    case "redacted":
    case "transformed":
      return "redacted";
    case "skipped":
    default:
      return "skipped";
  }
}
function normalizeArm(value) {
  switch (value) {
    case "allow":
    case "continue":
      return "allow";
    case "constrain":
      return "constrain";
    case "require_approval":
    case "require-approval":
      return "require_approval";
    case "block":
      return "block";
    case "halt":
    case "stop":
      return "halt";
    default:
      return "allow";
  }
}
function verdictRank(arm) {
  switch (arm) {
    case "halt":
      return 4;
    case "block":
      return 3;
    case "require_approval":
      return 2;
    case "constrain":
      return 1;
    case "allow":
    default:
      return 0;
  }
}
function stricterVerdict(base2, hook) {
  return verdictRank(hook.arm) >= verdictRank(base2.arm) ? hook : base2;
}
function isPersistableHookSpan(span) {
  if (!span || typeof span !== "object") return false;
  const record = span;
  if (typeof record.semantic_type === "string" && record.semantic_type !== "") {
    return true;
  }
  const attributes = record.attributes && typeof record.attributes === "object" ? record.attributes : {};
  return typeof attributes["openbox.tool.name"] === "string" || typeof attributes["tool.name"] === "string" || typeof attributes.tool_name === "string" || typeof attributes["gen_ai.system"] === "string";
}
function errorInfoFrom(value) {
  if (value == null) return void 0;
  if (value instanceof Error) {
    return { type: value.name || "Error", message: value.message };
  }
  return { type: typeof value, message: String(value) };
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function applyJitter(baseMs, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f === 0) return baseMs;
  const noise = (Math.random() * 2 - 1) * f;
  return baseMs * (1 + noise);
}

// ts/src/core-client/generated/runtime/claude-code.ts
var PRE_TOOL_USE_ROUTING = {
  "Read": "FileRead",
  "Write": "FileEdit",
  "Edit": "FileEdit",
  "Delete": "FileDelete",
  "MultiEdit": "FileEdit",
  "NotebookEdit": "FileEdit",
  "NotebookRead": "FileRead",
  "Glob": "FileRead",
  "Grep": "FileRead",
  "Bash": "ShellExecution",
  "PowerShell": "ShellExecution",
  "WebFetch": "HTTPRequest",
  "WebSearch": "HTTPRequest",
  "Agent": "AgentSpawn",
  "Skill": "AgentAction",
  "TodoWrite": "AgentAction",
  "AskUserQuestion": "AgentAction",
  "EnterPlanMode": "AgentAction",
  "ExitPlanMode": "AgentAction",
  "EnterWorktree": "AgentAction",
  "CronCreate": "AgentAction",
  "CronDelete": "AgentAction",
  "CronList": "AgentAction"
};
var POST_TOOL_USE_ROUTING = {
  "Read": "FileRead",
  "Write": "FileEdit",
  "Edit": "FileEdit",
  "Delete": "FileDelete",
  "MultiEdit": "FileEdit",
  "NotebookEdit": "FileEdit",
  "NotebookRead": "FileRead",
  "Glob": "FileRead",
  "Grep": "FileRead",
  "Bash": "ShellExecution",
  "PowerShell": "ShellExecution",
  "WebFetch": "HTTPRequest",
  "WebSearch": "HTTPRequest",
  "Agent": "AgentSpawn",
  "Skill": "AgentAction",
  "TodoWrite": "AgentAction",
  "AskUserQuestion": "AgentAction",
  "EnterPlanMode": "AgentAction",
  "ExitPlanMode": "AgentAction",
  "EnterWorktree": "AgentAction",
  "CronCreate": "AgentAction",
  "CronDelete": "AgentAction",
  "CronList": "AgentAction"
};
var PERMISSION_REQUEST_ROUTING = {
  "Read": "FileRead",
  "Write": "FileEdit",
  "Edit": "FileEdit",
  "Delete": "FileDelete",
  "MultiEdit": "FileEdit",
  "NotebookEdit": "FileEdit",
  "NotebookRead": "FileRead",
  "Glob": "FileRead",
  "Grep": "FileRead",
  "Bash": "ShellExecution",
  "PowerShell": "ShellExecution",
  "WebFetch": "HTTPRequest",
  "WebSearch": "HTTPRequest",
  "Agent": "AgentSpawn",
  "Skill": "AgentAction",
  "TodoWrite": "AgentAction",
  "AskUserQuestion": "AgentAction",
  "EnterPlanMode": "AgentAction",
  "ExitPlanMode": "AgentAction",
  "EnterWorktree": "AgentAction",
  "CronCreate": "AgentAction",
  "CronDelete": "AgentAction",
  "CronList": "AgentAction"
};
var HOOK_SPEC = {
  "file": ".claude/settings.json",
  "key": "hooks",
  "style": "claude-array",
  "command": "openbox claude-code hook",
  "configDir": ".claude-hooks",
  "events": [
    {
      "name": "PreToolUse",
      "timeout": 86400
    },
    {
      "name": "PostToolUse"
    },
    {
      "name": "PostToolUseFailure"
    },
    {
      "name": "PostToolBatch"
    },
    {
      "name": "UserPromptSubmit",
      "timeout": 86400
    },
    {
      "name": "UserPromptExpansion",
      "timeout": 86400
    },
    {
      "name": "PermissionRequest",
      "timeout": 86400
    },
    {
      "name": "PermissionDenied"
    },
    {
      "name": "Setup"
    },
    {
      "name": "InstructionsLoaded"
    },
    {
      "name": "PreCompact"
    },
    {
      "name": "PostCompact"
    },
    {
      "name": "SessionStart"
    },
    {
      "name": "SessionEnd",
      "timeout": 86400,
      "installDefault": false
    },
    {
      "name": "SubagentStart"
    },
    {
      "name": "SubagentStop"
    },
    {
      "name": "TaskCreated"
    },
    {
      "name": "TaskCompleted"
    },
    {
      "name": "Stop"
    },
    {
      "name": "StopFailure"
    },
    {
      "name": "TeammateIdle"
    },
    {
      "name": "Notification"
    },
    {
      "name": "MessageDisplay"
    },
    {
      "name": "ConfigChange"
    },
    {
      "name": "CwdChanged"
    },
    {
      "name": "FileChanged"
    },
    {
      "name": "WorktreeRemove"
    },
    {
      "name": "Elicitation",
      "timeout": 86400
    },
    {
      "name": "ElicitationResult"
    }
  ]
};
function getPath(env, path10) {
  if (env == null || typeof env !== "object") return void 0;
  let cur = env;
  for (const seg of path10.split(".")) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function buildPreToolUsePayload(env, toolName, sideEffects2 = {}) {
  switch (toolName) {
    case "Read":
      return {
        "text": sideEffects2.readFile?.(getPath(env, "tool_input.file_path")) ?? "",
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": sideEffects2.readFile?.(getPath(env, "tool_input.file_path")) ?? "",
        "event_category": "file_read"
      };
    case "Delete":
      return {
        "text": getPath(env, "tool_input.path") ?? getPath(env, "tool_input.file_path"),
        "file_path": getPath(env, "tool_input.path") ?? getPath(env, "tool_input.file_path"),
        "event_category": "file_delete"
      };
    case "Write":
      return {
        "text": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Edit":
      return {
        "text": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "MultiEdit":
      return {
        "text": getPath(env, "tool_input.edits") ?? getPath(env, "tool_input.content"),
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": getPath(env, "tool_input.edits") ?? getPath(env, "tool_input.content"),
        "event_category": "file_write"
      };
    case "NotebookEdit":
      return {
        "text": getPath(env, "tool_input.new_source") ?? getPath(env, "tool_input.content"),
        "file_path": getPath(env, "tool_input.notebook_path") ?? getPath(env, "tool_input.file_path"),
        "content": getPath(env, "tool_input.new_source") ?? getPath(env, "tool_input.content"),
        "event_category": "file_write"
      };
    case "NotebookRead":
      return {
        "text": sideEffects2.readFile?.(getPath(env, "tool_input.notebook_path")) ?? "",
        "file_path": getPath(env, "tool_input.notebook_path") ?? getPath(env, "tool_input.file_path"),
        "content": sideEffects2.readFile?.(getPath(env, "tool_input.notebook_path")) ?? "",
        "event_category": "file_read"
      };
    case "Glob":
      return {
        "text": getPath(env, "tool_input.pattern"),
        "file_path": getPath(env, "tool_input.path") ?? getPath(env, "cwd"),
        "event_category": "file_read"
      };
    case "Grep":
      return {
        "text": getPath(env, "tool_input.pattern"),
        "file_path": getPath(env, "tool_input.path") ?? getPath(env, "cwd"),
        "event_category": "file_read"
      };
    case "Bash":
      return {
        "text": getPath(env, "tool_input.command"),
        "command": getPath(env, "tool_input.command"),
        "cwd": getPath(env, "tool_input.cwd") ?? getPath(env, "cwd"),
        "event_category": "agent_action"
      };
    case "PowerShell":
      return {
        "text": getPath(env, "tool_input.command"),
        "command": getPath(env, "tool_input.command"),
        "cwd": getPath(env, "tool_input.cwd") ?? getPath(env, "cwd"),
        "event_category": "agent_action"
      };
    case "WebFetch":
      return {
        "url": getPath(env, "tool_input.url") ?? getPath(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "WebSearch":
      return {
        "url": getPath(env, "tool_input.url") ?? getPath(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "Agent":
      return {
        "agent_type": getPath(env, "tool_input.subagent_type") ?? getPath(env, "tool_input.description"),
        "prompt": getPath(env, "tool_input.prompt"),
        "event_category": "agent_action"
      };
    case "AskUserQuestion":
      return {
        "text": getPath(env, "tool_input.question") ?? getPath(env, "tool_input.message"),
        "event_category": "agent_action"
      };
    case "ExitPlanMode":
      return {
        "text": getPath(env, "tool_input.plan"),
        "event_category": "agent_action"
      };
    case "Skill":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "event_category": "agent_action"
      };
    default:
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "event_category": "mcp_tool_call"
      };
  }
}
function buildPostToolUsePayload(env, sideEffects2 = {}) {
  return {
    "tool_name": getPath(env, "tool_name"),
    "output": sideEffects2.stringifyTruncate?.(getPath(env, "tool_response")) ?? "",
    "event_category": "agent_observation"
  };
}
function buildPostToolUseFailurePayload(env) {
  return {
    "tool_name": getPath(env, "tool_name"),
    "tool_input": getPath(env, "tool_input"),
    "error": getPath(env, "error") ?? getPath(env, "reason"),
    "event_category": "agent_observation"
  };
}
function buildPostToolBatchPayload(env, sideEffects2 = {}) {
  return {
    "tool_calls": getPath(env, "tool_calls"),
    "output": sideEffects2.stringifyTruncate?.(getPath(env, "tool_calls")) ?? "",
    "event_category": "agent_observation"
  };
}
function buildUserPromptSubmitPayload(env) {
  return {
    "text": getPath(env, "prompt"),
    "prompt": getPath(env, "prompt"),
    "model": getPath(env, "model"),
    "event_category": "llm_prompt"
  };
}
function buildUserPromptExpansionPayload(env) {
  return {
    "text": getPath(env, "expanded_prompt") ?? getPath(env, "prompt"),
    "prompt": getPath(env, "expanded_prompt") ?? getPath(env, "prompt"),
    "command_name": getPath(env, "command_name"),
    "command_args": getPath(env, "command_args"),
    "event_category": "llm_prompt"
  };
}
function buildPermissionRequestPayload(env, toolName) {
  switch (toolName) {
    case "Read":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "event_category": "file_read"
      };
    case "Delete":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "file_path": getPath(env, "tool_input.path") ?? getPath(env, "tool_input.file_path"),
        "event_category": "file_delete"
      };
    case "Write":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "text": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Edit":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "text": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Bash":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "text": getPath(env, "tool_input.command"),
        "command": getPath(env, "tool_input.command"),
        "cwd": getPath(env, "tool_input.cwd") ?? getPath(env, "cwd"),
        "event_category": "agent_action"
      };
    case "WebFetch":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "url": getPath(env, "tool_input.url") ?? getPath(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "WebSearch":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "url": getPath(env, "tool_input.url") ?? getPath(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "Agent":
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "event_category": "agent_action"
      };
    default:
      return {
        "tool_name": getPath(env, "tool_name"),
        "tool_input": getPath(env, "tool_input"),
        "event_category": "mcp_tool_call"
      };
  }
}
function buildPermissionDeniedPayload(env) {
  return {
    "tool_name": getPath(env, "tool_name"),
    "tool_input": getPath(env, "tool_input"),
    "reason": getPath(env, "reason"),
    "event_category": "agent_action"
  };
}
function buildSetupPayload(env) {
  return {
    "trigger": getPath(env, "trigger"),
    "event_category": "workflow_start"
  };
}
function buildPreCompactPayload(env) {
  return {
    "trigger": getPath(env, "trigger"),
    "custom_instructions": getPath(env, "custom_instructions"),
    "event_category": "workflow_compact"
  };
}
function buildPostCompactPayload(env) {
  return {
    "compact_summary": getPath(env, "compact_summary"),
    "event_category": "workflow_compact"
  };
}
function buildSessionStartPayload(env) {
  return {
    "status": "started",
    "cwd": getPath(env, "cwd"),
    "event_category": "workflow_start"
  };
}
function buildSessionEndPayload(env) {
  return {
    "status": "completed",
    "event_category": "workflow_complete"
  };
}
function buildSubagentStartPayload(env) {
  return {
    "agent_id": getPath(env, "agent_id"),
    "agent_type": getPath(env, "agent_type"),
    "event_category": "agent_action"
  };
}
function buildSubagentStopPayload(env) {
  return {
    "agent_id": getPath(env, "agent_id"),
    "agent_type": getPath(env, "agent_type"),
    "status": "completed",
    "event_category": "agent_observation"
  };
}
function buildTaskCreatedPayload(env) {
  return {
    "task_id": getPath(env, "task_id"),
    "task_subject": getPath(env, "task_subject"),
    "task_description": getPath(env, "task_description"),
    "teammate_name": getPath(env, "teammate_name"),
    "team_name": getPath(env, "team_name"),
    "event_category": "agent_action"
  };
}
function buildTaskCompletedPayload(env) {
  return {
    "task_id": getPath(env, "task_id"),
    "task_subject": getPath(env, "task_subject"),
    "task_description": getPath(env, "task_description"),
    "teammate_name": getPath(env, "teammate_name"),
    "team_name": getPath(env, "team_name"),
    "event_category": "agent_observation"
  };
}
function buildStopPayload(env) {
  return {
    "cwd": getPath(env, "cwd"),
    "stop_hook_active": getPath(env, "stop_hook_active"),
    "last_assistant_message": getPath(env, "last_assistant_message"),
    "background_tasks": getPath(env, "background_tasks"),
    "session_crons": getPath(env, "session_crons"),
    "event_category": "workflow_stop_request"
  };
}
function buildStopFailurePayload(env) {
  return {
    "error": getPath(env, "error") ?? getPath(env, "reason"),
    "event_category": "workflow_failed"
  };
}
function buildTeammateIdlePayload(env) {
  return {
    "teammate_name": getPath(env, "teammate_name"),
    "team_name": getPath(env, "team_name"),
    "event_category": "agent_observation"
  };
}
function createClaudeCodeAdapter(config) {
  const readStdin = config.readStdin ?? defaultReadStdin;
  const write = config.writeStdout ?? ((data) => process.stdout.write(data));
  const exit = config.exit ?? ((code) => process.exit(code));
  function writeFallback(shape, _v, env) {
    const json = renderVerdictOutput(shape, void 0, env, config.deferApproval === true);
    if (json !== void 0) write(JSON.stringify(json));
  }
  function writeVerdict(shape, v, env) {
    const json = renderVerdictOutput(shape, v ?? void 0, env, config.deferApproval === true);
    if (json !== void 0) write(JSON.stringify(json));
  }
  return {
    async run() {
      const raw = (await readStdin()).trim();
      if (!raw) return exit(0);
      let env;
      try {
        env = JSON.parse(raw);
      } catch {
        return exit(0);
      }
      const eventName = env["hook_event_name"];
      if (typeof eventName !== "string" || !eventName) return exit(0);
      const { workflowId, runId } = await config.resolveSession(env);
      const session = govern.attach({
        core: config.core,
        preset: presets.claudeCode,
        workflowId,
        runId,
        approvalPollIntervalMs: 500,
        approvalMaxWaitMs: config.approvalMaxWaitMs,
        inlineApproval: config.inlineApproval,
        onPendingApproval: config.onPendingApproval ? (info) => config.onPendingApproval(info, env) : void 0,
        onApprovalResolved: config.onApprovalResolved ? (info) => config.onApprovalResolved(info, env) : void 0,
        awaitExternalDecision: config.awaitExternalDecision ? (info) => config.awaitExternalDecision(info, env) : void 0
      });
      const handlers = config.handlers;
      try {
        await dispatch(eventName, env, session, handlers, writeFallback, writeVerdict);
      } finally {
        return exit(0);
      }
    }
  };
}
async function dispatch(eventName, env, session, handlers, writeFallback, writeVerdict) {
  switch (eventName) {
    case "PreToolUse": {
      if (!handlers.preToolUse) {
        writeFallback("permission-decision", void 0, env);
        return;
      }
      const verdict = await handlers.preToolUse(env, session);
      writeVerdict("permission-decision", verdict, env);
      return;
    }
    case "PostToolUse": {
      if (!handlers.postToolUse) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUse(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "PostToolUseFailure": {
      if (!handlers.postToolUseFailure) {
        writeFallback("additional-context", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUseFailure(env, session);
      writeVerdict("additional-context", verdict, env);
      return;
    }
    case "PostToolBatch": {
      if (!handlers.postToolBatch) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.postToolBatch(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "UserPromptSubmit": {
      if (!handlers.userPromptSubmit) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.userPromptSubmit(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "UserPromptExpansion": {
      if (!handlers.userPromptExpansion) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.userPromptExpansion(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "PermissionRequest": {
      if (!handlers.permissionRequest) {
        writeFallback("permission-request", void 0, env);
        return;
      }
      const verdict = await handlers.permissionRequest(env, session);
      writeVerdict("permission-request", verdict, env);
      return;
    }
    case "PermissionDenied": {
      if (!handlers.permissionDenied) {
        writeFallback("permission-denied-retry", void 0, env);
        return;
      }
      const verdict = await handlers.permissionDenied(env, session);
      writeVerdict("permission-denied-retry", verdict, env);
      return;
    }
    case "Setup": {
      if (!handlers.setup) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.setup(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "InstructionsLoaded": {
      if (!handlers.instructionsLoaded) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.instructionsLoaded(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "PreCompact": {
      if (!handlers.preCompact) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.preCompact(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "PostCompact": {
      if (!handlers.postCompact) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.postCompact(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SessionStart": {
      if (!handlers.sessionStart) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionStart(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SessionEnd": {
      if (!handlers.sessionEnd) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionEnd(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SubagentStart": {
      if (!handlers.subagentStart) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStart(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SubagentStop": {
      if (!handlers.subagentStop) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStop(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "TaskCreated": {
      if (!handlers.taskCreated) {
        writeFallback("continue-block", void 0, env);
        return;
      }
      const verdict = await handlers.taskCreated(env, session);
      writeVerdict("continue-block", verdict, env);
      return;
    }
    case "TaskCompleted": {
      if (!handlers.taskCompleted) {
        writeFallback("continue-block", void 0, env);
        return;
      }
      const verdict = await handlers.taskCompleted(env, session);
      writeVerdict("continue-block", verdict, env);
      return;
    }
    case "Stop": {
      if (!handlers.stop) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.stop(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "StopFailure": {
      if (!handlers.stopFailure) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.stopFailure(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "TeammateIdle": {
      if (!handlers.teammateIdle) {
        writeFallback("continue-block", void 0, env);
        return;
      }
      const verdict = await handlers.teammateIdle(env, session);
      writeVerdict("continue-block", verdict, env);
      return;
    }
    case "Notification": {
      if (!handlers.notification) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.notification(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "MessageDisplay": {
      if (!handlers.messageDisplay) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.messageDisplay(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "ConfigChange": {
      if (!handlers.configChange) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.configChange(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "CwdChanged": {
      if (!handlers.cwdChanged) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.cwdChanged(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "FileChanged": {
      if (!handlers.fileChanged) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.fileChanged(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "WorktreeRemove": {
      if (!handlers.worktreeRemove) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.worktreeRemove(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "Elicitation": {
      if (!handlers.elicitation) {
        writeFallback("elicitation-response", void 0, env);
        return;
      }
      const verdict = await handlers.elicitation(env, session);
      writeVerdict("elicitation-response", verdict, env);
      return;
    }
    case "ElicitationResult": {
      if (!handlers.elicitationResult) {
        writeFallback("elicitation-response", void 0, env);
        return;
      }
      const verdict = await handlers.elicitationResult(env, session);
      writeVerdict("elicitation-response", verdict, env);
      return;
    }
    default:
      return;
  }
}
async function defaultReadStdin() {
  const MAX_BYTES2 = 10 * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk;
    total += buf.length;
    if (total > MAX_BYTES2) {
      throw new Error(
        `hook stdin exceeded ${MAX_BYTES2.toLocaleString()} bytes; refusing to buffer further (likely runaway pipe or hostile input)`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
function brand(raw) {
  const sanitized = raw.replace(/[\u2014\u2013]/g, " - ").replace(/ {2,}/g, " ").trim();
  if (!sanitized) return "";
  return sanitized.startsWith("[OpenBox]") ? sanitized : "[OpenBox] " + sanitized;
}
function redactedInput(v) {
  return v?.guardrailsResult?.redactedInput;
}
function objectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function addIfDefined(target, key, value) {
  if (value !== void 0) target[key] = value;
}
function renderVerdictOutput(shape, v, env, deferApproval = false) {
  const arm = v?.arm ?? "allow";
  const reason = brand(v?.reason ?? "");
  switch (shape) {
    case "permission-decision": {
      const eventName = env.hook_event_name ?? "PreToolUse";
      if (arm === "allow" || arm === "constrain") {
        const hookSpecificOutput = {
          hookEventName: eventName,
          permissionDecision: "allow"
        };
        if (arm === "constrain") {
          addIfDefined(hookSpecificOutput, "updatedInput", objectRecord(redactedInput(v)));
          if (reason) hookSpecificOutput.additionalContext = reason;
        }
        return {
          hookSpecificOutput
        };
      }
      if (arm === "require_approval") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            permissionDecision: deferApproval ? "defer" : "ask",
            permissionDecisionReason: reason || "[OpenBox] approval required"
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: reason || "[OpenBox] blocked by policy"
        }
      };
    }
    case "decision-block": {
      if (arm === "block" || arm === "halt") {
        return {
          decision: "block",
          reason: reason || "[OpenBox] blocked by policy"
        };
      }
      if (arm === "constrain" && reason) {
        const hookSpecificOutput = {
          hookEventName: env.hook_event_name ?? "ClaudeCode",
          additionalContext: reason
        };
        addIfDefined(hookSpecificOutput, "updatedToolOutput", redactedInput(v));
        return { hookSpecificOutput };
      }
      return {};
    }
    case "permission-request": {
      const eventName = env.hook_event_name ?? "PermissionRequest";
      if (arm === "allow" || arm === "constrain") {
        const decision = { behavior: "allow" };
        if (arm === "constrain") {
          addIfDefined(decision, "updatedInput", objectRecord(redactedInput(v)));
        }
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            decision
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          decision: {
            behavior: "deny",
            message: reason || "[OpenBox] blocked by policy"
          }
        }
      };
    }
    case "permission-denied-retry": {
      const eventName = env.hook_event_name ?? "PermissionDenied";
      if (arm === "allow" || arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            retry: true
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          retry: false
        }
      };
    }
    case "elicitation-response": {
      const eventName = env.hook_event_name ?? "Elicitation";
      if (arm === "allow") return {};
      if (arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            action: "accept",
            content: redactedInput(v) ?? env.response ?? env.content ?? {}
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          action: arm === "halt" ? "cancel" : "decline",
          content: {}
        }
      };
    }
    case "continue-block": {
      if (arm === "allow" || arm === "constrain") return {};
      return {
        continue: false,
        stopReason: reason || "[OpenBox] blocked by policy"
      };
    }
    case "additional-context": {
      if (arm === "allow") return {};
      return {
        hookSpecificOutput: {
          hookEventName: env.hook_event_name ?? "PostToolUseFailure",
          additionalContext: reason || "[OpenBox] blocked by policy"
        }
      };
    }
    case "cursor-permission": {
      if (arm === "allow" || arm === "constrain") return { permission: "allow" };
      if (arm === "require_approval") {
        const r = reason.replace(/^\[OpenBox\] /, "").trim();
        return {
          permission: "deny",
          user_message: "[OpenBox] approval pending" + (r ? ": " + r : "") + ". Click Approve in the OpenBox notification, then ask the agent to retry.",
          // Direct LLM instruction. (a) Force the brand into the
          // chat text the LLM will write so the user sees who
          // gated the action; Cursor's chat doesn't insert that
          // for us on most events (only subagentStart has the
          // hardcoded "Subagent creation blocked by hook:" prefix).
          // (b) Hard-stop the LLM's tendency to promise auto-retry,
          // which it can't deliver because Cursor's hook protocol
          // is one-shot.
          agent_message: "[OpenBox] blocked this action. Tell the user verbatim: 'OpenBox is gating this action. Approve it in the OpenBox notification, then ask me to retry.' Then STOP. Do NOT retry on your own. Do NOT speculate, describe, or invent what the blocked command WOULD have produced; you didn't run it, you don't know. Do NOT show 'expected output' or 'if you run it locally'. Just relay the gate message and wait for approval."
        };
      }
      if (arm === "halt") {
        return {
          permission: "deny",
          user_message: "[OpenBox] HALT: " + (reason.replace(/^\[OpenBox\] /, "") || "session halted"),
          agent_message: "[OpenBox] HALT: do not proceed"
        };
      }
      return {
        permission: "deny",
        user_message: reason || "[OpenBox] blocked by policy"
      };
    }
    case "cursor-continue": {
      if (arm === "allow" || arm === "constrain") return { continue: true };
      if (arm === "require_approval") {
        const r = reason.replace(/^\[OpenBox\] /, "").trim();
        return {
          continue: false,
          user_message: "[OpenBox] approval needed" + (r ? ": " + r : "") + ". Approve in the OpenBox notification, then resubmit your prompt (Cursor cannot resume a submitted prompt)."
        };
      }
      if (arm === "halt") {
        return {
          continue: false,
          user_message: "[OpenBox] HALT: " + (reason.replace(/^\[OpenBox\] /, "") || "session halted")
        };
      }
      return {
        continue: false,
        user_message: reason || "[OpenBox] blocked by policy"
      };
    }
    case "cursor-observe":
      return {};
    case "none":
      return void 0;
  }
}

// ts/src/core-client/core-client.ts
import { createHash, createPrivateKey, randomUUID as randomUUID2, sign } from "crypto";

// ts/src/env/generated/env-bindings.ts
var API_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;
function validateApiKeyFormat(value) {
  if (!API_KEY_PATTERN.test(value)) {
    return "OPENBOX_API_KEY must match obx_(live|test)_<48hex>";
  }
  return true;
}

// ts/src/env/agent-identity.ts
function resolveAgentIdentity(source = process.env) {
  const did = source.OPENBOX_AGENT_DID;
  const privateKey = source.OPENBOX_AGENT_PRIVATE_KEY;
  if (!did && !privateKey) return void 0;
  if (!did || !privateKey) {
    throw new Error(
      "OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY."
    );
  }
  return { did, privateKey };
}

// ts/src/client/rate-limiter.ts
var TokenBucket = class {
  tokens;
  lastRefill;
  capacity;
  refillRate;
  // tokens per ms
  constructor(requestsPerSecond, burst) {
    this.capacity = burst ?? requestsPerSecond;
    this.tokens = this.capacity;
    this.refillRate = requestsPerSecond / 1e3;
    this.lastRefill = Date.now();
  }
  async acquire() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = (1 - this.tokens) / this.refillRate;
    return new Promise((resolve2) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve2();
      }, waitMs);
    });
  }
  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
};

// ts/src/version.ts
var OPENBOX_SDK_VERSION = "0.1.0";

// ts/src/core-client/core-client.ts
var CoreApiError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "CoreApiError";
    this.status = status;
    this.body = body;
  }
};
var OpenBoxCoreClient = class _OpenBoxCoreClient {
  baseUrl;
  config;
  rateLimiter = null;
  constructor(config) {
    this.config = { ...config };
    this.baseUrl = requireCoreUrl(this.config.apiUrl ?? process.env.OPENBOX_CORE_URL);
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst
      );
    }
  }
  // =========================================================================
  // Public API
  // =========================================================================
  /**
   * Dynamic operation request used by compact API-first tooling.
   * Generated methods remain the preferred typed surface; this method
   * exists for operationId-driven callers that already resolved a
   * generated endpoint manifest entry.
   */
  async requestOperation(method, path10, options) {
    const renderedPath = appendQuery(path10, options?.params);
    return this.request(method, renderedPath, { data: options?.data });
  }
  async health() {
    return this.request("GET", "/");
  }
  async validateApiKey() {
    return this.request("GET", "/api/v1/auth/validate");
  }
  async evaluate(payload) {
    const versionedPayload = payload.sdk_version && payload.sdk_version !== "" ? payload : { ...payload, sdk_version: OPENBOX_SDK_VERSION };
    return this.request("POST", "/api/v1/governance/evaluate", {
      data: versionedPayload,
      retryable: false
    });
  }
  async pollApproval(request) {
    return this.request("POST", "/api/v1/governance/approval", {
      data: request
    });
  }
  // =========================================================================
  // Private helpers
  // =========================================================================
  static RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
  async request(method, path10, options) {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    const url = `${this.baseUrl}${path10}`;
    const timeoutMs = this.config.timeoutMs ?? 35e3;
    const baseHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-OpenBox-SDK-Version": OPENBOX_SDK_VERSION
    };
    const body = options?.data ? JSON.stringify(options.data) : void 0;
    const signedHeaders = this.config.agentIdentity ? signAgentIdentityRequest({
      identity: this.config.agentIdentity,
      method,
      path: new URL(url).pathname,
      body
    }) : {};
    const headers = { ...baseHeaders, ...signedHeaders };
    const retryable = options?.retryable ?? true;
    const response = retryable ? await this.executeWithRetry({ url, method, headers, body, timeoutMs }) : await this.executeOnce({ url, method, headers, body, timeoutMs });
    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");
    if (!response.ok) {
      const errBody = isJson ? await response.json() : await response.text();
      throw new CoreApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        errBody
      );
    }
    if (!isJson) {
      return response.text();
    }
    return response.json();
  }
  /** Single-attempt fetch with the same per-request abort/timeout shape
   *  as one iteration of executeWithRetry. Used by endpoints that opt
   *  out of retries (evaluate). Network errors / timeouts surface as
   *  exceptions for reportAndExit; HTTP 5xx come back as Response so
   *  the caller can wrap them as CoreApiError. */
  async executeOnce(req) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      return await fetch(req.url, {
        method: req.method,
        credentials: "omit",
        headers: req.headers,
        body: req.body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }
  async executeWithRetry(req) {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 3e4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      const fetchOptions = {
        method: req.method,
        // credentials: 'omit' prevents RN/iOS from auto-sending cookies that
        // leaked from a WKWebView via sharedCookiesEnabled. The backend's
        // CSRF guard fires when an XSRF-TOKEN cookie is present without a
        // matching X-XSRF-TOKEN header; Bearer-auth clients don't carry
        // that header and shouldn't send cookies in the first place.
        credentials: "omit",
        headers: req.headers,
        body: req.body,
        signal: controller.signal
      };
      try {
        const response = await fetch(req.url, fetchOptions);
        if (response.ok || !_OpenBoxCoreClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }
        if (attempt === maxRetries) return response;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } catch (err) {
        const isNetworkError = err instanceof TypeError;
        const isTimeout = err instanceof Error && err.name === "AbortError";
        if (attempt === maxRetries || !isNetworkError && !isTimeout) throw err;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Retry loop exited unexpectedly");
  }
  calculateBackoff(attempt, initialDelay, maxDelay) {
    const exponential = initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * initialDelay * 0.5;
    return Math.min(exponential + jitter, maxDelay);
  }
};
function requireCoreUrl(value) {
  if (!value) throw new Error("OPENBOX_CORE_URL is required. Set the core API URL explicitly.");
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function appendQuery(path10, params) {
  if (!params) return path10;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== void 0 && item !== null) search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  if (!query) return path10;
  return `${path10}${path10.includes("?") ? "&" : "?"}${query}`;
}
var ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function signAgentIdentityRequest(input) {
  const timestamp = input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const nonce = input.nonce ?? randomUUID2();
  const bodySha256 = createHash("sha256").update(input.body ?? "").digest("hex");
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    bodySha256
  ].join("\n");
  const privateKey = ed25519PrivateKeyFromRawBase64(input.identity.privateKey);
  const signature = sign(null, Buffer.from(canonical), privateKey).toString("base64");
  return {
    "X-OpenBox-Agent-DID": input.identity.did,
    "X-OpenBox-Agent-Timestamp": timestamp,
    "X-OpenBox-Agent-Nonce": nonce,
    "X-OpenBox-Body-SHA256": bodySha256,
    "X-OpenBox-Agent-Signature": signature
  };
}
function ed25519PrivateKeyFromRawBase64(rawBase64) {
  const raw = Buffer.from(rawBase64, "base64");
  if (raw.length !== 32) {
    throw new Error("agent identity privateKey must be a base64-encoded 32-byte Ed25519 key");
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8"
  });
}

// ts/src/runtime/claude-code/config.ts
import fs2 from "fs";
import path from "path";

// ts/src/config/host-config.ts
import * as fs from "fs";
function loadJsonConfig(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.toUpperCase().replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()] = String(v);
      out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}
function loadDotenv(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const out = {};
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

// ts/src/runtime/claude-code/config.ts
function resolveConfigDir(startDir = process.cwd()) {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, ".claude-hooks");
    if (fs2.existsSync(path.join(candidate, "config.json"))) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(startDir, ".claude-hooks");
}
var CONFIG_DIR = resolveConfigDir();
var CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
var ENV_FILE = path.join(CONFIG_DIR, ".env");
function loadConfig() {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const get = (key, fileFallback) => {
    if (process.env[key] !== void 0) return process.env[key];
    if (fileConfig[key] !== void 0) return fileConfig[key];
    if (envConfig[key] !== void 0) return envConfig[key];
    return fileFallback ?? "";
  };
  const skipToolsRaw = get("SKIP_TOOLS", "Glob,Grep");
  const skipTools = skipToolsRaw ? skipToolsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const skipActivityRaw = get("SKIP_ACTIVITY_TYPES");
  const skipActivityTypes = skipActivityRaw ? skipActivityRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const coreUrl = process.env.OPENBOX_CORE_URL ?? fileConfig.OPENBOX_CORE_URL ?? envConfig.OPENBOX_CORE_URL ?? "";
  return {
    openboxApiKey: get("OPENBOX_API_KEY"),
    openboxEndpoint: coreUrl,
    agentIdentity: resolveAgentIdentity({
      OPENBOX_AGENT_DID: get("OPENBOX_AGENT_DID") || void 0,
      OPENBOX_AGENT_PRIVATE_KEY: get("OPENBOX_AGENT_PRIVATE_KEY") || void 0
    }),
    governancePolicy: get("GOVERNANCE_POLICY", "fail_open"),
    governanceTimeout: parseInt(get("GOVERNANCE_TIMEOUT", "15"), 10) || 15,
    sessionDir: get("SESSION_DIR", path.join(CONFIG_DIR, "sessions")),
    logFile: get("LOG_FILE", path.join(CONFIG_DIR, "hook.log")) || null,
    verbose: get("VERBOSE") === "true" || get("VERBOSE") === "1",
    dryRun: get("DRY_RUN") === "true" || get("DRY_RUN") === "1",
    hitlEnabled: get("HITL_ENABLED", "true") !== "false",
    hitlPollInterval: parseInt(get("HITL_POLL_INTERVAL", "5"), 10) || 5,
    hitlMaxWait: parseInt(get("HITL_MAX_WAIT", "300"), 10) || 300,
    approvalMode: parseApprovalMode(get("APPROVAL_MODE", "remote")),
    taskQueue: get("TASK_QUEUE", "claude-code"),
    sendStartEvent: get("SEND_START_EVENT", "true") !== "false",
    sendActivityStartEvent: get("SEND_ACTIVITY_START_EVENT", "true") !== "false",
    maxBodySize: get("MAX_BODY_SIZE") ? parseInt(get("MAX_BODY_SIZE"), 10) || null : null,
    skipTools,
    skipActivityTypes
  };
}
var loadConfigFile = () => loadJsonConfig(CONFIG_FILE);
var loadEnvFile = () => loadDotenv(ENV_FILE);
function getConfigDir() {
  return CONFIG_DIR;
}
function parseApprovalMode(value) {
  const mode = value.toLowerCase();
  if (mode === "inline" || mode === "defer") return mode;
  return "remote";
}

// ts/src/logging/logger.ts
import fs3 from "fs";
import path2 from "path";
function createLogger(adapterName) {
  let logPath = null;
  function summarize(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.length > 200) {
        out[k] = v.slice(0, 200) + `... (${v.length} chars)`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return {
    initLogger(cfg) {
      logPath = cfg.logFile;
      if (logPath) fs3.mkdirSync(path2.dirname(logPath), { recursive: true });
    },
    log(hookEvent, data, response) {
      const entry = {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        hook: hookEvent,
        input: summarize(data),
        response: response ?? null
      };
      const line = JSON.stringify(entry);
      if (logPath) {
        try {
          fs3.appendFileSync(logPath, line + "\n");
        } catch {
        }
      }
      console.error(`[openbox ${adapterName}] ${hookEvent} | ${JSON.stringify(entry.input)}`);
      if (response) {
        console.error(`[openbox ${adapterName}] -> ${JSON.stringify(response)}`);
      }
    }
  };
}

// ts/src/session/resolver.ts
import { randomUUID as randomUUID3 } from "crypto";

// ts/src/session/store.ts
import fs4 from "fs";
import path3 from "path";
var SessionStore = class {
  dir;
  constructor(sessionDir) {
    this.dir = sessionDir;
    fs4.mkdirSync(this.dir, { recursive: true });
  }
  filePath(key) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path3.join(this.dir, `${safe}.json`);
  }
  save(key, session) {
    fs4.writeFileSync(this.filePath(key), JSON.stringify(session), { mode: 384, encoding: "utf-8" });
  }
  load(key) {
    const fp = this.filePath(key);
    if (!fs4.existsSync(fp)) return null;
    try {
      return JSON.parse(fs4.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }
  delete(key) {
    const fp = this.filePath(key);
    try {
      fs4.unlinkSync(fp);
    } catch {
    }
  }
  cleanup(maxAgeMs = 864e5) {
    try {
      const now = Date.now();
      for (const f of fs4.readdirSync(this.dir)) {
        const fp = path3.join(this.dir, f);
        const stat = fs4.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs4.unlinkSync(fp);
        }
      }
    } catch {
    }
  }
};

// ts/src/session/resolver.ts
var stores = /* @__PURE__ */ new WeakMap();
function getStore(cfg) {
  let s = stores.get(cfg);
  if (!s) {
    s = new SessionStore(cfg.sessionDir);
    stores.set(cfg, s);
  }
  return s;
}
function resolveSessionByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing && !existing.halted) {
    return { workflowId: existing.workflowId, runId: existing.runId };
  }
  const workflowId = randomUUID3();
  const runId = randomUUID3();
  store.save(key, { workflowId, runId });
  return { workflowId, runId };
}
function peekSessionByKey(key, cfg) {
  const existing = getStore(cfg).load(key);
  if (!existing) return null;
  return {
    workflowId: existing.workflowId,
    runId: existing.runId,
    halted: existing.halted ?? false
  };
}
function markHaltedByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing) store.save(key, { ...existing, halted: true });
}
function clearSessionByKey(key, cfg) {
  getStore(cfg).delete(key);
}

// ts/src/runtime/claude-code/session-resolver.ts
var resolveCreatedFreshSession = false;
async function resolveSession(env, cfg) {
  const prior = peekSessionByKey(env.session_id, cfg);
  resolveCreatedFreshSession = !prior || prior.halted;
  return resolveSessionByKey(env.session_id, cfg);
}
function lastResolveCreatedFreshSession() {
  return resolveCreatedFreshSession;
}
function markHalted(sessionId, cfg) {
  markHaltedByKey(sessionId, cfg);
}
function clearSession(sessionId, cfg) {
  clearSessionByKey(sessionId, cfg);
}

// ts/src/logging/hook-log.ts
import * as fs5 from "fs";
import * as path4 from "path";

// ts/src/env/os-paths.ts
import { join, resolve } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), ".openbox");
}

// ts/src/logging/hook-log.ts
function logDir() {
  return path4.join(openboxDataRoot(), "log");
}
var MAX_BYTES = 5 * 1024 * 1024;
function ensureDir(dir) {
  if (!fs5.existsSync(dir)) fs5.mkdirSync(dir, { recursive: true, mode: 448 });
}
function rotateIfNeeded(file) {
  try {
    const st = fs5.statSync(file);
    if (st.size < MAX_BYTES) return;
  } catch {
    return;
  }
  try {
    fs5.renameSync(file, `${file}.1`);
  } catch {
  }
}
function makeHookLog(host) {
  const initialDir = logDir();
  const initialFile = path4.join(initialDir, `${host}-hook.jsonl`);
  return {
    path: initialFile,
    record(line) {
      try {
        const dir = logDir();
        const file = path4.join(dir, `${host}-hook.jsonl`);
        ensureDir(dir);
        rotateIfNeeded(file);
        fs5.appendFileSync(file, JSON.stringify(line) + "\n", { mode: 384 });
      } catch {
      }
    }
  };
}

// ts/src/governance/events.ts
var EVENT = {
  START: "ActivityStarted",
  COMPLETE: "ActivityCompleted",
  SIGNAL: "SignalReceived"
};

// ts/src/runtime/claude-code/activity-types.ts
var ACTIVITY_TYPES = {
  PROMPT: "PromptSubmission",
  FILE_READ: "FileRead",
  FILE_EDIT: "FileEdit",
  FILE_DELETE: "FileDelete",
  SHELL: "ShellExecution",
  HTTP_REQUEST: "HTTPRequest",
  MCP_CALL: "MCPToolCall",
  AGENT_SPAWN: "AgentSpawn",
  AGENT_ACTION: "AgentAction",
  SESSION: "ClaudeCodeSession",
  CONFIG_CHANGE: "ClaudeCodeConfigChange",
  WORKSPACE_CHANGE: "ClaudeCodeWorkspaceChange",
  MCP_ELICITATION: "MCPElicitation",
  TASK: "ClaudeCodeTask",
  MESSAGE: "ClaudeCodeMessage"
};

// ts/src/governance/skip-patterns.ts
import path5 from "path";
var SKIP_PATTERNS = [
  /\.cursor\//,
  /\.claude\//,
  /\/mcps\//,
  /\/node_modules\//,
  /\.git\//,
  /INSTRUCTIONS\.md$/,
  /SERVER_METADATA\.json$/,
  /SKILL\.md$/
];
function isSkipped(filePath) {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

// ts/src/governance/spans.ts
function hex(len) {
  return Array.from(
    { length: len },
    () => Math.floor(Math.random() * 16).toString(16)
  ).join("");
}
function base() {
  return {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: "CLIENT",
    span_type: "function",
    stage: "started",
    start_time: Date.now() * 1e6,
    end_time: null,
    duration_ns: null,
    status: { code: "OK", description: null },
    events: [],
    error: null
  };
}
function objectRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function parseJsonRecord(value) {
  if (typeof value === "string") {
    try {
      return objectRecord2(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return objectRecord2(value);
}
function stringifyBody(value) {
  if (value === void 0) return void 0;
  return typeof value === "string" ? value : JSON.stringify(value);
}
function toPositiveInteger(value) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : void 0;
  if (numberValue === void 0 || !Number.isFinite(numberValue) || numberValue <= 0)
    return void 0;
  return Math.trunc(numberValue);
}
function normalizeUsage(usage) {
  if (!usage) return void 0;
  const promptTokens = toPositiveInteger(
    usage.promptTokens ?? usage.inputTokens
  );
  const completionTokens = toPositiveInteger(
    usage.completionTokens ?? usage.outputTokens
  );
  const totalTokens = toPositiveInteger(usage.totalTokens);
  const normalized = {};
  if (promptTokens !== void 0) {
    normalized.prompt_tokens = promptTokens;
    normalized.input_tokens = promptTokens;
  }
  if (completionTokens !== void 0) {
    normalized.completion_tokens = completionTokens;
    normalized.output_tokens = completionTokens;
  }
  if (totalTokens !== void 0) normalized.total_tokens = totalTokens;
  return Object.keys(normalized).length > 0 ? normalized : void 0;
}
function buildLLMCompletionResponseBody(content, metadata = {}) {
  const body = parseJsonRecord(metadata.responseBody);
  if (!Array.isArray(body.choices)) {
    body.choices = [
      {
        message: { content }
      }
    ];
  }
  if (metadata.model && typeof body.model !== "string") {
    body.model = metadata.model;
  }
  const usage = normalizeUsage(metadata.usage);
  if (usage && Object.keys(objectRecord2(body.usage)).length === 0) {
    body.usage = usage;
  }
  return JSON.stringify(body);
}
function buildLLMCompletionSpan(input) {
  const now = Date.now();
  const source = input.span ?? {};
  const usage = normalizeUsage(input.usage);
  const inputTokens = toPositiveInteger(
    usage?.input_tokens ?? usage?.prompt_tokens
  );
  const outputTokens = toPositiveInteger(
    usage?.output_tokens ?? usage?.completion_tokens
  );
  const httpUrl = input.providerUrl ?? source.http_url ?? (typeof source.attributes?.["http.url"] === "string" ? source.attributes["http.url"] : "https://api.openai.com/v1/chat/completions");
  return {
    ...source,
    span_id: source.span_id ?? hex(16),
    trace_id: source.trace_id ?? hex(32),
    name: input.name ?? source.name ?? "llm.chat.completion",
    kind: input.kind ?? source.kind ?? "CLIENT",
    start_time: input.startTime ?? source.start_time ?? now,
    end_time: input.endTime ?? source.end_time ?? now,
    duration_ns: input.durationNs ?? source.duration_ns ?? 0,
    span_type: "function",
    stage: "completed",
    semantic_type: "llm_completion",
    attributes: {
      "gen_ai.system": input.system ?? "openbox-sdk",
      ...input.model ? { "gen_ai.request.model": input.model } : {},
      ...input.model ? { "gen_ai.response.model": input.model } : {},
      ...inputTokens !== void 0 ? { "gen_ai.usage.input_tokens": inputTokens } : {},
      ...outputTokens !== void 0 ? { "gen_ai.usage.output_tokens": outputTokens } : {},
      "http.method": "POST",
      "http.url": httpUrl,
      "openbox.semantic_type": "llm_completion",
      "openbox.span_type": "function",
      ...source.attributes ?? {},
      ...input.attributes ?? {}
    },
    ...input.model ? { model: input.model } : {},
    ...inputTokens !== void 0 ? { input_tokens: inputTokens } : {},
    ...outputTokens !== void 0 ? { output_tokens: outputTokens } : {},
    http_method: source.http_method ?? "POST",
    http_url: httpUrl,
    request_body: stringifyBody(input.requestBody) ?? source.request_body ?? void 0,
    data: input.data ?? source.data,
    response_body: buildLLMCompletionResponseBody(input.content, {
      model: input.model,
      usage: input.usage,
      responseBody: input.responseBody ?? source.response_body
    })
  };
}
function buildSpan(host, type, input) {
  const b = base();
  switch (type) {
    case "llm":
      const usage = normalizeUsage(input.usage);
      const inputTokens = toPositiveInteger(
        usage?.input_tokens ?? usage?.prompt_tokens
      );
      const outputTokens = toPositiveInteger(
        usage?.output_tokens ?? usage?.completion_tokens
      );
      return {
        ...b,
        name: "llm.chat.completion",
        span_type: "function",
        hook_type: "function_call",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": host,
          ...input.model ? { "gen_ai.request.model": input.model } : {},
          ...input.model ? { "gen_ai.response.model": input.model } : {},
          ...inputTokens !== void 0 ? { "gen_ai.usage.input_tokens": inputTokens } : {},
          ...outputTokens !== void 0 ? { "gen_ai.usage.output_tokens": outputTokens } : {},
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_completion",
          "openbox.span_type": "function"
        },
        ...input.model ? { model: input.model } : {},
        ...inputTokens !== void 0 ? { input_tokens: inputTokens } : {},
        ...outputTokens !== void 0 ? { output_tokens: outputTokens } : {},
        function: "LLMCall",
        module: host,
        args: input,
        result: input.response ?? null
      };
    case "file_read":
      return {
        ...b,
        name: "file.read",
        kind: "INTERNAL",
        span_type: "file_io",
        hook_type: "file_operation",
        semantic_type: "file_read",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "read",
          "openbox.semantic_type": "file_read",
          "openbox.span_type": "file_io"
        },
        module: host,
        file_path: input.file_path ?? "",
        file_mode: "r",
        file_operation: "read"
      };
    case "file_write":
      return {
        ...b,
        name: "file.write",
        kind: "INTERNAL",
        span_type: "file_io",
        hook_type: "file_operation",
        semantic_type: "file_write",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "write",
          "openbox.semantic_type": "file_write",
          "openbox.span_type": "file_io"
        },
        module: host,
        file_path: input.file_path ?? "",
        file_mode: "w",
        file_operation: "write"
      };
    case "file_delete":
      return {
        ...b,
        name: "file.delete",
        kind: "INTERNAL",
        span_type: "file_io",
        hook_type: "file_operation",
        semantic_type: "file_delete",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "delete",
          "openbox.semantic_type": "file_delete",
          "openbox.span_type": "file_io"
        },
        module: host,
        file_path: input.file_path ?? "",
        file_operation: "delete"
      };
    case "shell":
      return {
        ...b,
        name: "ShellExecution",
        kind: "INTERNAL",
        span_type: "function",
        hook_type: "function_call",
        semantic_type: "internal",
        attributes: {
          "shell.command": input.command ?? "",
          "shell.cwd": input.cwd ?? "",
          "openbox.semantic_type": "internal",
          "openbox.span_type": "function"
        },
        function: "ShellExecution",
        module: host,
        args: input,
        result: null
      };
    case "mcp":
      return {
        ...b,
        name: `tool.${input.tool_name ?? "call"}`,
        span_type: "mcp_tool_call",
        hook_type: "function_call",
        semantic_type: "llm_tool_call",
        attributes: {
          "gen_ai.system": "mcp",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_tool_call",
          "openbox.span_type": "mcp_tool_call",
          "openbox.tool.name": input.tool_name ?? "call",
          "tool.name": input.tool_name ?? "call",
          tool_name: input.tool_name ?? "call"
        },
        function: `mcp.${input.tool_name ?? "call"}`,
        module: host,
        args: input,
        result: input.tool_output ?? null
      };
    case "http":
      const method = (input.method ?? "GET").toUpperCase();
      const url = input.url ?? "";
      return {
        ...b,
        name: `${method} ${url}`,
        span_type: "http",
        hook_type: "http_request",
        semantic_type: `http_${method.toLowerCase()}`,
        attributes: {
          "http.method": method,
          "http.url": url,
          "openbox.semantic_type": `http_${method.toLowerCase()}`,
          "openbox.span_type": "http"
        },
        http_method: method,
        http_url: url,
        request_body: null,
        response_body: null,
        request_headers: null,
        response_headers: null,
        http_status_code: null,
        function: "HTTPCall",
        module: host,
        args: input,
        result: null
      };
    case "db":
      const dbSystem = input.db_system ?? "postgresql";
      const dbOperation = (input.db_operation ?? "SELECT").toUpperCase();
      const dbStatement = input.db_statement ?? `${dbOperation} statement`;
      return {
        ...b,
        name: `${dbOperation} ${dbStatement.split(" ").slice(0, 3).join(" ")}`,
        span_type: "database",
        hook_type: "db_query",
        semantic_type: `database_${dbOperation.toLowerCase()}`,
        attributes: {
          "db.system": dbSystem,
          "db.operation": dbOperation,
          "db.statement": dbStatement,
          "openbox.semantic_type": `database_${dbOperation.toLowerCase()}`,
          "openbox.span_type": "database"
        },
        db_system: dbSystem,
        db_name: null,
        db_operation: dbOperation,
        db_statement: dbStatement,
        server_address: null,
        server_port: null,
        rowcount: null,
        function: "DatabaseQuery",
        module: host,
        args: input,
        result: null
      };
  }
}

// ts/src/approvals/source.ts
var SOURCE_INPUT_KEY = "_openbox_source";
function stampSource(payload, host) {
  return { ...payload, [SOURCE_INPUT_KEY]: host };
}

// ts/src/runtime/claude-code/side-effects.ts
import * as fs6 from "fs";
var TRUNCATE_LIMIT = 5e3;
var sideEffects = {
  /** Read the file at the given path; returns '' on missing/unreadable
   *  files and on paths the SKIP_PATTERNS list flags as IDE/secret
   *  internals so PII scanning can't false-HALT on metadata reads. */
  readFile(input) {
    if (typeof input !== "string" || !input) return "";
    if (isSkipped(input)) return "";
    try {
      return fs6.existsSync(input) ? fs6.readFileSync(input, "utf-8") : "";
    } catch {
      return "";
    }
  },
  /** JSON-stringify and clip to TRUNCATE_LIMIT chars; used for the
   *  PostToolUse `output` field where Claude can return arbitrarily
   *  large tool responses. */
  stringifyTruncate(input) {
    const s = typeof input === "string" ? input : JSON.stringify(input ?? {});
    return s.length > TRUNCATE_LIMIT ? s.slice(0, TRUNCATE_LIMIT) : s;
  }
};

// ts/src/runtime/claude-code/tool-activity-store.ts
import { createHash as createHash2 } from "crypto";
import path6 from "path";
var stores2 = /* @__PURE__ */ new WeakMap();
function storeFor(cfg) {
  let store = stores2.get(cfg);
  if (!store) {
    store = new SessionStore(path6.join(cfg.sessionDir, "tool-activities"));
    stores2.set(cfg, store);
  }
  return store;
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
function toolActivityKey(env) {
  if (env.tool_use_id) {
    return `${env.session_id}:${env.tool_use_id}`;
  }
  const digest = createHash2("sha256").update(env.session_id).update("\0").update(env.tool_name ?? "").update("\0").update(stableStringify(env.tool_input ?? null)).digest("hex").slice(0, 32);
  return `${env.session_id}:${digest}`;
}
function rememberToolActivity(env, cfg, activity) {
  storeFor(cfg).save(toolActivityKey(env), { ...activity });
}
function takeToolActivity(env, cfg) {
  const key = toolActivityKey(env);
  const store = storeFor(cfg);
  const record = store.load(key);
  store.delete(key);
  if (!record || typeof record.activityId !== "string" || typeof record.activityType !== "string" || typeof record.startTime !== "number") {
    return null;
  }
  return {
    activityId: record.activityId,
    activityType: record.activityType,
    startTime: record.startTime
  };
}

// ts/src/runtime/claude-code/mappers/pre-tool-use.ts
function activityTypeFor(toolName) {
  const direct = PRE_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp__")) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}
function spanTypeFor(toolName) {
  if (toolName === "Read" || toolName === "NotebookRead" || toolName === "Glob" || toolName === "Grep") return "file_read";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "file_write";
  if (toolName === "Delete") return "file_delete";
  if (toolName === "Bash" || toolName === "PowerShell") return "shell";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "http";
  if (toolName.startsWith("mcp__")) return "mcp";
  return null;
}
async function handlePreToolUse(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const toolInput = env.tool_input ?? {};
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeFor(toolName);
  if (!activityType) return void 0;
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const spanType = spanTypeFor(toolName);
  const spans = spanType ? [
    buildSpan("claude-code", spanType, {
      file_path: filePath || void 0,
      command: toolInput.command || void 0,
      cwd: toolInput.cwd || void 0,
      tool_name: toolName,
      tool_input: toolInput,
      url: toolInput.url || toolInput.query || void 0,
      method: "GET"
    })
  ] : void 0;
  const startTime = Date.now();
  const opened = await session.openActivity(activityType, {
    input: [stampSource(payload, "claude-code")],
    startTime,
    spans
  });
  const verdict = opened.verdict;
  if (verdict.arm === "allow" || verdict.arm === "constrain" || verdict.arm === "require_approval") {
    rememberToolActivity(env, cfg, {
      activityId: opened.activityId,
      activityType,
      startTime
    });
  }
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}

// ts/src/runtime/claude-code/mappers/post-tool-use.ts
function activityTypeFor2(toolName) {
  const direct = POST_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp__")) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}
function spanTypeFor2(toolName) {
  if (toolName === "Read" || toolName === "NotebookRead" || toolName === "Glob" || toolName === "Grep") return "file_read";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "file_write";
  if (toolName === "Delete") return "file_delete";
  if (toolName === "Bash" || toolName === "PowerShell") return "shell";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "http";
  if (toolName.startsWith("mcp__")) return "mcp";
  return null;
}
function durationMsFor(env) {
  const durationMs = env.duration_ms;
  return typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : void 0;
}
function outputFor(env, payload) {
  return env.tool_response ?? env.tool_output ?? payload.output;
}
async function handlePostToolUse(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const toolInput = env.tool_input ?? {};
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeFor2(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  const pending = takeToolActivity(env, cfg);
  const toolResponse = outputFor(env, {});
  const payload = buildPostToolUsePayload(env, sideEffects);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const spanType = spanTypeFor2(toolName);
  const spans = spanType ? [
    buildSpan("claude-code", spanType, {
      file_path: toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path,
      command: toolInput.command,
      cwd: toolInput.cwd,
      tool_name: toolName,
      tool_output: toolResponse,
      url: toolInput.url || toolInput.query || void 0,
      method: "GET"
    })
  ] : void 0;
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== void 0 ? pending.startTime + durationMs : void 0,
    durationMs,
    input: [stampSource(startedPayload, "claude-code")],
    output: outputFor(env, payload),
    spans
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePostToolUseFailure(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const toolInput = env.tool_input ?? {};
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeFor2(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  const pending = takeToolActivity(env, cfg);
  const payload = buildPostToolUseFailurePayload(env);
  const startedPayload = buildPreToolUsePayload(env, toolName, sideEffects);
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== void 0 ? pending.startTime + durationMs : void 0,
    durationMs,
    input: [stampSource(startedPayload, "claude-code")],
    output: stampSource(payload, "claude-code")
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePostToolBatch(env, session, cfg) {
  const payload = buildPostToolBatchPayload(env, sideEffects);
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_ACTION, {
    input: [stampSource(payload, "claude-code")],
    output: stampSource(payload, "claude-code")
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}

// ts/src/runtime/claude-code/mappers/user-prompt.ts
async function handleUserPromptSubmit(env, session, cfg) {
  const prompt = (env.prompt ?? "").trim();
  if (!prompt) return void 0;
  void session.activity(EVENT.SIGNAL, "user_prompt", {
    input: [stampSource({ prompt, event_category: "agent_goal" }, "claude-code")],
    signalName: "user_prompt",
    signalArgs: prompt,
    spans: [buildSpan("claude-code", "llm", { prompt })]
  }).catch(() => void 0);
  const payload = buildUserPromptSubmitPayload(env);
  const span = buildSpan("claude-code", "llm", { prompt });
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, "claude-code")],
    spans: [span]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleUserPromptExpansion(env, session, cfg) {
  const prompt = (env.expanded_prompt ?? env.prompt ?? "").trim();
  if (!prompt) return void 0;
  const payload = buildUserPromptExpansionPayload(env);
  const span = buildSpan("claude-code", "llm", { prompt });
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, "claude-code")],
    spans: [span]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}

// ts/src/runtime/claude-code/mappers/permission-request.ts
function activityTypeForTool(toolName) {
  const direct = PERMISSION_REQUEST_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp__")) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}
function spanTypeFor3(toolName) {
  if (toolName === "Read" || toolName === "NotebookRead" || toolName === "Glob" || toolName === "Grep") return "file_read";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "file_write";
  if (toolName === "Delete") return "file_delete";
  if (toolName === "Bash" || toolName === "PowerShell") return "shell";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "http";
  if (toolName.startsWith("mcp__")) return "mcp";
  return null;
}
async function handlePermissionRequest(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeForTool(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const toolInput = env.tool_input ?? {};
  const payload = buildPermissionRequestPayload(env, toolName);
  const spanType = spanTypeFor3(toolName);
  const spans = spanType ? [
    buildSpan("claude-code", spanType, {
      file_path: toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path,
      command: toolInput.command,
      cwd: toolInput.cwd,
      tool_name: toolName,
      tool_input: toolInput,
      url: toolInput.url || toolInput.query || void 0,
      method: "GET"
    })
  ] : void 0;
  const verdict = await session.activity(EVENT.START, activityType, {
    input: [stampSource(payload, "claude-code")],
    spans
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePermissionDenied(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const activityType = activityTypeForTool(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const payload = buildPermissionDeniedPayload(env);
  const verdict = await session.activity(EVENT.START, activityType, {
    input: [stampSource(payload, "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}

// ts/src/runtime/claude-code/transcript-usage.ts
import fs7 from "fs";
import path7 from "path";
var MAX_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
function toPositiveInteger2(value) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : void 0;
  if (numberValue === void 0 || !Number.isFinite(numberValue) || numberValue <= 0)
    return void 0;
  return Math.trunc(numberValue);
}
function normalizeClaudeUsage(value) {
  if (value === null || typeof value !== "object") return void 0;
  const usage = value;
  const normalized = {
    inputTokens: toPositiveInteger2(usage.input_tokens),
    outputTokens: toPositiveInteger2(usage.output_tokens),
    totalTokens: toPositiveInteger2(usage.total_tokens)
  };
  return Object.values(normalized).some((entry) => entry !== void 0) ? normalized : void 0;
}
function sumTokenField(left, right) {
  if (left === void 0) return right;
  if (right === void 0) return left;
  return left + right;
}
function withDerivedTotal(usage) {
  const input = usage.inputTokens ?? usage.promptTokens;
  const output = usage.outputTokens ?? usage.completionTokens;
  if (input === void 0 && output === void 0) return usage;
  const calculatedTotal = (input ?? 0) + (output ?? 0);
  if (usage.totalTokens !== void 0 && usage.totalTokens >= calculatedTotal) {
    return usage;
  }
  return {
    ...usage,
    totalTokens: calculatedTotal
  };
}
function combineUsage(left, right) {
  if (!left) return right;
  if (!right) return left;
  return {
    promptTokens: sumTokenField(left.promptTokens, right.promptTokens),
    completionTokens: sumTokenField(
      left.completionTokens,
      right.completionTokens
    ),
    inputTokens: sumTokenField(left.inputTokens, right.inputTokens),
    outputTokens: sumTokenField(left.outputTokens, right.outputTokens),
    totalTokens: sumTokenField(left.totalTokens, right.totalTokens)
  };
}
function transcriptRecordId(record, index) {
  const messageId = record.message?.id;
  if (typeof messageId === "string" && messageId.trim()) {
    return `message:${messageId}`;
  }
  const uuid = record.uuid;
  if (typeof uuid === "string" && uuid.trim()) return `uuid:${uuid}`;
  return `line:${index}`;
}
function textFromClaudeContent(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || void 0;
  }
  if (Array.isArray(value)) {
    const text = value.map((item) => {
      if (typeof item === "string") return item;
      if (item === null || typeof item !== "object") return "";
      const record = item;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    }).filter(Boolean).join("");
    const trimmed = text.trim();
    return trimmed || void 0;
  }
  if (value !== null && typeof value === "object") {
    const record = value;
    return textFromClaudeContent(record.text ?? record.content);
  }
  return void 0;
}
function isSafeTranscriptPath(filePath) {
  return path7.isAbsolute(filePath) && filePath.endsWith(".jsonl") && !filePath.includes("\0");
}
function readTranscriptTail(filePath) {
  if (!isSafeTranscriptPath(filePath)) return void 0;
  let fd;
  try {
    const stat = fs7.statSync(filePath);
    if (!stat.isFile()) return void 0;
    const length = Math.min(stat.size, MAX_TRANSCRIPT_TAIL_BYTES);
    const offset = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    fd = fs7.openSync(filePath, "r");
    fs7.readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf-8");
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) {
      try {
        fs7.closeSync(fd);
      } catch {
      }
    }
  }
}
function readLatestAssistantTurn(env) {
  const transcriptPath = env.agent_transcript_path ?? env.transcript_path;
  if (!transcriptPath) return void 0;
  const text = readTranscriptTail(transcriptPath);
  if (!text) return void 0;
  const lines = text.split("\n").filter(Boolean);
  const assistantRecords = /* @__PURE__ */ new Map();
  let latestModel;
  let latestContent;
  for (const [index, line] of lines.entries()) {
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) continue;
    try {
      const record = JSON.parse(line.slice(jsonStart));
      if (record.type !== "assistant" && record.message?.role !== "assistant") {
        continue;
      }
      const usage = normalizeClaudeUsage(record.message?.usage);
      const content = textFromClaudeContent(record.message?.content);
      if (!usage && !content) continue;
      const id = transcriptRecordId(record, index);
      const previous = assistantRecords.get(id);
      const model = record.message?.model ?? previous?.model;
      assistantRecords.set(id, {
        model,
        usage: usage ?? previous?.usage,
        content: content ?? previous?.content
      });
      if (record.message?.model) latestModel = record.message.model;
      if (content) latestContent = content;
    } catch {
      continue;
    }
  }
  let aggregatedUsage;
  for (const record of assistantRecords.values()) {
    aggregatedUsage = combineUsage(aggregatedUsage, record.usage);
  }
  aggregatedUsage = aggregatedUsage ? withDerivedTotal(aggregatedUsage) : void 0;
  if (!aggregatedUsage && !latestContent) return void 0;
  return {
    model: latestModel,
    usage: aggregatedUsage,
    content: latestContent
  };
}
function readLatestAssistantUsage(env) {
  const turn = readLatestAssistantTurn(env);
  return turn?.usage ? { model: turn.model, usage: turn.usage, content: turn.content } : void 0;
}

// ts/src/runtime/claude-code/mappers/assistant-output.ts
function firstText(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return void 0;
}
function buildClaudeAssistantOutputSpan(env, options) {
  const transcript = readLatestAssistantTurn(env);
  const content = options.preferTranscriptContent ? firstText(transcript?.content, options.fallbackText) : firstText(options.fallbackText, transcript?.content);
  if (!content && !transcript?.usage) return void 0;
  return [
    buildLLMCompletionSpan({
      content: content ?? "",
      span: { module: "claude-code" },
      name: "openbox.claude-code.assistant_output",
      kind: "llm",
      system: "claude-code",
      model: transcript?.model,
      usage: transcript?.usage,
      providerUrl: "https://api.anthropic.com/v1/messages",
      attributes: {
        "gen_ai.system": "claude-code",
        "openbox.claude_code.event": options.event
      },
      data: {
        source: "claude-code",
        event: options.event,
        session_id: env.session_id,
        hook_event_name: env.hook_event_name
      }
    })
  ];
}

// ts/src/runtime/claude-code/mappers/session.ts
function hasPendingClaudeWork(env) {
  return Array.isArray(env.background_tasks) && env.background_tasks.length > 0 || Array.isArray(env.session_crons) && env.session_crons.length > 0;
}
async function handleSessionStart(env, session, _cfg) {
  await session.workflowStarted();
  await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
    input: [stampSource(buildSessionStartPayload(env), "claude-code")]
  });
  return void 0;
}
async function handleStop(env, session, cfg) {
  let verdict;
  try {
    verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildStopPayload(env), "claude-code")],
      spans: buildClaudeAssistantOutputSpan(env, {
        event: "Stop",
        fallbackText: env.last_assistant_message
      })
    });
  } catch {
    if (cfg.governancePolicy === "fail_closed") {
      return {
        arm: "block",
        reason: "OpenBox Core was unavailable while governing Claude Code stop",
        riskScore: 1
      };
    }
    return void 0;
  }
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  if ((verdict.arm === "allow" || verdict.arm === "constrain") && !hasPendingClaudeWork(env)) {
    try {
      await session.workflowCompleted();
      clearSession(env.session_id, cfg);
    } catch {
      if (cfg.governancePolicy === "fail_closed") {
        return {
          arm: "block",
          reason: "OpenBox Core was unavailable while completing Claude Code workflow",
          riskScore: 1
        };
      }
    }
  }
  return verdict;
}
async function handleSetup(env, session, _cfg) {
  try {
    await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildSetupPayload(env), "claude-code")]
    });
  } catch {
  }
  return void 0;
}
async function handlePreCompact(env, session, cfg) {
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
    input: [stampSource(buildPreCompactPayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePostCompact(env, session, _cfg) {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildPostCompactPayload(env), "claude-code")]
    });
  } catch {
  }
  return void 0;
}
async function handleStopFailure(env, session, cfg) {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildStopFailurePayload(env), "claude-code")]
    });
  } catch {
  }
  try {
    await session.workflowFailed(
      new Error(String(env.error ?? env.reason ?? "Claude Code StopFailure"))
    );
    clearSession(env.session_id, cfg);
  } catch {
  }
  return void 0;
}
async function handleSessionEnd(env, session, cfg) {
  if (lastResolveCreatedFreshSession()) {
    clearSession(env.session_id, cfg);
    return void 0;
  }
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildSessionEndPayload(env), "claude-code")]
    });
  } catch {
  }
  try {
    await session.workflowCompleted();
  } catch {
  }
  clearSession(env.session_id, cfg);
  return void 0;
}

// ts/src/runtime/claude-code/mappers/subagent.ts
function subAgentActivityType(env) {
  return `SubAgent:${env.agent_type || env.agent_id || "unknown"}`;
}
async function handleSubagentStart(env, session, _cfg) {
  try {
    await session.activity(EVENT.START, subAgentActivityType(env), {
      input: [stampSource(buildSubagentStartPayload(env), "claude-code")]
    });
  } catch {
  }
  return void 0;
}
async function handleSubagentStop(env, session, cfg) {
  const verdict = await session.activity(EVENT.COMPLETE, subAgentActivityType(env), {
    input: [stampSource(buildSubagentStopPayload(env), "claude-code")],
    spans: buildClaudeAssistantOutputSpan(env, {
      event: "SubagentStop",
      fallbackText: env.last_assistant_message
    })
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleTaskCreated(env, session, cfg) {
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTaskCreatedPayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleTaskCompleted(env, session, cfg) {
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTaskCompletedPayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleTeammateIdle(env, session, cfg) {
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTeammateIdlePayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}

// ts/src/runtime/claude-code/mappers/generic.ts
var IMPORTANT_FIELDS = [
  "hook_event_name",
  "session_id",
  "cwd",
  "trigger",
  "source",
  "file_path",
  "event",
  "old_cwd",
  "new_cwd",
  "name",
  "command_name",
  "command_args",
  "expanded_prompt",
  "prompt",
  "message",
  "display_content",
  "displayContent",
  "tool_name",
  "tool_input",
  "tool_output",
  "tool_response",
  "tool_calls",
  "error",
  "reason",
  "action",
  "content",
  "mcp_server_name",
  "mode",
  "url",
  "elicitation_id",
  "requested_schema",
  "response",
  "task_id",
  "task_subject",
  "task_description",
  "teammate_name",
  "team_name",
  "last_assistant_message",
  "background_tasks",
  "session_crons",
  "custom_instructions",
  "compact_summary"
];
function compactPayload(env, eventCategory) {
  const source = env;
  const payload = {
    event_category: eventCategory
  };
  for (const field of IMPORTANT_FIELDS) {
    const value = source[field];
    if (value !== void 0) payload[field] = value;
  }
  return payload;
}
async function handleGenericClaudeEvent(env, session, cfg, options) {
  const verdict = await session.activity(options.eventKind ?? EVENT.START, options.activityType, {
    input: [stampSource(compactPayload(env, options.eventCategory), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return options.decisionCapable ? verdict : void 0;
}
async function observeGenericClaudeEvent(env, session, cfg, options) {
  try {
    await handleGenericClaudeEvent(env, session, cfg, {
      ...options,
      decisionCapable: false
    });
  } catch {
  }
  return void 0;
}
async function handleMessageDisplay(env, session, cfg, options) {
  const usage = env.final === true ? readLatestAssistantUsage(env) : void 0;
  const text = env.delta ?? env.display_content ?? env.displayContent ?? env.message ?? "";
  try {
    await session.activity(options.eventKind ?? EVENT.COMPLETE, options.activityType, {
      input: [stampSource(compactPayload(env, options.eventCategory), "claude-code")],
      output: stampSource({ text, event_category: options.eventCategory }, "claude-code"),
      spans: env.final === true ? buildClaudeAssistantOutputSpan(env, {
        event: "MessageDisplay",
        fallbackText: text,
        preferTranscriptContent: true
      }) : void 0
    });
  } catch {
  }
  if (usage && env.final === true) {
    try {
      await session.activity(EVENT.SIGNAL, "claude_usage", {
        input: [
          stampSource({
            event_category: "llm_usage",
            model: usage.model,
            usage: usage.usage
          }, "claude-code")
        ]
      });
    } catch {
    }
  }
  return void 0;
}

// ts/src/runtime/claude-code/governance-matrix.ts
var CLAUDE_CODE_GOVERNANCE_AUDIT = {
  capturedAt: "2026-06-17",
  installedClaudeCodeVersion: "2.1.179 (Claude Code)",
  officialDocs: [
    "https://code.claude.com/docs/en/hooks",
    "https://code.claude.com/docs/en/plugins-reference",
    "https://code.claude.com/docs/en/plugins",
    "https://code.claude.com/docs/en/mcp",
    "https://code.claude.com/docs/en/skills",
    "https://code.claude.com/docs/en/commands",
    "https://code.claude.com/docs/en/agents",
    "https://code.claude.com/docs/en/settings",
    "https://code.claude.com/docs/en/tools-reference",
    "https://code.claude.com/docs/en/channels",
    "https://code.claude.com/docs/en/changelog"
  ],
  auditedSdkSurfaces: [
    "@openbox-ai/openbox-sdk/runtime/claude-code",
    "@openbox-ai/openbox-sdk/runtime/mcp",
    "@openbox-ai/openbox-sdk/runtime/cursor",
    "@openbox-ai/openbox-sdk/copilotkit",
    "@openbox-ai/openbox-sdk/copilotkit/react",
    "apps/extension",
    "skill",
    "example/n8n"
  ]
};
var CLAUDE_CODE_HOOK_MATRIX = [
  { event: "Setup", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "CI/init preparation signal." },
  { event: "SessionStart", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Starts OpenBox workflow/session lifecycle." },
  { event: "InstructionsLoaded", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Audits loaded instruction sources." },
  { event: "UserPromptSubmit", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Prompt input gate." },
  { event: "UserPromptExpansion", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Slash-command expansion gate." },
  { event: "MessageDisplay", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Display-only streaming text surface." },
  { event: "PreToolUse", status: "implement_now", defaultInstall: true, decisionSurface: "permission-decision", notes: "Primary pre-action tool gate." },
  { event: "PermissionRequest", status: "implement_now", defaultInstall: true, decisionSurface: "permission-request", notes: "Native Claude permission prompt gate." },
  { event: "PermissionDenied", status: "implement_now", defaultInstall: true, decisionSurface: "permission-denied-retry", notes: "Can request retry after auto-mode denial." },
  { event: "PostToolUse", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Tool output governance, including non-error feedback and redacted output on constrain." },
  { event: "PostToolUseFailure", status: "implement_now", defaultInstall: true, decisionSurface: "additional-context", notes: "Feeds policy context after failed tool calls, including constrain feedback." },
  { event: "PostToolBatch", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Parallel tool batch gate before next model call, including additional context on constrain." },
  { event: "SubagentStart", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Subagent lifecycle start telemetry." },
  { event: "SubagentStop", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Subagent completion gate, including non-error feedback on constrain." },
  { event: "TaskCreated", status: "implement_now", defaultInstall: true, decisionSurface: "continue-block", notes: "Agent-team task creation criteria." },
  { event: "TaskCompleted", status: "implement_now", defaultInstall: true, decisionSurface: "continue-block", notes: "Agent-team task completion criteria." },
  { event: "Stop", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Final assistant-output/session-stop gate, including non-error feedback on constrain." },
  { event: "StopFailure", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "API/session failure telemetry." },
  { event: "TeammateIdle", status: "implement_now", defaultInstall: true, decisionSurface: "continue-block", notes: "Agent-team idle/completion enforcement." },
  { event: "Notification", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Notification telemetry." },
  { event: "ConfigChange", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Blocks non-managed config changes from applying." },
  { event: "CwdChanged", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Working-directory telemetry." },
  { event: "FileChanged", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Watched-file telemetry; cannot block the file change." },
  { event: "WorktreeCreate", status: "explicit_out_of_scope", defaultInstall: false, decisionSurface: "worktree-path", notes: "Invasive hook replaces Claude Code git worktree creation and must create/return a real path." },
  { event: "WorktreeRemove", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Worktree removal telemetry." },
  { event: "PreCompact", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Blocks unsafe compaction requests before context rewrite." },
  { event: "PostCompact", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Compaction summary telemetry." },
  { event: "SessionEnd", status: "diagnose_only", defaultInstall: false, decisionSurface: "none", notes: "Supported by the handler but not default-installed because shutdown hooks can be cancelled before network telemetry reliably completes; Stop is the governed final hook." },
  { event: "Elicitation", status: "implement_now", defaultInstall: true, decisionSurface: "elicitation-response", notes: "MCP user-input request governance." },
  { event: "ElicitationResult", status: "implement_now", defaultInstall: true, decisionSurface: "elicitation-response", notes: "MCP elicitation response governance." }
];
var CLAUDE_CODE_SURFACE_MATRIX = [
  { surface: "hooks", status: "implement_now", notes: "Generated from TypeSpec and installed by the Claude Code plugin." },
  { surface: "skills", status: "implement_now", notes: "OpenBox skill ships under plugin skills/openbox." },
  { surface: "commands", status: "implement_now", notes: "Compatibility command markdown files remain for Claude slash entrypoints." },
  { surface: "agents", status: "implement_now", notes: "OpenBox reviewer agent ships in the plugin." },
  { surface: "MCP", status: "implement_now", notes: "OpenBox MCP server exposes status, doctor, approvals, agents, rules, policies, and governance checks." },
  { surface: "plugin settings", status: "diagnose_only", notes: "Only agent/subagentStatusLine are currently supported by Claude Code plugin settings." },
  { surface: "monitors", status: "diagnose_only", notes: "Documented as opt-in because monitors run unsandboxed and project-scope plugins do not load them." },
  { surface: "LSP", status: "explicit_out_of_scope", notes: "No OpenBox language server exists; official LSP plugins should be installed separately." },
  { surface: "bin", status: "implement_now", notes: "Plugin ships a project-local Node runner for hooks, MCP, and diagnostics; no global OpenBox binary is required." },
  { surface: "managed settings", status: "diagnose_only", notes: "Enterprise policy belongs to managed Claude Code deployment, not SDK mutation." },
  { surface: "channels", status: "diagnose_only", notes: "Research preview MCP push channel surface; standard MCP remains the connector path." },
  { surface: "built-in tool permissions", status: "implement_now", notes: "PreToolUse/PermissionRequest routing covers current built-in tool names and dynamic mcp__ tools." }
];
var CLAUDE_CODE_SDK_CAPABILITY_MATRIX = [
  {
    capability: "workflow lifecycle start",
    sdkSurface: "BaseGovernedSession.workflowStarted() / WorkflowStarted",
    claudeCodeTreatment: "implement_now",
    coverage: "SessionStart opens the workflow and records the Claude session boundary.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/hook-integration/claude-code-hook-events.test.ts"]
  },
  {
    capability: "workflow lifecycle complete",
    sdkSurface: "BaseGovernedSession.workflowCompleted() / WorkflowCompleted",
    claudeCodeTreatment: "implement_now",
    coverage: "Stop completes workflows with no background tasks; SessionEnd remains opt-in shutdown telemetry.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/hook-integration/claude-code-hook-stdin.test.ts"]
  },
  {
    capability: "workflow lifecycle failure",
    sdkSurface: "BaseGovernedSession.workflowFailed() / WorkflowFailed",
    claudeCodeTreatment: "implement_now",
    coverage: "StopFailure emits observe telemetry and then records WorkflowFailed best-effort.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/hook-integration/claude-code-hook-stdin.test.ts"]
  },
  {
    capability: "split-stage activity governance",
    sdkSurface: "BaseGovernedSession.openActivity().complete()",
    claudeCodeTreatment: "implement_now",
    coverage: "PreToolUse opens a stable activity and PostToolUse/PostToolUseFailure closes it with output/duration.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/unit/payload-shape.test.ts"]
  },
  {
    capability: "single-stage activity gates",
    sdkSurface: "BaseGovernedSession.activity(ActivityStarted|ActivityCompleted)",
    claudeCodeTreatment: "implement_now",
    coverage: "Prompts, permission requests, compaction, config changes, tasks, final output, subagents, and MCP elicitation map to activity gates.",
    tests: ["tests/unit/claude-hook-handler-coverage.test.ts", "tests/hook-integration/claude-code-hook-stdin.test.ts"]
  },
  {
    capability: "goal and signal telemetry",
    sdkSurface: "BaseGovernedSession.activity(SignalReceived)",
    claudeCodeTreatment: "implement_now",
    coverage: "UserPromptSubmit emits SignalReceived(user_prompt) with the prompt and an LLM span before the prompt gate.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/unit/payload-shape.test.ts"]
  },
  {
    capability: "approval lifecycle",
    sdkSurface: "WorkflowVerdict.arm=require_approval, pollApproval, inline/defer approval modes",
    claudeCodeTreatment: "implement_now",
    coverage: "Claude hook rendering supports remote polling, inline ask, defer, and fail-closed deny/block shapes for decision-capable hooks.",
    tests: ["tests/hook-integration/claude-code-hook-stdin.test.ts", "tests/unit/runtime-adapters-coverage.test.ts"]
  },
  {
    capability: "guardrail transforms and constrain verdicts",
    sdkSurface: "WorkflowVerdict.arm=constrain, guardrailsResult.redactedInput, updated output rendering",
    claudeCodeTreatment: "implement_now",
    coverage: "Claude verdict renderer preserves allow+updatedInput, additionalContext, updatedToolOutput, and elicitation accept content where Claude supports mutation.",
    tests: ["tests/unit/runtime-adapters-coverage.test.ts", "tests/unit/payload-shape.test.ts"]
  },
  {
    capability: "halt/block session state",
    sdkSurface: "WorkflowVerdict.arm=block|halt, session halted cache",
    claudeCodeTreatment: "implement_now",
    coverage: "Decision-capable hooks return Claude-native block/deny/continue=false responses and mark halted sessions for later hooks.",
    tests: ["tests/hook-integration/claude-code-hook-stdin.test.ts", "tests/unit/runtime-claude-code-mappers.test.ts"]
  },
  {
    capability: "behavior-rule spans and hook-trigger evaluation",
    sdkSurface: "GovernedPayload.spans, hook_trigger re-evaluation",
    claudeCodeTreatment: "implement_now",
    coverage: "Prompt, shell, file, HTTP, and MCP tool paths attach spans so behavior rules can match the same shapes used by other SDK adapters.",
    tests: ["tests/hook-integration/claude-code-span-content.test.ts", "tests/unit/runtime-claude-code-mappers.test.ts"]
  },
  {
    capability: "MCP connector and governance tools",
    sdkSurface: "@openbox-ai/openbox-sdk/runtime/mcp",
    claudeCodeTreatment: "implement_now",
    coverage: "Plugin .mcp.json points at the bundled project-local Node runner for mcp serve; MCP exposes status, doctor, approvals, agent/rule/policy reads, and check_governance.",
    tests: ["tests/unit/mcp-server-coverage.test.ts", "tests/hook-integration/mcp-protocol.test.ts"]
  },
  {
    capability: "plugin packaging and diagnostics",
    sdkSurface: "@openbox-ai/openbox-sdk/runtime/claude-code plugin helpers",
    claudeCodeTreatment: "implement_now",
    coverage: "Export/install packages skill, commands, agent, hooks, MCP, diagnostics, project-local bin runner/doctor shim, and explicit settings/monitor/LSP inventory.",
    tests: ["tests/unit/claude-code-plugin.test.ts", "tests/hook-integration/claude-code-install.test.ts"]
  },
  {
    capability: "project-scoped runtime configuration",
    sdkSurface: "Claude .claude-hooks config loader and plugin install",
    claudeCodeTreatment: "implement_now",
    coverage: "Claude hooks read only project .claude-hooks config/env plus process env; no global Claude config is mutated.",
    tests: ["tests/hook-integration/claude-code-install.test.ts", "tests/unit/logging-and-config-coverage.test.ts"]
  },
  {
    capability: "CopilotKit-specific UI/runtime wrappers",
    sdkSurface: "@openbox-ai/openbox-sdk/copilotkit and /copilotkit/react",
    claudeCodeTreatment: "explicit_out_of_scope",
    coverage: "Claude Code does not embed CopilotKit UI wrappers; it maps the same governance primitives through hooks and MCP instead.",
    tests: ["tests/unit/copilotkit-pure-coverage.test.ts", "tests/unit/runtime-claude-code-mappers.test.ts"]
  },
  {
    capability: "non-Claude presets",
    sdkSurface: "PRESET_MANIFEST presets for LangChain, Cursor, n8n, Temporal, etc.",
    claudeCodeTreatment: "diagnose_only",
    coverage: "SDK-wide presets are audited as broader SDK capability, but Claude Code only implements host-reachable Claude events.",
    tests: ["tests/unit/claude-code-governance-matrix.test.ts"]
  }
];
function defaultClaudeCodeHookEvents() {
  return CLAUDE_CODE_HOOK_MATRIX.filter((entry) => entry.defaultInstall && entry.status !== "diagnose_only" && entry.status !== "explicit_out_of_scope").map((entry) => entry.event);
}
function optInClaudeCodeHookEvents() {
  return CLAUDE_CODE_HOOK_MATRIX.filter((entry) => !entry.defaultInstall).map((entry) => entry.event);
}
function claudeCodeGovernanceSummary() {
  const byStatus = CLAUDE_CODE_HOOK_MATRIX.reduce(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    { implement_now: 0, observe_only: 0, diagnose_only: 0, explicit_out_of_scope: 0 }
  );
  return {
    audit: CLAUDE_CODE_GOVERNANCE_AUDIT,
    hookCount: CLAUDE_CODE_HOOK_MATRIX.length,
    defaultHookCount: defaultClaudeCodeHookEvents().length,
    optInHooks: optInClaudeCodeHookEvents(),
    byStatus,
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
    sdkCapabilities: CLAUDE_CODE_SDK_CAPABILITY_MATRIX
  };
}

// ts/src/runtime/claude-code/hook-handler.ts
var hookLog = makeHookLog("claude-code");
var MAX_STDIN_BYTES = 10 * 1024 * 1024;
function logged(event, verdictKind, fn) {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      hookLog.record({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start
      });
      return out;
    } catch (err) {
      hookLog.record({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
        error: String(err?.message ?? err)
      });
      throw err;
    }
  };
}
function failClosedVerdict(reason) {
  return {
    arm: "block",
    reason,
    riskScore: 1
  };
}
function decisionSurface(eventName) {
  return CLAUDE_CODE_HOOK_MATRIX.find((entry) => entry.event === eventName)?.decisionSurface ?? "none";
}
function isDecisionCapable(eventName) {
  const surface = decisionSurface(eventName);
  return surface !== "none" && surface !== "worktree-path";
}
function reasonFromError(prefix, err) {
  const detail = err instanceof Error ? err.message : String(err ?? "");
  return detail ? `${prefix}: ${detail}` : prefix;
}
function guarded(cfg, event, verdictKind, fn) {
  return logged(event, verdictKind, async (env, session) => {
    try {
      return await fn(env, session);
    } catch (err) {
      const decisionCapable = isDecisionCapable(env.hook_event_name);
      const reason = reasonFromError("OpenBox governance failed while processing Claude Code hook", err);
      if (cfg.verbose) console.error(`[openbox claude-code] ${reason}`);
      if (decisionCapable && cfg.governancePolicy === "fail_closed") {
        return failClosedVerdict(reason);
      }
      return void 0;
    }
  });
}
function renderFailClosedHookOutput(env, reason) {
  const eventName = env.hook_event_name ?? "ClaudeCode";
  switch (decisionSurface(eventName)) {
    case "permission-decision":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: `[OpenBox] ${reason}`
        }
      };
    case "permission-request":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          decision: {
            behavior: "deny",
            message: `[OpenBox] ${reason}`
          }
        }
      };
    case "permission-denied-retry":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          retry: false
        }
      };
    case "elicitation-response":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          action: "decline",
          content: {}
        }
      };
    case "continue-block":
      return {
        continue: false,
        stopReason: `[OpenBox] ${reason}`
      };
    case "additional-context":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: `[OpenBox] ${reason}`
        }
      };
    case "decision-block":
      return {
        decision: "block",
        reason: `[OpenBox] ${reason}`
      };
    default:
      return void 0;
  }
}
function writeFailClosedIfPossible(env, reason) {
  if (!env || !isDecisionCapable(env.hook_event_name)) return;
  const output = renderFailClosedHookOutput(env, reason);
  if (output !== void 0) process.stdout.write(JSON.stringify(output));
}
function parseEnvelope(raw) {
  const text = raw.trim();
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function readHookStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk;
    total += buf.length;
    if (total > MAX_STDIN_BYTES) {
      throw new Error(
        `hook stdin exceeded ${MAX_STDIN_BYTES.toLocaleString()} bytes; refusing to buffer further`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
async function runClaudeHook() {
  const cfg = loadConfig();
  if (!process.env.OPENBOX_HOME) {
    process.env.OPENBOX_HOME = getConfigDir();
  }
  createLogger("claude-code").initLogger(cfg);
  let raw = "";
  let env;
  try {
    raw = await readHookStdin();
    env = parseEnvelope(raw);
  } catch (err) {
    if (cfg.verbose) console.error(`[openbox claude-code] ${reasonFromError("failed to read hook stdin", err)}`);
    process.exit(0);
  }
  if (!cfg.openboxApiKey) {
    if (cfg.governancePolicy === "fail_closed") {
      writeFailClosedIfPossible(env, "missing OPENBOX_API_KEY");
    }
    if (cfg.verbose) console.error("[openbox claude-code] no OPENBOX_API_KEY set, passing through");
    process.exit(0);
  }
  if (!cfg.openboxEndpoint) {
    if (cfg.governancePolicy === "fail_closed") {
      writeFailClosedIfPossible(env, "missing OPENBOX_CORE_URL");
    }
    if (cfg.verbose) console.error("[openbox claude-code] no OPENBOX_CORE_URL set, passing through");
    process.exit(0);
  }
  const dryRun = cfg.dryRun;
  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    agentIdentity: cfg.agentIdentity,
    timeoutMs: cfg.governanceTimeout * 1e3
  });
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1e3,
    36e5
  );
  const handlers = {
    setup: guarded(
      cfg,
      "setup",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleSetup(env2, s, cfg)
    ),
    sessionStart: guarded(
      cfg,
      "sessionStart",
      "none",
      async (env2, s) => dryRun ? void 0 : handleSessionStart(env2, s, cfg)
    ),
    instructionsLoaded: guarded(
      cfg,
      "instructionsLoaded",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.START,
        eventCategory: "agent_observation"
      })
    ),
    userPromptSubmit: guarded(
      cfg,
      "userPromptSubmit",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleUserPromptSubmit(env2, s, cfg)
    ),
    userPromptExpansion: guarded(
      cfg,
      "userPromptExpansion",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleUserPromptExpansion(env2, s, cfg)
    ),
    messageDisplay: guarded(
      cfg,
      "messageDisplay",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleMessageDisplay(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.COMPLETE,
        eventCategory: "llm_output"
      })
    ),
    preToolUse: guarded(
      cfg,
      "preToolUse",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePreToolUse(env2, s, cfg)
    ),
    permissionRequest: guarded(
      cfg,
      "permissionRequest",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePermissionRequest(env2, s, cfg)
    ),
    permissionDenied: guarded(
      cfg,
      "permissionDenied",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePermissionDenied(env2, s, cfg)
    ),
    postToolUse: guarded(
      cfg,
      "postToolUse",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePostToolUse(env2, s, cfg)
    ),
    postToolUseFailure: guarded(
      cfg,
      "postToolUseFailure",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePostToolUseFailure(env2, s, cfg)
    ),
    postToolBatch: guarded(
      cfg,
      "postToolBatch",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePostToolBatch(env2, s, cfg)
    ),
    subagentStart: guarded(
      cfg,
      "subagentStart",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleSubagentStart(env2, s, cfg)
    ),
    subagentStop: guarded(
      cfg,
      "subagentStop",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleSubagentStop(env2, s, cfg)
    ),
    taskCreated: guarded(
      cfg,
      "taskCreated",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleTaskCreated(env2, s, cfg)
    ),
    taskCompleted: guarded(
      cfg,
      "taskCompleted",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleTaskCompleted(env2, s, cfg)
    ),
    stop: guarded(
      cfg,
      "stop",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleStop(env2, s, cfg)
    ),
    stopFailure: guarded(
      cfg,
      "stopFailure",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleStopFailure(env2, s, cfg)
    ),
    teammateIdle: guarded(
      cfg,
      "teammateIdle",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleTeammateIdle(env2, s, cfg)
    ),
    notification: guarded(
      cfg,
      "notification",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: "agent_notification"
      })
    ),
    configChange: guarded(
      cfg,
      "configChange",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.CONFIG_CHANGE,
        eventKind: EVENT.START,
        eventCategory: "config_change",
        decisionCapable: true
      })
    ),
    cwdChanged: guarded(
      cfg,
      "cwdChanged",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: "cwd_changed"
      })
    ),
    fileChanged: guarded(
      cfg,
      "fileChanged",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: "file_changed"
      })
    ),
    worktreeRemove: guarded(
      cfg,
      "worktreeRemove",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.COMPLETE,
        eventCategory: "worktree_remove"
      })
    ),
    preCompact: guarded(
      cfg,
      "preCompact",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePreCompact(env2, s, cfg)
    ),
    postCompact: guarded(
      cfg,
      "postCompact",
      "observe",
      async (env2, s) => dryRun ? void 0 : handlePostCompact(env2, s, cfg)
    ),
    sessionEnd: guarded(
      cfg,
      "sessionEnd",
      "none",
      async (env2, s) => dryRun ? void 0 : handleSessionEnd(env2, s, cfg)
    ),
    elicitation: guarded(
      cfg,
      "elicitation",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MCP_ELICITATION,
        eventKind: EVENT.START,
        eventCategory: "mcp_elicitation",
        decisionCapable: true
      })
    ),
    elicitationResult: guarded(
      cfg,
      "elicitationResult",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MCP_ELICITATION,
        eventKind: EVENT.COMPLETE,
        eventCategory: "mcp_elicitation_result",
        decisionCapable: true
      })
    )
  };
  await createClaudeCodeAdapter({
    core,
    resolveSession: (env2) => resolveSession(env2, cfg),
    approvalMaxWaitMs,
    readStdin: async () => raw,
    // When APPROVAL_MODE=inline, the SDK skips its internal poll loop
    // and the adapter renders permissionDecision:'ask' so Claude
    // Code's native permission dialog pops in the TUI on every
    // require_approval. External approval clients such as the
    // dashboard, mobile app, or editor extension can still resolve
    // the backend row, but the hook does not wait for them.
    inlineApproval: cfg.approvalMode === "inline" || cfg.approvalMode === "defer",
    deferApproval: cfg.approvalMode === "defer",
    handlers
  }).run();
}

// ts/src/runtime/claude-code/plugin.ts
import {
  chmodSync,
  cpSync,
  existsSync as existsSync4,
  lstatSync,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync3,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "fs";
import os from "os";
import path8 from "path";
import { fileURLToPath } from "url";
var __dirname = path8.dirname(fileURLToPath(import.meta.url));
var EXPECTED_COMMAND_FILES = [
  "openbox-check.md",
  "openbox-doctor.md",
  "openbox-list-agents.md",
  "openbox-pending.md",
  "openbox-status.md"
];
var EXPECTED_AGENT_FILES = ["openbox-reviewer.md"];
var EXPECTED_DIAGNOSTIC_FILES = [
  "component-inventory.json",
  "claude-code-governance.json",
  "monitors.opt-in.json"
];
var EXPECTED_BIN_FILES = ["openbox-cli.mjs", "openbox-plugin-doctor"];
var EXPECTED_COMPONENT_NAMES = [
  "skill",
  "commands",
  "agent",
  "hooks",
  "mcp",
  "diagnostics",
  "bin",
  "settings",
  "monitors",
  "lsp"
];
var PLUGIN_CLI_RUNNER = "bin/openbox-cli.mjs";
var PLUGIN_HOOK_HANDLER = {
  type: "command",
  command: "node",
  args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, "claude-code", "hook"]
};
var PLUGIN_MCP_SERVER = {
  command: "node",
  args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, "mcp", "serve"]
};
function claudeCodePluginTargetDir(cwd = process.cwd()) {
  return path8.join(cwd, ".claude", "skills", "openbox");
}
function readJson(file) {
  try {
    return JSON.parse(readFileSync3(file, "utf-8"));
  } catch {
    return void 0;
  }
}
function packageVersion() {
  const candidates = [
    path8.resolve(__dirname, "../../package.json"),
    path8.resolve(__dirname, "../../../package.json"),
    path8.resolve(__dirname, "../../../../package.json"),
    path8.resolve(process.cwd(), "package.json")
  ];
  for (const candidate of candidates) {
    const pkg = readJson(candidate);
    if (typeof pkg?.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  }
  return "0.1.0";
}
function findExistingDir(label, candidates) {
  for (const candidate of candidates) {
    if (existsSync4(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${label} in any of:
${candidates.map((c) => `  - ${c}`).join("\n")}`
  );
}
function findTemplateDir(kind) {
  return findExistingDir(`Claude Code template directory '${kind}'`, [
    path8.resolve(__dirname, "templates", kind),
    path8.resolve(__dirname, "../runtime/claude-code/templates", kind),
    path8.resolve(__dirname, "../../ts/src/runtime/claude-code/templates", kind),
    path8.resolve(__dirname, "../../../ts/src/runtime/claude-code/templates", kind),
    path8.resolve(process.cwd(), "ts/src/runtime/claude-code/templates", kind)
  ]);
}
function findSkillDir() {
  return findExistingDir("OpenBox skill directory", [
    path8.resolve(__dirname, "../../skill"),
    path8.resolve(__dirname, "../../../skill"),
    path8.resolve(__dirname, "../../../../skill"),
    path8.resolve(process.cwd(), "skill")
  ]);
}
function safeOutDir(out) {
  const resolved = path8.resolve(out);
  const root = path8.parse(resolved).root;
  if (resolved === root || resolved === os.homedir()) {
    throw new Error(`Refusing to overwrite unsafe Claude Code plugin path: ${resolved}`);
  }
  return resolved;
}
function assertProjectTarget(target, cwd) {
  const resolvedTarget = safeOutDir(target);
  const resolvedProject = path8.resolve(cwd);
  const rel = path8.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith("..") || path8.isAbsolute(rel)) {
    throw new Error(`Claude Code plugin install target must be inside the project: ${resolvedProject}`);
  }
  return resolvedTarget;
}
function writeJson(file, value) {
  mkdirSync2(path8.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isLegacyClaudeCodeHook(value) {
  return isRecord(value) && typeof value.command === "string" && /\bopenbox\s+claude-code\s+hook\b/.test(value.command);
}
function scrubLegacyClaudeCodeSettingsHooks(cwd) {
  const settingsFile = path8.join(cwd, ".claude", "settings.json");
  const settings = readJson(settingsFile);
  if (!settings || !isRecord(settings.hooks)) return;
  let changed = false;
  const nextHooks = {};
  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) {
      nextHooks[eventName] = entries;
      continue;
    }
    const nextEntries = entries.map((entry) => {
      if (!isRecord(entry)) return entry;
      if (isLegacyClaudeCodeHook(entry)) {
        changed = true;
        return void 0;
      }
      if (!Array.isArray(entry.hooks)) return entry;
      const nextInnerHooks = entry.hooks.filter((hook) => !isLegacyClaudeCodeHook(hook));
      if (nextInnerHooks.length !== entry.hooks.length) changed = true;
      if (nextInnerHooks.length === 0) return void 0;
      return { ...entry, hooks: nextInnerHooks };
    }).filter((entry) => entry !== void 0);
    if (nextEntries.length === 0) {
      changed = true;
      continue;
    }
    nextHooks[eventName] = nextEntries;
  }
  if (!changed) return;
  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  if (Object.keys(nextSettings).length === 0) {
    rmSync(settingsFile, { force: true });
    return;
  }
  writeJson(settingsFile, nextSettings);
}
function hasLegacyClaudeCodeSettingsHooks(cwd = process.cwd()) {
  const settings = readJson(path8.join(cwd, ".claude", "settings.json"));
  return JSON.stringify(settings ?? {}).includes("openbox claude-code hook");
}
function isLegacyOpenBoxMcpServer(value) {
  if (!isRecord(value) || value.command !== "openbox") return false;
  const args = Array.isArray(value.args) ? value.args : [];
  return args[0] === "mcp" && args[1] === "serve";
}
function scrubLegacyOpenBoxProjectMcp(cwd) {
  const mcpFile = path8.join(cwd, ".mcp.json");
  const mcp = readJson(mcpFile);
  if (!mcp || !isRecord(mcp.mcpServers)) return;
  if (!isLegacyOpenBoxMcpServer(mcp.mcpServers.openbox)) return;
  const nextServers = { ...mcp.mcpServers };
  delete nextServers.openbox;
  const nextMcp = { ...mcp };
  if (Object.keys(nextServers).length > 0) {
    nextMcp.mcpServers = nextServers;
  } else {
    delete nextMcp.mcpServers;
  }
  if (Object.keys(nextMcp).length === 0) {
    rmSync(mcpFile, { force: true });
    return;
  }
  writeJson(mcpFile, nextMcp);
}
function hasLegacyOpenBoxProjectMcp(cwd = process.cwd()) {
  const mcp = readJson(path8.join(cwd, ".mcp.json"));
  return isLegacyOpenBoxMcpServer(
    isRecord(mcp?.mcpServers) ? mcp.mcpServers.openbox : void 0
  );
}
function writeRuntimeConfigTemplate(configDir) {
  mkdirSync2(configDir, { recursive: true });
  const file = path8.join(configDir, "config.json");
  if (existsSync4(file)) return;
  const example = {
    OPENBOX_API_KEY: "obx_live_YOUR_API_KEY_HERE",
    OPENBOX_CORE_URL: "https://core.example/ob",
    GOVERNANCE_POLICY: "fail_open",
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true
  };
  writeFileSync(file, JSON.stringify(example, null, 2) + "\n", {
    mode: 384,
    encoding: "utf-8"
  });
}
function claudeCodeRuntimeConfigDir(cwd = process.cwd()) {
  return path8.join(cwd, ".claude-hooks");
}
function hookEvents(includeOptInHooks = false) {
  const defaultEvents = new Set(defaultClaudeCodeHookEvents());
  return HOOK_SPEC.events.filter((event) => {
    if (event.installDefault === false) return includeOptInHooks;
    if (!defaultEvents.has(event.name)) return includeOptInHooks;
    return true;
  });
}
function claudeHooksJson(matchers, includeOptInHooks = false) {
  const hooks = {};
  for (const event of hookEvents(includeOptInHooks)) {
    const hook = {
      ...PLUGIN_HOOK_HANDLER
    };
    if (event.timeout !== void 0) hook.timeout = event.timeout;
    const entry = {
      hooks: [hook]
    };
    const matcher = matchers?.[event.name];
    if (matcher) entry.matcher = matcher;
    hooks[event.name] = [entry];
  }
  return { [HOOK_SPEC.key]: hooks };
}
function mcpJson() {
  return {
    mcpServers: {
      openbox: { ...PLUGIN_MCP_SERVER }
    }
  };
}
function componentInventory(version) {
  const defaultEvents = hookEvents(false).map((event) => event.name);
  return {
    name: "openbox",
    version,
    capturedAt: CLAUDE_CODE_GOVERNANCE_AUDIT.capturedAt,
    installedClaudeCodeVersion: CLAUDE_CODE_GOVERNANCE_AUDIT.installedClaudeCodeVersion,
    components: {
      skill: {
        status: "installed",
        path: "skills/openbox/SKILL.md"
      },
      commands: {
        status: "installed",
        path: "commands/",
        files: [...EXPECTED_COMMAND_FILES]
      },
      agent: {
        status: "installed",
        path: "agents/openbox-reviewer.md"
      },
      hooks: {
        status: "installed",
        path: "hooks/hooks.json",
        defaultEvents,
        optInEvents: optInClaudeCodeHookEvents()
      },
      mcp: {
        status: "installed",
        path: ".mcp.json",
        command: "node ${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs mcp serve"
      },
      settings: {
        status: "diagnose_only",
        path: "settings.json",
        emitted: false,
        notes: "OpenBox does not emit plugin settings; agent/subagentStatusLine and strictPluginOnlyCustomization remain deployment policy diagnostics."
      },
      diagnostics: {
        status: "installed",
        path: "diagnostics/",
        files: [...EXPECTED_DIAGNOSTIC_FILES]
      },
      bin: {
        status: "installed",
        path: "bin/openbox-plugin-doctor",
        files: [...EXPECTED_BIN_FILES],
        command: "node ${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs claude-code doctor"
      },
      monitors: {
        status: "opt_in_metadata",
        activeByDefault: false,
        path: "diagnostics/monitors.opt-in.json",
        notes: "Copy to monitors/monitors.json only after accepting unsandboxed monitor execution."
      },
      lsp: {
        status: "not_included",
        notes: "No OpenBox language-server use case was found in the Claude Code governance audit."
      }
    },
    surfaces: CLAUDE_CODE_SURFACE_MATRIX
  };
}
function governanceDiagnostic(version) {
  return {
    version,
    audit: CLAUDE_CODE_GOVERNANCE_AUDIT,
    hooks: CLAUDE_CODE_HOOK_MATRIX,
    defaultHookEvents: defaultClaudeCodeHookEvents(),
    optInHookEvents: optInClaudeCodeHookEvents(),
    generatedHookSpecEvents: HOOK_SPEC.events.map((event) => event.name),
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
    sdkCapabilities: CLAUDE_CODE_SDK_CAPABILITY_MATRIX
  };
}
function optInMonitorMetadata() {
  return [
    {
      name: "openbox-status",
      command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs" status --json',
      description: "OpenBox runtime status and approval readiness notifications.",
      when: "on-skill-invoke:openbox",
      activeByDefault: false
    }
  ];
}
function writePluginCliRunner(file) {
  mkdirSync2(path8.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "#!/usr/bin/env node",
      "import { existsSync } from 'node:fs';",
      "import path from 'node:path';",
      "import { spawnSync } from 'node:child_process';",
      "",
      "const args = process.argv.slice(2);",
      "",
      "function candidateFromEnv() {",
      "  const value = process.env.OPENBOX_CLI;",
      "  if (!value) return undefined;",
      "  const resolved = path.resolve(value);",
      "  return existsSync(resolved) ? resolved : undefined;",
      "}",
      "",
      "function projectRoots() {",
      "  const roots = [];",
      "  if (process.env.CLAUDE_PROJECT_DIR) roots.push(process.env.CLAUDE_PROJECT_DIR);",
      "  roots.push(process.cwd());",
      "  const out = [];",
      "  for (const root of roots) {",
      "    let cur = path.resolve(root);",
      "    for (let i = 0; i < 8; i += 1) {",
      "      if (!out.includes(cur)) out.push(cur);",
      "      const parent = path.dirname(cur);",
      "      if (parent === cur) break;",
      "      cur = parent;",
      "    }",
      "  }",
      "  return out;",
      "}",
      "",
      "function candidateFromProjectNodeModules() {",
      "  for (const root of projectRoots()) {",
      "    const candidate = path.join(root, 'node_modules', '@openbox-ai', 'openbox-sdk', 'dist', 'cli', 'index.js');",
      "    if (existsSync(candidate)) return candidate;",
      "  }",
      "  return undefined;",
      "}",
      "",
      "const cli = candidateFromEnv() ?? candidateFromProjectNodeModules();",
      "if (!cli) {",
      "  console.error('OpenBox SDK CLI not found for project-scoped Claude Code plugin. Set OPENBOX_CLI to this project\\'s SDK dist/cli/index.js, or install @openbox-ai/openbox-sdk in the project.');",
      "  process.exit(127);",
      "}",
      "",
      "const result = spawnSync(process.execPath, [cli, ...args], {",
      "  stdio: 'inherit',",
      "  env: process.env,",
      "});",
      "",
      "if (result.error) {",
      "  console.error(result.error.message);",
      "  process.exit(127);",
      "}",
      "process.exit(result.status ?? 1);",
      ""
    ].join("\n"),
    "utf-8"
  );
  chmodSync(file, 493);
}
function writePluginDoctorShim(file) {
  mkdirSync2(path8.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'exec node "$DIR/openbox-cli.mjs" claude-code doctor "$@"',
      ""
    ].join("\n"),
    "utf-8"
  );
  chmodSync(file, 493);
}
function pluginManifest(version) {
  return {
    name: "openbox",
    displayName: "OpenBox AI Governance",
    version,
    description: "Active governance for Claude Code: prompt gates, tool gates, policy checks, guardrails, approvals, MCP tools, skills, and agent templates.",
    author: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    license: "MIT",
    homepage: "https://github.com/OpenBox-AI/openbox-sdk#readme",
    repository: "https://github.com/OpenBox-AI/openbox-sdk",
    keywords: [
      "openbox",
      "ai-governance",
      "claude-code",
      "guardrails",
      "policy",
      "opa",
      "approvals",
      "hitl",
      "agent-trace",
      "behavior-rules",
      "skill",
      "mcp",
      "hooks",
      "agents",
      "commands"
    ]
  };
}
function marketplaceManifest(version) {
  return {
    name: "openbox",
    description: "OpenBox governance plugin marketplace for Claude Code.",
    owner: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    plugins: [
      {
        name: "openbox",
        source: "./",
        description: "Active governance for Claude Code through prompt/tool hooks, OpenBox Core verdicts, approvals, MCP tools, skills, and agent templates.",
        version,
        author: {
          name: "OpenBox AI",
          email: "team@openbox.ai"
        },
        homepage: "https://github.com/OpenBox-AI/openbox-sdk#readme",
        repository: "https://github.com/OpenBox-AI/openbox-sdk",
        license: "MIT",
        keywords: ["openbox", "claude-code", "ai-governance", "guardrails", "approvals"]
      }
    ]
  };
}
function copyDir(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync2(path8.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}
function exportClaudeCodePlugin(options) {
  const out = safeOutDir(options.out);
  if (existsSync4(out)) {
    if (options.force === false) {
      throw new Error(`Claude Code plugin output already exists: ${out}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync2(out, { recursive: true });
  const version = packageVersion();
  writeJson(path8.join(out, ".claude-plugin", "plugin.json"), pluginManifest(version));
  writeJson(path8.join(out, ".claude-plugin", "marketplace.json"), marketplaceManifest(version));
  copyDir(findSkillDir(), path8.join(out, "skills", "openbox"));
  copyDir(findTemplateDir("commands"), path8.join(out, "commands"));
  copyDir(findTemplateDir("agents"), path8.join(out, "agents"));
  writeJson(path8.join(out, "hooks", "hooks.json"), claudeHooksJson(options.matchers, options.includeOptInHooks));
  writeJson(path8.join(out, ".mcp.json"), mcpJson());
  writeJson(path8.join(out, "diagnostics", "component-inventory.json"), componentInventory(version));
  writeJson(path8.join(out, "diagnostics", "claude-code-governance.json"), governanceDiagnostic(version));
  writeJson(path8.join(out, "diagnostics", "monitors.opt-in.json"), optInMonitorMetadata());
  writePluginCliRunner(path8.join(out, PLUGIN_CLI_RUNNER));
  writePluginDoctorShim(path8.join(out, "bin", "openbox-plugin-doctor"));
  return out;
}
function installClaudeCodePlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir(options.symlink);
    if (!existsSync4(source)) {
      throw new Error(`Claude Code plugin symlink source does not exist: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync2(path8.dirname(target), { recursive: true });
    symlinkSync(source, target, "dir");
    if (!options.skipRuntimeConfig) {
      writeRuntimeConfigTemplate(claudeCodeRuntimeConfigDir(cwd));
    }
    scrubLegacyClaudeCodeSettingsHooks(cwd);
    scrubLegacyOpenBoxProjectMcp(cwd);
    return target;
  }
  const out = exportClaudeCodePlugin({
    out: target,
    matchers: options.matchers,
    includeOptInHooks: options.includeOptInHooks
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(claudeCodeRuntimeConfigDir(cwd));
  }
  scrubLegacyClaudeCodeSettingsHooks(cwd);
  scrubLegacyOpenBoxProjectMcp(cwd);
  return out;
}
function uninstallClaudeCodePlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
  scrubLegacyClaudeCodeSettingsHooks(cwd);
  scrubLegacyOpenBoxProjectMcp(cwd);
}
function checkFile(name, file) {
  return {
    name,
    status: existsSync4(file) ? "pass" : "fail",
    path: file,
    detail: existsSync4(file) ? "present" : "missing"
  };
}
function checkDirFiles(name, dir, expected) {
  if (!existsSync4(dir)) {
    return { name, status: "fail", path: dir, detail: "directory missing" };
  }
  const present = new Set(readdirSync(dir).filter((file) => expected.includes(file)));
  const missing = expected.filter((file) => !present.has(file));
  return {
    name,
    status: missing.length === 0 ? "pass" : "fail",
    path: dir,
    detail: missing.length === 0 ? `${expected.length} file(s)` : `missing: ${missing.join(", ")}`
  };
}
function checkHooks(file, includeOptInHooks = false) {
  const hooksJson = readJson(file);
  const hooks = hooksJson?.[HOOK_SPEC.key];
  const problems = [];
  if (!hooks || typeof hooks !== "object") {
    problems.push("hooks block missing");
  } else {
    for (const event of hookEvents(includeOptInHooks)) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0];
      const hook = Array.isArray(entry.hooks) ? entry.hooks[0] : void 0;
      if (hook?.type !== "command") {
        problems.push(`${event.name}: hook type drift`);
      }
      if (hook?.command !== PLUGIN_HOOK_HANDLER.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (JSON.stringify(hook?.args) !== JSON.stringify(PLUGIN_HOOK_HANDLER.args)) {
        problems.push(`${event.name}: args drift`);
      }
      if (event.timeout !== void 0 && hook?.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(hook?.timeout)} != ${event.timeout}`);
      }
    }
    for (const entry of CLAUDE_CODE_HOOK_MATRIX.filter((item) => item.defaultInstall && item.status !== "explicit_out_of_scope")) {
      if (!hooks[entry.event]) {
        problems.push(`${entry.event}: missing from default governance matrix`);
      }
    }
    for (const entry of CLAUDE_CODE_HOOK_MATRIX.filter((item) => !item.defaultInstall)) {
      if (!includeOptInHooks && hooks[entry.event]) {
        problems.push(`${entry.event}: opt-in event installed by default`);
      }
    }
  }
  return {
    name: "plugin-hooks",
    status: problems.length === 0 ? "pass" : "fail",
    path: file,
    detail: problems.length === 0 ? `${hookEvents(includeOptInHooks).length} event(s)` : problems.join("; ")
  };
}
function checkMcp(file) {
  const json = readJson(file);
  const openbox = json?.mcpServers?.openbox;
  const ok = openbox?.command === PLUGIN_MCP_SERVER.command && Array.isArray(openbox.args) && JSON.stringify(openbox.args) === JSON.stringify(PLUGIN_MCP_SERVER.args);
  return {
    name: "plugin-mcp",
    status: ok ? "pass" : "fail",
    path: file,
    detail: ok ? "node bin/openbox-cli.mjs mcp serve" : "openbox server entry missing or malformed"
  };
}
function checkComponentInventory(file) {
  const json = readJson(file);
  const components = json?.components;
  const missing = EXPECTED_COMPONENT_NAMES.filter((name) => !components?.[name]);
  return {
    name: "plugin-component-inventory",
    status: missing.length === 0 ? "pass" : "fail",
    path: file,
    detail: missing.length === 0 ? `${EXPECTED_COMPONENT_NAMES.length} component(s)` : `missing: ${missing.join(", ")}`
  };
}
function checkNoLegacySettingsHooks(cwd = process.cwd()) {
  const file = path8.join(cwd, ".claude", "settings.json");
  const stale = hasLegacyClaudeCodeSettingsHooks(cwd);
  return {
    name: "project-settings-legacy-hooks",
    status: stale ? "fail" : "pass",
    path: file,
    detail: stale ? "remove stale `openbox claude-code hook` project settings entries" : "no legacy project settings hooks"
  };
}
function checkNoLegacyProjectMcp(cwd = process.cwd()) {
  const file = path8.join(cwd, ".mcp.json");
  const stale = hasLegacyOpenBoxProjectMcp(cwd);
  return {
    name: "project-mcp-legacy-openbox",
    status: stale ? "fail" : "pass",
    path: file,
    detail: stale ? "remove stale project `.mcp.json` openbox command entry" : "no legacy project MCP openbox entry"
  };
}
function verifyClaudeCodePlugin(options = {}) {
  const target = safeOutDir(
    options.target ?? claudeCodePluginTargetDir(options.cwd)
  );
  const checks = [];
  if (existsSync4(target)) {
    const stat = lstatSync(target);
    checks.push({
      name: "plugin",
      status: "pass",
      path: target,
      detail: stat.isSymbolicLink() ? "symlink installed" : "installed"
    });
  } else {
    checks.push({ name: "plugin", status: "fail", path: target, detail: "missing" });
  }
  checks.push(checkFile("plugin-manifest", path8.join(target, ".claude-plugin", "plugin.json")));
  checks.push(checkFile("plugin-marketplace", path8.join(target, ".claude-plugin", "marketplace.json")));
  checks.push(checkFile("plugin-skill", path8.join(target, "skills", "openbox", "SKILL.md")));
  checks.push(checkDirFiles("plugin-commands", path8.join(target, "commands"), EXPECTED_COMMAND_FILES));
  checks.push(checkDirFiles("plugin-agents", path8.join(target, "agents"), EXPECTED_AGENT_FILES));
  checks.push(checkHooks(path8.join(target, "hooks", "hooks.json"), options.includeOptInHooks));
  checks.push(checkMcp(path8.join(target, ".mcp.json")));
  checks.push(checkDirFiles("plugin-diagnostics", path8.join(target, "diagnostics"), EXPECTED_DIAGNOSTIC_FILES));
  checks.push(checkComponentInventory(path8.join(target, "diagnostics", "component-inventory.json")));
  checks.push(checkDirFiles("plugin-bin", path8.join(target, "bin"), EXPECTED_BIN_FILES));
  checks.push(checkNoLegacySettingsHooks(options.cwd));
  checks.push(checkNoLegacyProjectMcp(options.cwd));
  return checks;
}

// ts/src/runtime/claude-code/install.ts
function installClaudeCode(opts = {}) {
  installClaudeCodePlugin({ scope: opts.scope, cwd: opts.cwd });
}
function uninstallClaudeCode(opts = {}) {
  uninstallClaudeCodePlugin({ scope: opts.scope, cwd: opts.cwd });
}

// ts/src/runtime/claude-code/doctor.ts
import { existsSync as existsSync5 } from "fs";
import path9 from "path";
function truthy(value) {
  return value === "true" || value === "1";
}
function isPlaceholderKey(value) {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}
function parseApprovalMode2(value) {
  const mode = (value ?? "remote").toLowerCase();
  if (mode === "inline" || mode === "defer") return mode;
  return "remote";
}
function parseFailMode(value) {
  return value === "fail_closed" ? "fail_closed" : "fail_open";
}
function buildProjectRuntimeEnv(cwd = process.cwd()) {
  const configDir = claudeCodeRuntimeConfigDir(cwd);
  const configFile = path9.join(configDir, "config.json");
  const envFile = path9.join(configDir, ".env");
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key) => process.env[key] ?? fileConfig[key] ?? envConfig[key];
  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: get("OPENBOX_AGENT_DID"),
    OPENBOX_AGENT_PRIVATE_KEY: get("OPENBOX_AGENT_PRIVATE_KEY")
  });
  return {
    configDir,
    configFile,
    envFile,
    projectConfigPresent: existsSync5(configFile),
    projectEnvPresent: existsSync5(envFile),
    coreUrl: get("OPENBOX_CORE_URL") ?? "",
    apiKey: get("OPENBOX_API_KEY") ?? "",
    governancePolicy: parseFailMode(get("GOVERNANCE_POLICY")),
    approvalMode: parseApprovalMode2(get("APPROVAL_MODE")),
    dryRun: truthy(get("DRY_RUN")),
    agentIdentity
  };
}
function claudeCodeRuntimeDiagnostics(cwd = process.cwd()) {
  const runtime = buildProjectRuntimeEnv(cwd);
  return {
    configDir: runtime.configDir,
    configFile: runtime.configFile,
    envFile: runtime.envFile,
    projectScoped: true,
    runtimeEnv: {
      projectConfigPresent: runtime.projectConfigPresent,
      projectEnvPresent: runtime.projectEnvPresent,
      runtimeApiKeyPresent: Boolean(runtime.apiKey),
      runtimeApiKeyPlaceholder: isPlaceholderKey(runtime.apiKey),
      coreUrlPresent: Boolean(runtime.coreUrl),
      agentIdentityPresent: Boolean(runtime.agentIdentity)
    },
    failMode: runtime.governancePolicy,
    approvalMode: runtime.approvalMode,
    dryRun: runtime.dryRun,
    unsupportedOrOptInSurfaces: {
      worktreeCreate: "explicit_out_of_scope_replaces_default_git_behavior",
      sessionEnd: "opt_in_shutdown_telemetry",
      monitors: "opt_in_unsandboxed_not_project_scope",
      lsp: "out_of_scope_no_openbox_language_server",
      managedSettings: "enterprise_diagnose_only",
      channels: "diagnose_only_research_preview"
    }
  };
}
async function checkRuntimeReadiness(cwd, validateRuntime) {
  const runtime = buildProjectRuntimeEnv(cwd);
  const details = [
    `config=${runtime.configFile}`,
    `core=${runtime.coreUrl || "(missing)"}`,
    `failMode=${runtime.governancePolicy}`,
    `approvalMode=${runtime.approvalMode}`,
    `dryRun=${runtime.dryRun}`
  ];
  if (runtime.dryRun) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; DRY_RUN=true`
    };
  }
  if (!runtime.coreUrl) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; missing OPENBOX_CORE_URL`
    };
  }
  if (!runtime.apiKey) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; missing OPENBOX_API_KEY`
    };
  }
  if (isPlaceholderKey(runtime.apiKey)) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; placeholder OPENBOX_API_KEY`
    };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; invalid OPENBOX_API_KEY format: ${format}`
    };
  }
  if (!validateRuntime) {
    return {
      name: "runtime",
      status: "pass",
      path: runtime.configFile,
      detail: `${details.join("; ")}; key=format-ok`
    };
  }
  try {
    const core = new OpenBoxCoreClient({
      apiKey: runtime.apiKey,
      apiUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      timeoutMs: 5e3
    });
    const validation = await core.validateApiKey();
    const agent = validation?.agent_id ? `; agent=${validation.agent_id}` : "";
    return {
      name: "runtime",
      status: "pass",
      path: runtime.configFile,
      detail: `${details.join("; ")}; key=validated${agent}`
    };
  } catch (err) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; core validation failed: ${String(err?.message ?? err)}`
    };
  }
}
function summarizeClaudeCodeChecks(checks) {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, skip: 0, fail: 0 }
  );
}
function verifyClaudeCodeInstall(opts = {}) {
  const target = opts.pluginTarget ?? opts.target ?? claudeCodePluginTargetDir(opts.cwd);
  const checks = verifyClaudeCodePlugin({
    cwd: opts.cwd,
    target,
    includeOptInHooks: opts.includeOptInHooks
  }).map((check) => ({
    name: check.name,
    status: check.status,
    path: check.path,
    detail: check.detail
  }));
  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [
      ...checks,
      runtime
    ]);
  }
  return checks;
}

// ts/src/runtime/claude-code/index.ts
var HOOK_LOG_PATH = makeHookLog("claude-code").path;
export {
  CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX,
  HOOK_LOG_PATH,
  claudeCodeGovernanceSummary,
  claudeCodePluginTargetDir,
  claudeCodeRuntimeConfigDir,
  claudeCodeRuntimeDiagnostics,
  createClaudeCodeAdapter,
  defaultClaudeCodeHookEvents,
  exportClaudeCodePlugin,
  installClaudeCode,
  installClaudeCodePlugin,
  optInClaudeCodeHookEvents,
  runClaudeHook,
  summarizeClaudeCodeChecks,
  uninstallClaudeCode,
  uninstallClaudeCodePlugin,
  verifyClaudeCodeInstall,
  verifyClaudeCodePlugin
};
