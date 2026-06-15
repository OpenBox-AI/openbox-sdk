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
    this.inFlight.add(activityId);
    try {
      const verdict = await this.emit({
        event_type: "ActivityStarted",
        activity_id: activityId,
        activity_type: activityType,
        activity_input: payload.input,
        spans: payload.spans
      });
      verdict.activityId = activityId;
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
        const startedVerdict = await this.emit({
          event_type: "ActivityStarted",
          activity_id: activityId,
          activity_type: activityType,
          activity_input: payload.input,
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
    const completedVerdict = await this.emit({
      event_type: "ActivityCompleted",
      activity_id: activityId,
      activity_type: activityType,
      status: activityCompletionStatus(activityType),
      activity_input: payload.input,
      activity_output: payload.output,
      spans: payload.spans
    });
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
    return this.runActivity("ActivityStarted", "on_tool_start", payload);
  }
  async onToolEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_tool_end", payload);
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
function errorInfoFrom(value) {
  if (value == null) return void 0;
  if (value instanceof Error) {
    return { type: value.name || "Error", message: value.message };
  }
  return { type: typeof value, message: String(value) };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function applyJitter(baseMs, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f === 0) return baseMs;
  const noise = (Math.random() * 2 - 1) * f;
  return baseMs * (1 + noise);
}

// ts/src/core-client/generated/runtime/cursor.ts
var PRE_TOOL_USE_ROUTING = {
  "Read": "FileRead",
  "Write": "FileEdit",
  "Shell": "ShellExecution"
};
var BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE = "PromptSubmission";
var BEFORE_READ_FILE_ACTIVITY_TYPE = "FileRead";
var BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE = "ShellExecution";
var BEFORE_MCPEXECUTION_ACTIVITY_TYPE = "MCPToolCall";
var BEFORE_TAB_FILE_READ_ACTIVITY_TYPE = "FileRead";
var SUBAGENT_START_ACTIVITY_TYPE = "SubagentStart";
var HOOK_SPEC = {
  "file": ".cursor/hooks.json",
  "key": "hooks",
  "style": "cursor-keyed",
  "command": "openbox cursor hook",
  "configDir": ".cursor-hooks",
  "events": [
    {
      "name": "beforeSubmitPrompt",
      "timeout": 1800
    },
    {
      "name": "beforeReadFile",
      "timeout": 1800
    },
    {
      "name": "beforeShellExecution",
      "timeout": 1800
    },
    {
      "name": "beforeMCPExecution",
      "timeout": 1800
    },
    {
      "name": "preToolUse",
      "timeout": 1800
    },
    {
      "name": "afterAgentResponse"
    },
    {
      "name": "afterAgentThought"
    },
    {
      "name": "afterShellExecution"
    },
    {
      "name": "afterFileEdit"
    },
    {
      "name": "afterMCPExecution"
    },
    {
      "name": "postToolUse"
    },
    {
      "name": "postToolUseFailure"
    },
    {
      "name": "sessionStart"
    },
    {
      "name": "stop"
    },
    {
      "name": "beforeTabFileRead",
      "timeout": 1800
    },
    {
      "name": "afterTabFileEdit"
    },
    {
      "name": "sessionEnd"
    },
    {
      "name": "preCompact"
    },
    {
      "name": "subagentStart",
      "timeout": 1800
    },
    {
      "name": "subagentStop"
    }
  ]
};
function applyActivityVariant(table, toolName, env) {
  for (const v of table) {
    if (v.tool !== toolName) continue;
    const value = String((function getPath3(e, p) {
      if (e == null || typeof e !== "object") return void 0;
      let cur = e;
      for (const seg of p.split(".")) {
        if (cur == null || typeof cur !== "object") return void 0;
        cur = cur[seg];
      }
      return cur;
    })(env, v.field) ?? "");
    if (new RegExp(v.pattern).test(value)) return v;
  }
  return void 0;
}
var PRE_TOOL_USE_VARIANTS = [
  {
    "tool": "Shell",
    "field": "tool_input.command",
    "pattern": "\\b(rm|unlink|rmdir|shred)\\b",
    "activityType": "FileDelete",
    "eventCategory": "file_delete"
  }
];
function getPath(env, path10) {
  if (env == null || typeof env !== "object") return void 0;
  let cur = env;
  for (const seg of path10.split(".")) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function buildBeforeSubmitPromptPayload(env) {
  return {
    "prompt": getPath(env, "prompt"),
    "generation_id": getPath(env, "generation_id"),
    "event_category": "llm_prompt"
  };
}
function buildBeforeReadFilePayload(env) {
  return {
    "file_path": getPath(env, "file_path"),
    "content": getPath(env, "content"),
    "generation_id": getPath(env, "generation_id"),
    "event_category": "file_read"
  };
}
function buildBeforeShellExecutionPayload(env) {
  return {
    "command": getPath(env, "command"),
    "cwd": getPath(env, "cwd"),
    "generation_id": getPath(env, "generation_id"),
    "event_category": "agent_action"
  };
}
function buildBeforeMCPExecutionPayload(env, sideEffects2 = {}) {
  return {
    "tool_name": getPath(env, "tool_name"),
    "tool_input": sideEffects2.stringify?.(getPath(env, "tool_input")) ?? "",
    "generation_id": getPath(env, "generation_id"),
    "event_category": "api_call"
  };
}
function buildPreToolUsePayload(env, toolName, sideEffects2 = {}) {
  switch (toolName) {
    case "Read":
      return {
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": sideEffects2.readFile?.(getPath(env, "tool_input.file_path")) ?? "",
        "event_category": "file_read"
      };
    case "Write":
      return {
        "file_path": getPath(env, "tool_input.file_path") ?? getPath(env, "tool_input.filePath"),
        "content": getPath(env, "tool_input.content") ?? getPath(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Shell":
      return {
        "command": getPath(env, "tool_input.command"),
        "cwd": getPath(env, "tool_input.cwd") ?? getPath(env, "cwd"),
        "event_category": "agent_action"
      };
    default:
      return {};
  }
}
function buildBeforeTabFileReadPayload(env) {
  return {
    "file_path": getPath(env, "file_path"),
    "content": getPath(env, "content"),
    "generation_id": getPath(env, "generation_id"),
    "event_category": "file_read"
  };
}
function buildSubagentStartPayload(env) {
  return {
    "subagent_id": getPath(env, "subagent_id"),
    "subagent_type": getPath(env, "subagent_type"),
    "subagent_model": getPath(env, "subagent_model"),
    "task": getPath(env, "task"),
    "tool_call_id": getPath(env, "tool_call_id"),
    "parent_conversation_id": getPath(env, "parent_conversation_id"),
    "is_parallel_worker": getPath(env, "is_parallel_worker"),
    "git_branch": getPath(env, "git_branch"),
    "generation_id": getPath(env, "generation_id"),
    "event_category": "agent_action"
  };
}
function createCursorAdapter(config) {
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
        preset: presets.cursor,
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
    case "beforeSubmitPrompt": {
      if (!handlers.beforeSubmitPrompt) {
        writeFallback("cursor-continue", void 0, env);
        return;
      }
      const verdict = await handlers.beforeSubmitPrompt(env, session);
      writeVerdict("cursor-continue", verdict, env);
      return;
    }
    case "beforeReadFile": {
      if (!handlers.beforeReadFile) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeReadFile(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "beforeShellExecution": {
      if (!handlers.beforeShellExecution) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeShellExecution(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "beforeMCPExecution": {
      if (!handlers.beforeMCPExecution) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeMCPExecution(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "preToolUse": {
      if (!handlers.preToolUse) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.preToolUse(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "afterAgentResponse": {
      if (!handlers.afterAgentResponse) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterAgentResponse(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterAgentThought": {
      if (!handlers.afterAgentThought) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterAgentThought(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterShellExecution": {
      if (!handlers.afterShellExecution) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterShellExecution(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterFileEdit": {
      if (!handlers.afterFileEdit) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterFileEdit(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterMCPExecution": {
      if (!handlers.afterMCPExecution) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterMCPExecution(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "postToolUse": {
      if (!handlers.postToolUse) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUse(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "postToolUseFailure": {
      if (!handlers.postToolUseFailure) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUseFailure(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "sessionStart": {
      if (!handlers.sessionStart) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionStart(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "stop": {
      if (!handlers.stop) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.stop(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "beforeTabFileRead": {
      if (!handlers.beforeTabFileRead) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeTabFileRead(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "afterTabFileEdit": {
      if (!handlers.afterTabFileEdit) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterTabFileEdit(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "sessionEnd": {
      if (!handlers.sessionEnd) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionEnd(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "preCompact": {
      if (!handlers.preCompact) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.preCompact(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "subagentStart": {
      if (!handlers.subagentStart) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStart(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "subagentStop": {
      if (!handlers.subagentStop) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStop(env, session);
      writeVerdict("cursor-observe", verdict, env);
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
function renderVerdictOutput(shape, v, env, deferApproval = false) {
  const arm = v?.arm ?? "allow";
  const reason = brand(v?.reason ?? "");
  switch (shape) {
    case "permission-decision": {
      const eventName = env.hook_event_name ?? "PreToolUse";
      if (arm === "allow" || arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            permissionDecision: "allow"
          }
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
      return {};
    }
    case "permission-request": {
      const eventName = env.hook_event_name ?? "PermissionRequest";
      if (arm === "allow" || arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            decision: { behavior: "allow" }
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
      if (arm === "allow" || arm === "constrain") return {};
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
      if (arm === "allow" || arm === "constrain") return {};
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
var ENV_VAR_BINDINGS = {
  apiUrl: { "name": "OPENBOX_API_URL" },
  coreUrl: { "name": "OPENBOX_CORE_URL" },
  platformUrl: { "name": "OPENBOX_PLATFORM_URL" },
  authUrl: { "name": "OPENBOX_AUTH_URL" },
  stackUrl: { "name": "OPENBOX_STACK_URL" },
  apiKey: { "name": "OPENBOX_API_KEY" },
  experimentalLevel: { "name": "OPENBOX_EXPERIMENTAL_LEVEL" },
  features: { "name": "OPENBOX_FEATURES" }
};
var API_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;
function validateApiKeyFormat(value) {
  if (!API_KEY_PATTERN.test(value)) {
    return "OPENBOX_API_KEY must match obx_(live|test)_<48hex>";
  }
  return true;
}

// ts/src/env/connection.ts
function normalizeStackUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("OpenBox stack URL cannot be empty.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("OpenBox stack URL must use https:// unless it points at localhost.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function endpointsFromStackUrl(raw) {
  const stackUrl = normalizeStackUrl(raw);
  const url = new URL(stackUrl);
  const rootHost = url.hostname.replace(/^(api|core|auth)\./, "");
  const origin = `${url.protocol}//`;
  return {
    apiUrl: `${origin}api.${rootHost}/ob`,
    coreUrl: `${origin}core.${rootHost}/ob`,
    authUrl: `${origin}auth.${rootHost}/ob`,
    platformUrl: stackUrl
  };
}
var resolveConnection = (opts = {}) => {
  const stackUrl = opts.stackUrl ?? process.env[ENV_VAR_BINDINGS.stackUrl.name];
  const stackEndpoints = stackUrl ? endpointsFromStackUrl(stackUrl) : void 0;
  const apiUrl = requireUrl(
    "OPENBOX_API_URL",
    opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name] ?? stackEndpoints?.apiUrl
  );
  const coreUrl = requireUrl(
    "OPENBOX_CORE_URL",
    opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name] ?? stackEndpoints?.coreUrl
  );
  const platformUrl = opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name] ?? stackEndpoints?.platformUrl;
  const authUrl = opts.authUrl ?? process.env[ENV_VAR_BINDINGS.authUrl.name] ?? stackEndpoints?.authUrl;
  return {
    apiUrl,
    coreUrl,
    platformUrl,
    authUrl,
    stackUrl,
    displayName: opts.displayName ?? process.env.OPENBOX_STACK_NAME,
    source: stackUrl && !opts.apiUrl && !opts.coreUrl ? "stack-url" : "explicit"
  };
};
function requireUrl(name, value) {
  if (!value) throw new Error(`${name} is required. Set explicit OpenBox service URLs.`);
  return normalizeServiceUrl(name, value);
}
function normalizeServiceUrl(name, raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use https:// unless it points at localhost.`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
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
    return new Promise((resolve) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve();
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
    return this.request("POST", "/api/v1/governance/evaluate", {
      data: payload,
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

// ts/src/runtime/cursor/config.ts
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

// ts/src/runtime/cursor/config.ts
function resolveConfigDir(startDir = process.cwd()) {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, ".cursor-hooks");
    if (fs2.existsSync(path.join(candidate, "config.json"))) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(startDir, ".cursor-hooks");
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
  const skipRaw = get("SKIP_ACTIVITY_TYPES");
  const skipList = skipRaw ? skipRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const coreUrl = process.env.OPENBOX_CORE_URL ?? fileConfig.OPENBOX_CORE_URL ?? envConfig.OPENBOX_CORE_URL ?? "";
  return {
    openboxApiKey: get("OPENBOX_API_KEY"),
    openboxEndpoint: coreUrl,
    governancePolicy: get("GOVERNANCE_POLICY", "fail_open"),
    governanceTimeout: parseInt(get("GOVERNANCE_TIMEOUT", "15"), 10) || 15,
    activityType: get("ACTIVITY_TYPE", "CursorIDE"),
    sessionDir: get("SESSION_DIR", path.join(CONFIG_DIR, "sessions")),
    logFile: get("LOG_FILE", path.join(CONFIG_DIR, "hook.log")) || null,
    verbose: get("VERBOSE") === "true" || get("VERBOSE") === "1",
    dryRun: get("DRY_RUN") === "true" || get("DRY_RUN") === "1",
    hitlEnabled: get("HITL_ENABLED", "true") !== "false",
    hitlPollInterval: parseInt(get("HITL_POLL_INTERVAL", "5"), 10) || 5,
    hitlMaxWait: parseInt(get("HITL_MAX_WAIT", "300"), 10) || 300,
    approvalMode: get("APPROVAL_MODE", "remote").toLowerCase() === "inline" ? "inline" : "remote",
    approvalSocketPath: get("OPENBOX_APPROVAL_SOCKET") || null,
    taskQueue: get("TASK_QUEUE", "cursor-hooks"),
    sendStartEvent: get("SEND_START_EVENT", "true") !== "false",
    sendActivityStartEvent: get("SEND_ACTIVITY_START_EVENT", "true") !== "false",
    maxBodySize: get("MAX_BODY_SIZE") ? parseInt(get("MAX_BODY_SIZE"), 10) || null : null,
    skipActivityTypes: skipList,
    testDriftResponse: get("TEST_DRIFT_RESPONSE") || null
  };
}
var loadConfigFile = () => loadJsonConfig(CONFIG_FILE);
var loadEnvFile = () => loadDotenv(ENV_FILE);

// ts/src/config/store.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { dirname } from "path";

// ts/src/env/os-paths.ts
import { homedir } from "os";
import { join } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "openbox");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, "openbox");
  }
  return join(homedir(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};

// ts/src/config/store.ts
function getPath2() {
  const path10 = resolveOsPath("config");
  const dir = dirname(path10);
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true });
  return path10;
}
function read() {
  const path10 = getPath2();
  if (!existsSync2(path10)) return {};
  const out = {};
  for (const line of readFileSync2(path10, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !key.includes(".")) out[key] = value;
  }
  return out;
}
function listConfig() {
  return read();
}
function configStorePath() {
  return getPath2();
}
function applyConfigToProcessEnv() {
  for (const [key, value] of Object.entries(listConfig())) {
    if (process.env[key] === void 0) process.env[key] = value;
  }
}

// ts/src/cli/env-source.ts
function applyEnvSource() {
  applyConfigToProcessEnv();
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
function markHaltedByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing) store.save(key, { ...existing, halted: true });
}
function clearSessionByKey(key, cfg) {
  getStore(cfg).delete(key);
}

// ts/src/runtime/cursor/session-resolver.ts
async function resolveSession(env, cfg) {
  return resolveSessionByKey(env.conversation_id, cfg);
}
function markHalted(conversationId, cfg) {
  markHaltedByKey(conversationId, cfg);
}
function clearSession(conversationId, cfg) {
  clearSessionByKey(conversationId, cfg);
}

// ts/src/logging/hook-log.ts
import * as fs5 from "fs";
import * as path4 from "path";
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

// ts/src/approvals/socket-client.ts
import * as net from "net";
import * as path5 from "path";
import * as os from "os";
var APPROVAL_SOCKET_PATH = path5.join(
  os.homedir(),
  ".openbox",
  "run",
  "openbox.sock"
);
function connectApprovalSocket(socketPath = APPROVAL_SOCKET_PATH) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    const onConnect = () => {
      if (settled) return;
      settled = true;
      resolve(buildHandle(socket));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
      }
      resolve(null);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
      }
      resolve(null);
    }, 200);
  });
}
function buildHandle(socket) {
  let buffer = "";
  const listenersByGeid = /* @__PURE__ */ new Map();
  const dispatch2 = (geid, r) => {
    const list = listenersByGeid.get(geid);
    if (!list) return;
    listenersByGeid.delete(geid);
    for (const l of list) {
      try {
        l(r);
      } catch {
      }
    }
  };
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.type === "decision" && typeof msg.governance_event_id === "string" && (msg.decision === "approve" || msg.decision === "reject")) {
          dispatch2(msg.governance_event_id, {
            kind: "decision",
            decision: msg.decision
          });
        }
      } catch {
      }
    }
  });
  const drainAll = (r) => {
    for (const [geid] of [...listenersByGeid]) dispatch2(geid, r);
  };
  socket.once("close", () => drainAll({ kind: "closed" }));
  socket.once("error", () => drainAll({ kind: "closed" }));
  return {
    socket,
    notifyPending: (p) => {
      try {
        socket.write(JSON.stringify({ type: "pending", ...p }) + "\n");
      } catch {
      }
    },
    awaitDecision: (geid, deadlineMs) => new Promise((resolve) => {
      const list = listenersByGeid.get(geid) ?? [];
      list.push(resolve);
      listenersByGeid.set(geid, list);
      if (deadlineMs > 0) {
        setTimeout(() => {
          const cur = listenersByGeid.get(geid);
          if (!cur) return;
          const idx = cur.indexOf(resolve);
          if (idx === -1) return;
          cur.splice(idx, 1);
          if (cur.length === 0) listenersByGeid.delete(geid);
          resolve({ kind: "timeout" });
        }, deadlineMs);
      }
    }),
    close: () => {
      try {
        socket.end();
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

// ts/src/runtime/cursor/activity-types.ts
var ACTIVITY_TYPES = {
  PROMPT: "llm_prompt",
  COMPLETION: "llm_completion",
  FILE_READ: "file_read",
  FILE_WRITE: "file_write",
  AGENT_ACTION: "agent_action",
  AGENT_OBSERVATION: "agent_observation",
  AGENT_DECISION: "agent_decision",
  AGENT_GOAL: "agent_goal",
  API_CALL: "api_call",
  WORKFLOW_START: "workflow_start",
  WORKFLOW_COMPLETE: "workflow_complete"
};

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
function buildSpan(host, type, input) {
  const b = base();
  switch (type) {
    case "llm":
      return {
        ...b,
        name: "llm.chat.completion",
        span_type: "function",
        hook_type: "function_call",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": host,
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_completion",
          "openbox.span_type": "function"
        },
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

// ts/src/runtime/cursor/mappers/prompt.ts
async function handleBeforeSubmitPrompt(env, session, cfg) {
  const prompt = (env.prompt ?? "").trim();
  if (!prompt) return void 0;
  void session.activity(EVENT.SIGNAL, ACTIVITY_TYPES.AGENT_GOAL, {
    input: [stampSource({ goal: prompt, event_category: "agent_goal" }, "cursor")]
  }).catch(() => void 0);
  const payload = buildBeforeSubmitPromptPayload(env);
  const span = buildSpan("cursor", "llm", { prompt });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")], spans: [span] }
  );
  if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
  return verdict;
}

// ts/src/runtime/cursor/dedup.ts
import * as fs6 from "fs";
import * as path6 from "path";
import * as os2 from "os";
import * as crypto from "crypto";
var DEDUP_DIR = path6.join(os2.homedir(), ".openbox", "run", "dedup");
var TTL_MS = 60 * 60 * 1e3;
var POLL_INTERVAL_MS = 100;
var DEFAULT_AWAIT_TIMEOUT_MS = 60 * 60 * 1e3;
function ensureDir2() {
  try {
    fs6.mkdirSync(DEDUP_DIR, { recursive: true, mode: 448 });
  } catch {
  }
}
function reapStale() {
  let entries;
  try {
    entries = fs6.readdirSync(DEDUP_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - TTL_MS;
  for (const name of entries) {
    const p = path6.join(DEDUP_DIR, name);
    try {
      const st = fs6.statSync(p);
      if (st.mtimeMs < cutoff) fs6.unlinkSync(p);
    } catch {
    }
  }
}
function hashKey(raw) {
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}
function buildActionKey(parts) {
  const ns = parts.generation_id || parts.conversation_id || "no-ns";
  return hashKey(`${ns}:${parts.kind}:${parts.arg}`);
}
function claimAction(key) {
  ensureDir2();
  reapStale();
  const lockPath = path6.join(DEDUP_DIR, key);
  try {
    const fd = fs6.openSync(lockPath, "wx", 384);
    try {
      fs6.writeSync(fd, String(Date.now()));
    } finally {
      fs6.closeSync(fd);
    }
    return { won: true, path: lockPath };
  } catch (err) {
    if (err?.code === "EEXIST") {
      try {
        const st = fs6.statSync(lockPath);
        if (Date.now() - st.mtimeMs > TTL_MS) {
          fs6.unlinkSync(lockPath);
          try {
            const fd = fs6.openSync(lockPath, "wx", 384);
            fs6.closeSync(fd);
            return { won: true, path: lockPath };
          } catch {
            return { won: false, path: lockPath };
          }
        }
      } catch {
      }
      return { won: false, path: lockPath };
    }
    return { won: true, path: lockPath };
  }
}
var PUBLISH_GRACE_MS = 800;
function publishClaimDecision(claim, decision) {
  if (!claim.won) return;
  const tmp = `${claim.path}.tmp.${process.pid}`;
  try {
    fs6.writeFileSync(
      tmp,
      JSON.stringify({ ts: Date.now(), arm: decision.arm, reason: decision.reason }),
      { mode: 384 }
    );
    fs6.renameSync(tmp, claim.path);
    setTimeout(() => {
      try {
        fs6.unlinkSync(claim.path);
      } catch {
      }
    }, PUBLISH_GRACE_MS);
  } catch {
    try {
      fs6.unlinkSync(tmp);
    } catch {
    }
  }
}
function sleep2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function readDecisionOnce(lockPath) {
  let content;
  try {
    content = fs6.readFileSync(lockPath, "utf-8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed.arm !== "string") return null;
  return {
    arm: parsed.arm,
    reason: typeof parsed.reason === "string" ? parsed.reason : ""
  };
}
async function awaitClaimDecision(claim, deadlineMs = DEFAULT_AWAIT_TIMEOUT_MS) {
  if (claim.won) return null;
  const wait = Number.isFinite(deadlineMs) && deadlineMs > 0 ? Math.min(deadlineMs, DEFAULT_AWAIT_TIMEOUT_MS) : DEFAULT_AWAIT_TIMEOUT_MS;
  const deadline = Date.now() + wait;
  const first = readDecisionOnce(claim.path);
  if (first) return first;
  while (Date.now() < deadline) {
    await sleep2(POLL_INTERVAL_MS);
    const decision = readDecisionOnce(claim.path);
    if (decision) return decision;
  }
  return null;
}
var RM_PATTERN = /\b(rm|unlink|rmdir|shred)\b/;
function isFileDeleteCommand(command) {
  if (!command) return false;
  return RM_PATTERN.test(command);
}

// ts/src/runtime/cursor/mappers/shell.ts
async function handleBeforeShellExecution(env, session, cfg) {
  const command = env.command ?? "";
  if (!command) return void 0;
  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: "shell",
    arg: command
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1e3);
    if (!decision) return void 0;
    if (decision.arm === "allow" || decision.arm === "constrain") return void 0;
    if (decision.arm === "halt") markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }
  const payload = buildBeforeShellExecutionPayload(env);
  const isDelete = isFileDeleteCommand(command);
  const activityType = isDelete ? "FileDelete" : BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE;
  const span = buildSpan("cursor", isDelete ? "file_delete" : "shell", {
    command,
    cwd: env.cwd
  });
  if (isDelete) payload.event_category = "file_delete";
  try {
    const verdict = await session.activity(EVENT.START, activityType, {
      input: [stampSource(payload, "cursor")],
      spans: [span]
    });
    publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? "" });
    if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    publishClaimDecision(claim, { arm: "block", reason: "[OpenBox] gate failed" });
    throw err;
  }
}

// ts/src/runtime/cursor/side-effects.ts
import * as fs7 from "fs";

// ts/src/governance/skip-patterns.ts
import path7 from "path";
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
var SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.env($|[./-])/,
  /(^|\/)\.env\.[^/]+$/,
  /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
  /(^|\/)(credentials|secrets?|token|tokens)\.(json|ya?ml|toml|ini|env|txt)$/,
  /(^|\/)(credentials|config)$/,
  /\.(pem|key|p12|pfx|crt)$/i,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.openbox\/tokens$/
];
function isSensitivePath(filePath) {
  return SENSITIVE_PATH_PATTERNS.some((p) => p.test(filePath));
}
function isInsideAnyRoot(filePath, roots, cwd) {
  if (!filePath || !roots || roots.length === 0) return false;
  const norm = (p) => p.replace(/\/+$/, "");
  const f = norm(path7.resolve(cwd ?? roots[0] ?? process.cwd(), filePath));
  return roots.some((r) => {
    const root = norm(path7.resolve(r));
    return f === root || f.startsWith(root + "/");
  });
}

// ts/src/runtime/cursor/side-effects.ts
var sideEffects = {
  /** File read for cursor's preToolUse Read mapping. Same skip-pattern
   *  filter as claude-code; cursor's `beforeReadFile` already inlines
   *  content into the envelope so this is only used for preToolUse. */
  readFile(input) {
    if (typeof input !== "string" || !input) return "";
    if (isSkipped(input)) return "";
    try {
      return fs7.existsSync(input) ? fs7.readFileSync(input, "utf-8") : "";
    } catch {
      return "";
    }
  },
  /** JSON-stringify pass-through (no truncation; cursor's beforeMCPExecution
   *  payload is bounded by the originating tool call, not by
   *  agent-streamed output). */
  stringify(input) {
    return typeof input === "string" ? input : JSON.stringify(input ?? {});
  },
  /** Extract `text`-typed entries from an MCP `{ content: [{ type, text }] }`
   *  response. Falls back to JSON of the raw value on shape mismatch so
   *  output guardrails always have *something* to scan. */
  extractMcpText(input) {
    if (typeof input === "string") {
      try {
        const parsed = JSON.parse(input);
        if (Array.isArray(parsed.content)) {
          return parsed.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
        }
        return JSON.stringify(parsed);
      } catch {
        return input;
      }
    }
    return JSON.stringify(input ?? {});
  }
};

// ts/src/runtime/cursor/mappers/mcp.ts
async function handleBeforeMCPExecution(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  if (!toolName) return void 0;
  const payload = buildBeforeMCPExecutionPayload(env, sideEffects);
  const span = buildSpan("cursor", "mcp", { tool_name: toolName, tool_input: env.tool_input });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")], spans: [span] }
  );
  if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
  return verdict;
}

// ts/src/runtime/cursor/mappers/file-read.ts
async function handleBeforeReadFile(env, session, cfg) {
  const filePath = env.file_path ?? "";
  if (!filePath) return void 0;
  if (isSkipped(filePath)) return void 0;
  if (isInsideAnyRoot(filePath, env.workspace_roots, env.cwd)) return void 0;
  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: "read",
    arg: filePath
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1e3);
    if (!decision) return void 0;
    if (decision.arm === "allow" || decision.arm === "constrain") return void 0;
    if (decision.arm === "halt") markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }
  const payload = buildBeforeReadFilePayload(env);
  const span = buildSpan("cursor", "file_read", { file_path: filePath });
  try {
    const verdict = await session.activity(
      EVENT.START,
      BEFORE_READ_FILE_ACTIVITY_TYPE,
      { input: [stampSource(payload, "cursor")], spans: [span] }
    );
    publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? "" });
    if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    publishClaimDecision(claim, { arm: "block", reason: "[OpenBox] gate failed" });
    throw err;
  }
}
async function handleBeforeTabFileRead(env, session, cfg) {
  const filePath = env.file_path ?? "";
  if (!filePath) return void 0;
  if (isSkipped(filePath)) return void 0;
  if (isInsideAnyRoot(filePath, env.workspace_roots, env.cwd) && !isSensitivePath(filePath)) {
    return void 0;
  }
  const payload = buildBeforeTabFileReadPayload(env);
  const span = buildSpan("cursor", "file_read", { file_path: filePath });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_TAB_FILE_READ_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")], spans: [span] }
  );
  if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
  return verdict;
}

// ts/src/runtime/cursor/mappers/pre-tool-use.ts
async function handlePreToolUse(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const baseActivity = PRE_TOOL_USE_ROUTING[toolName];
  if (!baseActivity) return void 0;
  const toolInput = env.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.filePath ?? "";
  const command = toolInput.command ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  if (filePath && (toolName === "Read" || toolName === "Write") && isInsideAnyRoot(filePath, env.workspace_roots, env.cwd)) {
    return void 0;
  }
  const claimKind = toolName === "Shell" ? "shell" : toolName === "Read" ? "read" : toolName === "Write" ? "write" : null;
  const claim = claimKind ? claimAction(buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: claimKind,
    arg: claimKind === "shell" ? command : filePath
  })) : null;
  if (claim && !claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1e3);
    if (!decision) return void 0;
    if (decision.arm === "allow" || decision.arm === "constrain") return void 0;
    if (decision.arm === "halt") markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }
  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const override = applyActivityVariant(PRE_TOOL_USE_VARIANTS, toolName, env);
  const activityType = override?.activityType ?? baseActivity;
  if (override?.eventCategory) payload.event_category = override.eventCategory;
  const spanType = override?.activityType === "FileDelete" ? "file_delete" : toolName === "Read" ? "file_read" : toolName === "Write" ? "file_write" : "shell";
  const span = buildSpan("cursor", spanType, {
    file_path: filePath || void 0,
    command: toolInput.command || void 0,
    cwd: toolInput.cwd || env.cwd || void 0
  });
  try {
    const verdict = await session.activity(EVENT.START, activityType, {
      input: [stampSource(payload, "cursor")],
      spans: [span]
    });
    if (claim?.won) {
      publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? "" });
    }
    if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    if (claim?.won) {
      publishClaimDecision(claim, { arm: "block", reason: "[OpenBox] gate failed" });
    }
    throw err;
  }
}

// ts/src/runtime/cursor/mappers/mcp-response.ts
async function handleAfterMCPExecution(_env, _session, _cfg) {
  return void 0;
}

// ts/src/runtime/cursor/mappers/subagent.ts
async function handleSubagentStart(env, session, cfg) {
  const payload = buildSubagentStartPayload(env);
  const verdict = await session.activity(
    EVENT.START,
    SUBAGENT_START_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")] }
  );
  if (verdict.arm === "halt") markHalted(env.conversation_id, cfg);
  return verdict;
}

// ts/src/runtime/cursor/mappers/observe.ts
function handleAfterAgentResponse(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleAfterAgentThought(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleAfterShellExecution(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleAfterFileEdit(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
async function handleSessionStart(_env, session, _cfg) {
  try {
    await session.workflowStarted();
  } catch {
  }
  return void 0;
}
async function handleStop(env, session, cfg) {
  try {
    await session.workflowCompleted();
  } catch {
  }
  clearSession(env.conversation_id, cfg);
  return void 0;
}
async function handleSessionEnd(env, session, cfg) {
  try {
    await session.workflowCompleted();
  } catch {
  }
  clearSession(env.conversation_id, cfg);
  return void 0;
}
function handleAfterTabFileEdit(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handlePreCompact(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleSubagentStop(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}

// ts/src/runtime/cursor/hook-handler.ts
var hookLog = makeHookLog("cursor");
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
async function runCursorHook() {
  applyEnvSource();
  const cfg = loadConfig();
  createLogger("cursor").initLogger(cfg);
  if (!cfg.openboxApiKey) {
    if (cfg.verbose) console.error("[openbox cursor] no OPENBOX_API_KEY set, passing through");
    process.exit(0);
  }
  const dryRun = cfg.dryRun;
  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    timeoutMs: cfg.governanceTimeout * 1e3
  });
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1e3,
    36e5
  );
  let cachedAgentId;
  const resolveAgentId = async () => {
    if (cachedAgentId !== void 0) return cachedAgentId;
    try {
      const v = await core.validateApiKey();
      cachedAgentId = v?.agent_id;
    } catch {
      cachedAgentId = "";
    }
    return cachedAgentId || void 0;
  };
  let socketHandle;
  const ensureSocket = async () => {
    if (process.env.OPENBOX_DISABLE_APPROVAL_SOCKET === "1") return null;
    if (socketHandle !== void 0) return socketHandle;
    socketHandle = await connectApprovalSocket(cfg.approvalSocketPath ?? void 0);
    return socketHandle;
  };
  const OBSERVE_ONLY = /* @__PURE__ */ new Set([
    "afterAgentResponse",
    "afterAgentThought",
    "afterShellExecution",
    "afterFileEdit",
    "afterMCPExecution",
    "afterTabFileEdit",
    "postToolUse",
    "postToolUseFailure",
    "preCompact",
    "sessionStart",
    "sessionEnd",
    "stop",
    "subagentStop"
  ]);
  await createCursorAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    approvalMaxWaitMs,
    // When APPROVAL_MODE=inline, the SDK skips its internal poll loop
    // and the adapter renders permission:'ask' so Cursor's native
    // permission dialog pops in the IDE on every require_approval.
    // External approval clients such as the dashboard, mobile app,
    // or editor extension can still resolve the backend row, but the
    // hook does not wait.
    inlineApproval: cfg.approvalMode === "inline",
    onPendingApproval: async (info, env) => {
      if (OBSERVE_ONLY.has(String(env.hook_event_name ?? ""))) return;
      const conn = await ensureSocket();
      if (!conn) return;
      const agentId = await resolveAgentId();
      const toolSummary = env.tool_name ? `${env.tool_name}(${typeof env.tool_input === "string" ? env.tool_input : JSON.stringify(env.tool_input ?? {})})` : void 0;
      const summary = env.command ?? env.file_path ?? toolSummary ?? env.prompt ?? "";
      conn.notifyPending({
        governance_event_id: info.governanceEventId ?? info.approvalId,
        agent_id: agentId ?? "",
        hook_event_name: String(env.hook_event_name ?? ""),
        source: "cursor",
        summary: summary.slice(0, 200),
        reason: info.reason ?? "",
        expires_at: info.expiresAt ?? new Date(Date.now() + 30 * 6e4).toISOString()
      });
    },
    // Out-of-band decision channel. Returning a decision here makes
    // the SDK's pollApproval loop wake immediately and run one
    // confirmatory backend poll, instead of waiting for its next
    // exponential-backoff tick (default 500ms-5s). Approving in the
    // extension toast resolves the hook subprocess in O(1 poll RTT)
    // instead of O(poll-cycle).
    awaitExternalDecision: async (info, env) => {
      if (OBSERVE_ONLY.has(String(env.hook_event_name ?? ""))) return void 0;
      const conn = await ensureSocket();
      if (!conn) return void 0;
      const geid = info.governanceEventId ?? info.approvalId;
      const r = await conn.awaitDecision(geid, approvalMaxWaitMs);
      return r.kind === "decision" ? r.decision : void 0;
    },
    onApprovalResolved: () => {
      try {
        socketHandle?.close();
      } catch {
      }
    },
    handlers: {
      beforeSubmitPrompt: logged(
        "beforeSubmitPrompt",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeSubmitPrompt(env, s, cfg)
      ),
      beforeShellExecution: logged(
        "beforeShellExecution",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeShellExecution(env, s, cfg)
      ),
      beforeMCPExecution: logged(
        "beforeMCPExecution",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeMCPExecution(env, s, cfg)
      ),
      beforeReadFile: logged(
        "beforeReadFile",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeReadFile(env, s, cfg)
      ),
      preToolUse: logged(
        "preToolUse",
        "permission",
        async (env, s) => dryRun ? void 0 : handlePreToolUse(env, s, cfg)
      ),
      afterMCPExecution: logged(
        "afterMCPExecution",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterMCPExecution(env, s, cfg)
      ),
      afterAgentResponse: logged(
        "afterAgentResponse",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterAgentResponse(env, s, cfg)
      ),
      afterAgentThought: logged(
        "afterAgentThought",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterAgentThought(env, s, cfg)
      ),
      afterShellExecution: logged(
        "afterShellExecution",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterShellExecution(env, s, cfg)
      ),
      afterFileEdit: logged(
        "afterFileEdit",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterFileEdit(env, s, cfg)
      ),
      sessionStart: logged(
        "sessionStart",
        "none",
        async (env, s) => dryRun ? void 0 : handleSessionStart(env, s, cfg)
      ),
      stop: logged(
        "stop",
        "none",
        async (env, s) => dryRun ? void 0 : handleStop(env, s, cfg)
      ),
      // postToolUse / postToolUseFailure carry no payload per the
      // spec (@noPayload). We log them so the OutputChannel tail
      // shows the full lifecycle, but there's nothing to map.
      postToolUse: logged("postToolUse", "observe", async () => void 0),
      postToolUseFailure: logged("postToolUseFailure", "observe", async () => void 0),
      // Tab-driven + lifecycle + subagent coverage.
      beforeTabFileRead: logged(
        "beforeTabFileRead",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeTabFileRead(env, s, cfg)
      ),
      afterTabFileEdit: logged(
        "afterTabFileEdit",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterTabFileEdit(env, s, cfg)
      ),
      sessionEnd: logged(
        "sessionEnd",
        "none",
        async (env, s) => dryRun ? void 0 : handleSessionEnd(env, s, cfg)
      ),
      preCompact: logged(
        "preCompact",
        "observe",
        async (env, s) => dryRun ? void 0 : handlePreCompact(env, s, cfg)
      ),
      subagentStart: logged(
        "subagentStart",
        "permission",
        async (env, s) => dryRun ? void 0 : handleSubagentStart(env, s, cfg)
      ),
      subagentStop: logged(
        "subagentStop",
        "observe",
        async (env, s) => dryRun ? void 0 : handleSubagentStop(env, s, cfg)
      )
    }
  }).run();
}

// ts/src/runtime/cursor/install.ts
import fs8 from "fs";
import os4 from "os";
import path9 from "path";

// ts/src/runtime/cursor/plugin.ts
import {
  cpSync,
  existsSync as existsSync5,
  lstatSync,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync5,
  readdirSync as readdirSync2,
  rmSync,
  symlinkSync,
  writeFileSync as writeFileSync3
} from "fs";
import os3 from "os";
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
var EXPECTED_RULE_FILES = ["openbox.mdc"];
var EXPECTED_AGENT_FILES = ["openbox-reviewer.md"];
function cursorPluginTargetDir(cwd = process.cwd()) {
  return path8.join(cwd, ".cursor", "plugins", "local", "openbox");
}
function cursorRuntimeConfigDir(cwd = process.cwd()) {
  return path8.join(cwd, ".cursor-hooks");
}
function readJson(file) {
  try {
    return JSON.parse(readFileSync5(file, "utf-8"));
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
    if (existsSync5(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${label} in any of:
${candidates.map((c) => `  - ${c}`).join("\n")}`
  );
}
function findTemplateDir(kind) {
  return findExistingDir(`Cursor template directory '${kind}'`, [
    path8.resolve(__dirname, "templates", kind),
    path8.resolve(__dirname, "../runtime/cursor/templates", kind),
    path8.resolve(__dirname, "../../ts/src/runtime/cursor/templates", kind),
    path8.resolve(__dirname, "../../../ts/src/runtime/cursor/templates", kind),
    path8.resolve(process.cwd(), "ts/src/runtime/cursor/templates", kind)
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
  if (resolved === root || resolved === os3.homedir()) {
    throw new Error(`Refusing to overwrite unsafe plugin output path: ${resolved}`);
  }
  return resolved;
}
function assertProjectTarget(target, cwd) {
  const resolvedTarget = safeOutDir(target);
  const resolvedProject = path8.resolve(cwd);
  const rel = path8.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith("..") || path8.isAbsolute(rel)) {
    throw new Error(`Cursor plugin install target must be inside the project: ${resolvedProject}`);
  }
  return resolvedTarget;
}
function writeJson(file, value) {
  mkdirSync4(path8.dirname(file), { recursive: true });
  writeFileSync3(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
function writeRuntimeConfigTemplate(configDir) {
  mkdirSync4(configDir, { recursive: true });
  const file = path8.join(configDir, "config.json");
  if (existsSync5(file)) return;
  const example = {
    OPENBOX_API_KEY: "obx_live_YOUR_API_KEY_HERE",
    OPENBOX_CORE_URL: "https://core.example/ob",
    GOVERNANCE_POLICY: "fail_open",
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true
  };
  writeFileSync3(file, JSON.stringify(example, null, 2) + "\n", {
    mode: 384,
    encoding: "utf-8"
  });
}
function cursorHooksJson(matchers) {
  const hooks = {};
  for (const event of HOOK_SPEC.events) {
    const entry = { command: HOOK_SPEC.command };
    if (event.timeout !== void 0) entry.timeout = event.timeout;
    const matcher = matchers?.[event.name];
    if (matcher) entry.matcher = matcher;
    hooks[event.name] = [entry];
  }
  return { [HOOK_SPEC.key]: hooks };
}
function mcpJson() {
  return {
    mcpServers: {
      openbox: {
        command: "openbox",
        args: ["mcp", "serve"]
      }
    }
  };
}
function pluginManifest(version) {
  return {
    name: "openbox",
    displayName: "OpenBox AI Governance",
    version,
    description: "Active governance for AI coding agents in Cursor: policy gates, guardrails, approvals, MCP, slash commands, rules, and agent templates.",
    author: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    license: "MIT",
    keywords: [
      "openbox",
      "ai-governance",
      "guardrails",
      "policy",
      "opa",
      "approvals",
      "hitl",
      "agent-trace",
      "behavior-rules",
      "cursor",
      "skill",
      "mcp",
      "rules",
      "agents",
      "commands"
    ]
  };
}
function marketplaceManifest(version) {
  return {
    name: "openbox",
    owner: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    metadata: {
      description: "OpenBox governance bundle for Cursor: gates, approvals, slash commands, MCP server, rules, agent templates, and the OpenBox skill.",
      version
    },
    plugins: [
      {
        name: "openbox",
        source: ".",
        description: "Active governance for AI coding agents through pre-action gates, approval UI, agent-trace emission, slash commands, rules, and the OpenBox skill."
      }
    ]
  };
}
function copyDir(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync4(path8.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}
function exportCursorPlugin(options) {
  const out = safeOutDir(options.out);
  if (existsSync5(out)) {
    if (options.force === false) {
      throw new Error(`Cursor plugin output already exists: ${out}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync4(out, { recursive: true });
  const version = packageVersion();
  writeJson(path8.join(out, ".cursor-plugin", "plugin.json"), pluginManifest(version));
  writeJson(path8.join(out, ".cursor-plugin", "marketplace.json"), marketplaceManifest(version));
  copyDir(findSkillDir(), path8.join(out, "skills", "openbox"));
  copyDir(findTemplateDir("commands"), path8.join(out, "commands"));
  copyDir(findTemplateDir("rules"), path8.join(out, "rules"));
  copyDir(findTemplateDir("agents"), path8.join(out, "agents"));
  writeJson(path8.join(out, "hooks", "hooks.json"), cursorHooksJson(options.matchers));
  writeJson(path8.join(out, "mcp.json"), mcpJson());
  return out;
}
function installCursorPlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? cursorPluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir(options.symlink);
    if (!existsSync5(source)) {
      throw new Error(`Cursor plugin symlink source does not exist: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync4(path8.dirname(target), { recursive: true });
    symlinkSync(source, target, "dir");
    if (!options.skipRuntimeConfig) {
      writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
    }
    return target;
  }
  const out = exportCursorPlugin({
    out: target,
    matchers: options.matchers
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
  }
  return out;
}
function uninstallCursorPlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? cursorPluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
}
function checkFile(name, file) {
  return {
    name,
    status: existsSync5(file) ? "pass" : "fail",
    path: file,
    detail: existsSync5(file) ? "present" : "missing"
  };
}
function checkDirFiles(name, dir, expected) {
  if (!existsSync5(dir)) {
    return { name, status: "fail", path: dir, detail: "directory missing" };
  }
  const present = new Set(readdirSync2(dir).filter((file) => expected.includes(file)));
  const missing = expected.filter((file) => !present.has(file));
  return {
    name,
    status: missing.length === 0 ? "pass" : "fail",
    path: dir,
    detail: missing.length === 0 ? `${expected.length} file(s)` : `missing: ${missing.join(", ")}`
  };
}
function checkHooks(file) {
  const hooksJson = readJson(file);
  const hooks = hooksJson?.[HOOK_SPEC.key];
  const problems = [];
  if (!hooks || typeof hooks !== "object") {
    problems.push("hooks block missing");
  } else {
    for (const event of HOOK_SPEC.events) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0];
      if (entry.command !== HOOK_SPEC.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (event.timeout !== void 0 && entry.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(entry.timeout)} != ${event.timeout}`);
      }
    }
  }
  return {
    name: "plugin-hooks",
    status: problems.length === 0 ? "pass" : "fail",
    path: file,
    detail: problems.length === 0 ? `${HOOK_SPEC.events.length} event(s)` : problems.join("; ")
  };
}
function checkMcp(file) {
  const json = readJson(file);
  const openbox = json?.mcpServers?.openbox;
  const ok = openbox?.command === "openbox" && Array.isArray(openbox.args) && openbox.args[0] === "mcp" && openbox.args[1] === "serve";
  return {
    name: "plugin-mcp",
    status: ok ? "pass" : "fail",
    path: file,
    detail: ok ? "openbox mcp serve" : "openbox server entry missing or malformed"
  };
}
function verifyCursorPlugin(options = {}) {
  const target = safeOutDir(options.target ?? cursorPluginTargetDir(options.cwd));
  const checks = [];
  if (existsSync5(target)) {
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
  checks.push(checkFile("plugin-manifest", path8.join(target, ".cursor-plugin", "plugin.json")));
  checks.push(checkFile("plugin-marketplace", path8.join(target, ".cursor-plugin", "marketplace.json")));
  checks.push(checkFile("plugin-skill", path8.join(target, "skills", "openbox", "SKILL.md")));
  checks.push(checkDirFiles("plugin-commands", path8.join(target, "commands"), EXPECTED_COMMAND_FILES));
  checks.push(checkDirFiles("plugin-rules", path8.join(target, "rules"), EXPECTED_RULE_FILES));
  checks.push(checkDirFiles("plugin-agents", path8.join(target, "agents"), EXPECTED_AGENT_FILES));
  checks.push(checkHooks(path8.join(target, "hooks", "hooks.json")));
  checks.push(checkMcp(path8.join(target, "mcp.json")));
  return checks;
}

// ts/src/runtime/cursor/install.ts
function readJson2(file) {
  try {
    return JSON.parse(fs8.readFileSync(file, "utf-8"));
  } catch {
    return void 0;
  }
}
function userCursorPath(...parts) {
  return path9.join(os4.homedir(), ".cursor", ...parts);
}
function expectedExtensionVersion() {
  const candidates = [
    path9.resolve(process.cwd(), "apps/extension/package.json"),
    path9.resolve("apps/extension/package.json")
  ];
  for (const file of candidates) {
    const pkg = readJson2(file);
    const version = pkg?.version;
    if (typeof version === "string" && version) return version;
  }
  return void 0;
}
function checkExtensionInstall() {
  if (process.env.OPENBOX_SKIP_EXTENSION === "1") {
    return { name: "extension", status: "skip", detail: "OPENBOX_SKIP_EXTENSION=1" };
  }
  const dir = userCursorPath("extensions");
  if (!fs8.existsSync(dir)) {
    return { name: "extension", status: "fail", path: dir, detail: "directory missing" };
  }
  const entries = fs8.readdirSync(dir).filter((entry) => /^openbox\.openbox[-.]/.test(entry) || /^openbox[-.]/.test(entry));
  if (entries.length === 0) {
    return { name: "extension", status: "fail", path: dir, detail: "OpenBox extension missing" };
  }
  const expected = expectedExtensionVersion();
  for (const entry of entries) {
    const pkgFile = path9.join(dir, entry, "package.json");
    const pkg = readJson2(pkgFile);
    const actual = typeof pkg?.version === "string" ? pkg.version : void 0;
    if (!expected || actual === expected) {
      return {
        name: "extension",
        status: "pass",
        path: pkgFile,
        detail: `installed${actual ? ` ${actual}` : ""}; reload Cursor to verify loaded code`
      };
    }
  }
  return {
    name: "extension",
    status: "fail",
    path: dir,
    detail: expected ? `installed version does not match expected ${expected}` : "package version unreadable"
  };
}
function truthy(value) {
  return value === "true" || value === "1";
}
function isPlaceholderKey(value) {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}
function buildHookRuntimeEnv(cwd = process.cwd()) {
  const configDir = path9.join(cwd, ".cursor-hooks");
  const configFile = path9.join(configDir, "config.json");
  const envFile = path9.join(configDir, ".env");
  const values = {};
  const fill = (src) => {
    for (const [key, value] of Object.entries(src)) {
      if (process.env[key] !== void 0) values[key] = process.env[key];
      else if (values[key] === void 0) values[key] = value;
    }
  };
  fill(listConfig());
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key) => process.env[key] ?? values[key] ?? fileConfig[key] ?? envConfig[key];
  const connection = resolveConnection({
    apiUrl: get("OPENBOX_API_URL"),
    coreUrl: get("OPENBOX_CORE_URL"),
    platformUrl: get("OPENBOX_PLATFORM_URL")
  });
  const coreUrl = connection.coreUrl;
  const apiKey = get("OPENBOX_API_KEY") ?? "";
  return {
    configFile,
    envFile,
    cliConfigFile: configStorePath(),
    coreUrl,
    apiKey,
    dryRun: truthy(get("DRY_RUN"))
  };
}
async function checkRuntimeReadiness(cwd, validateRuntime) {
  const runtime = buildHookRuntimeEnv(cwd);
  const details = [
    `config=${runtime.configFile}`,
    `cliConfig=${runtime.cliConfigFile}`,
    `core=${runtime.coreUrl}`,
    `dryRun=${runtime.dryRun}`
  ];
  if (runtime.dryRun) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; DRY_RUN=true` };
  }
  if (!runtime.apiKey) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; missing OPENBOX_API_KEY` };
  }
  if (isPlaceholderKey(runtime.apiKey)) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; placeholder OPENBOX_API_KEY` };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; invalid OPENBOX_API_KEY format: ${format}` };
  }
  if (!validateRuntime) {
    return { name: "runtime", status: "pass", path: runtime.configFile, detail: `${details.join("; ")}; key=format-ok` };
  }
  try {
    const core = new OpenBoxCoreClient({
      apiKey: runtime.apiKey,
      apiUrl: runtime.coreUrl,
      timeoutMs: 5e3
    });
    const validation = await core.validateApiKey();
    const agent = validation?.agent_id ? `; agent=${validation.agent_id}` : "";
    return { name: "runtime", status: "pass", path: runtime.configFile, detail: `${details.join("; ")}; key=validated${agent}` };
  } catch (err) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; core validation failed: ${String(err?.message ?? err)}`
    };
  }
}
function verifyCursorInstall(opts = {}) {
  const checks = [
    ...verifyCursorPlugin({ cwd: opts.cwd, target: opts.pluginTarget })
  ];
  if (opts.includeExtension) checks.push(checkExtensionInstall());
  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [...checks, runtime]);
  }
  return checks;
}

// ts/src/runtime/cursor/index.ts
var HOOK_LOG_PATH = makeHookLog("cursor").path;
export {
  HOOK_LOG_PATH,
  createCursorAdapter,
  cursorPluginTargetDir,
  exportCursorPlugin,
  installCursorPlugin,
  runCursorHook,
  uninstallCursorPlugin,
  verifyCursorInstall,
  verifyCursorPlugin
};
