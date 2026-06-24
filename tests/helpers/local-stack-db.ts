import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { ColumnType, Generated } from 'kysely';

const { Pool } = pg;

type JsonColumn = ColumnType<unknown | null, unknown | null, unknown | null>;
type TimestampColumn = ColumnType<Date | null, Date | string | null, Date | string | null>;
type NumericColumn = ColumnType<string | number | bigint | null, number | bigint | null, number | bigint | null>;
type StringArrayColumn = ColumnType<string[] | null, string[] | null, string[] | null>;

interface SessionsTable {
  id: Generated<string>;
  agent_id: string;
  workflow_id: string;
  run_id: string;
  status: string;
  detail: string | null;
  started_at: TimestampColumn;
  completed_at: TimestampColumn;
  trust_evaluated_at: TimestampColumn;
  metadata: JsonColumn;
}

interface GovernanceEventsTable {
  id: Generated<string>;
  event_type: string;
  agent_id: string | null;
  session_id: string | null;
  workflow_id: string;
  run_id: string;
  workflow_type: string;
  task_queue: string;
  activity_id: string;
  activity_type: string;
  span_count: number;
  input: JsonColumn;
  output: JsonColumn;
  verdict: number | null;
  reason: string | null;
  decided_at: TimestampColumn;
  decided_by: string | null;
  metadata: JsonColumn;
  spans: JsonColumn;
  approval_expired_at: TimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

interface AgeEvaluationsTable {
  id: Generated<string>;
  agent_id: string;
  session_id: string;
  governance_event_id: string;
  semantic_type: string;
  goal_alignment_checked: boolean;
  goal_drift: boolean;
  goal_alignment_detail: string | null;
  behavior_violated: boolean;
  behavior_compliance_detail: string | null;
  trust_score: number | null;
  trust_tier: number | null;
  behavioral_compliance: number | null;
  alignment_consistency: number | null;
  evaluated_at: TimestampColumn;
}

interface ApiKeysTable {
  key_prefix: string;
  permissions: StringArrayColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  deleted_at: TimestampColumn;
}

interface OrganizationAuditLogsTable {
  id: Generated<string>;
  organization_id: string;
  event_type: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  resource_type: string;
  result: string;
  details: JsonColumn;
  created_at: TimestampColumn;
}

interface ObservabilityIssuesTable {
  id: Generated<string>;
  agent_id: string;
  session_id: string | null;
  governance_event_id: string | null;
  issue_type: string;
  severity: string;
  title: string;
  source_tool: string | null;
  source_workflow_id: string | null;
}

interface ObservabilityMetricsTable {
  id: Generated<string>;
  agent_id: string | null;
  organization_id: string | null;
  bucket_time: TimestampColumn;
  metric_type: string;
  metric_key: string;
  metric_value: NumericColumn;
}

interface PolicyEvaluationsTable {
  id: Generated<string>;
  policy_id: string;
  governance_event_id: string;
  input: JsonColumn;
  output: JsonColumn;
  evaluation_result: string;
  evaluation_details: JsonColumn;
  slug: string;
}

interface GuardrailsEvaluationsTable {
  id: Generated<string>;
  guardrails_id: string;
  governance_event_id: string;
  guardrails_type: string;
  input: string;
  output: string;
  passed: boolean;
  details: JsonColumn;
  status: string;
}

interface AgentTrustScoresHistoryTable {
  id: Generated<string>;
  agent_id: string;
  trust_score: number;
  trust_tier: number;
  previous_score: number | null;
  previous_tier: number | null;
  change_type: string;
  change_reason: string;
  evaluated_by: string;
}

interface TrustRuleTriggersTable {
  id: Generated<string>;
  agent_id: string;
  session_id: string;
  rule_type: string;
  rule_name: string;
  verdict: number;
}

interface TrustPenaltiesTable {
  id: Generated<string>;
  agent_id: string;
  session_id: string;
  trust_impact: string;
  penalty_amount: number;
  component: string;
  trust_rule_trigger_id: string;
}

interface LocalStackDatabase {
  age_evaluations: AgeEvaluationsTable;
  agent_trust_scores_history: AgentTrustScoresHistoryTable;
  api_keys: ApiKeysTable;
  guardrails_evaluations: GuardrailsEvaluationsTable;
  governance_events: GovernanceEventsTable;
  observability_issues: ObservabilityIssuesTable;
  observability_metrics: ObservabilityMetricsTable;
  organization_audit_logs: OrganizationAuditLogsTable;
  policy_evaluations: PolicyEvaluationsTable;
  sessions: SessionsTable;
  trust_penalties: TrustPenaltiesTable;
  trust_rule_triggers: TrustRuleTriggersTable;
}

export interface LocalStackUsageMetricRow {
  metricType: string;
  metricKey: string;
  metricValue: number;
}

const USAGE_METRIC_KEYS = [
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'cost_usd',
] as const;

export interface LocalStackSessionSeed {
  id: string;
  workflowId: string;
  runId: string;
}

export interface LocalStackGovernanceEventSeed {
  id: string;
  sessionId?: string | null;
}

export interface SeedLocalStackSessionOptions {
  agentId: string;
  workflowIdPrefix: string;
  runIdPrefix: string;
  status?: string;
  detail: string;
  startedAt?: Date;
  completedAt?: Date | null;
  trustEvaluatedAt?: Date | null;
  metadata?: unknown;
}

export interface SeedLocalStackGovernanceEventOptions {
  agentId: string;
  session?: Pick<LocalStackSessionSeed, 'id' | 'workflowId' | 'runId'>;
  workflowId?: string;
  runId?: string;
  workflowIdPrefix?: string;
  runIdPrefix?: string;
  eventType?: string;
  workflowType?: string;
  taskQueue?: string;
  activityId: string;
  activityType: string;
  spanCount?: number;
  input?: unknown;
  output?: unknown;
  verdict?: number | null;
  reason?: string | null;
  metadata?: unknown;
  approvalExpiredAt?: Date | null;
  decidedAt?: Date | null;
  decidedBy?: string | null;
}

export interface SeedLocalStackAgeEvaluationOptions {
  agentId: string;
  sessionId: string;
  governanceEventId: string;
  semanticType: string;
  goalAlignmentChecked?: boolean;
  goalDrift?: boolean;
  goalAlignmentDetail?: string | null;
  behaviorViolated?: boolean;
  behaviorComplianceDetail?: string | null;
  trustScore?: number | null;
  trustTier?: number | null;
  behavioralCompliance?: number | null;
  alignmentConsistency?: number | null;
  evaluatedAt?: Date;
}

export interface SeedLocalStackTrustLedgerOptions {
  agentId: string;
  source: string;
}

const localStackDb = new Kysely<LocalStackDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: process.env.OPENBOX_E2E_POSTGRES_HOST ?? '127.0.0.1',
      port: Number(process.env.OPENBOX_E2E_POSTGRES_PORT ?? 5432),
      database: process.env.OPENBOX_E2E_POSTGRES_DATABASE ?? 'openbox',
      user: process.env.OPENBOX_E2E_POSTGRES_USER ?? 'postgres',
      password: process.env.OPENBOX_E2E_POSTGRES_PASSWORD ?? 'password',
      max: 4,
      allowExitOnIdle: true,
    }),
  }),
});

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function prefixedId(prefix: string): string {
  return `${prefix}${randomUUID()}`;
}

function jsonDbValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export async function seedLocalStackSession(
  options: SeedLocalStackSessionOptions,
): Promise<LocalStackSessionSeed> {
  const workflowId = prefixedId(options.workflowIdPrefix);
  const runId = prefixedId(options.runIdPrefix);
  const row = await localStackDb
    .insertInto('sessions')
    .values({
      agent_id: options.agentId,
      workflow_id: workflowId,
      run_id: runId,
      status: options.status ?? 'completed',
      detail: options.detail,
      started_at: options.startedAt ?? minutesFromNow(-2),
      completed_at: options.completedAt === undefined ? minutesFromNow(-1) : options.completedAt,
      trust_evaluated_at: options.trustEvaluatedAt === undefined ? new Date() : options.trustEvaluatedAt,
      metadata: jsonDbValue(options.metadata ?? { openbox_conformance: true }),
    })
    .returning(['id', 'workflow_id as workflowId', 'run_id as runId'])
    .executeTakeFirstOrThrow();

  return row;
}

export async function seedLocalStackGovernanceEvent(
  options: SeedLocalStackGovernanceEventOptions,
): Promise<LocalStackGovernanceEventSeed> {
  const workflowId = options.session?.workflowId ??
    options.workflowId ??
    prefixedId(options.workflowIdPrefix ?? 'governance-wf-');
  const runId = options.session?.runId ??
    options.runId ??
    prefixedId(options.runIdPrefix ?? 'governance-run-');
  const row = await localStackDb
    .insertInto('governance_events')
    .values({
      event_type: options.eventType ?? 'ActivityCompleted',
      agent_id: options.agentId,
      session_id: options.session?.id ?? null,
      workflow_id: workflowId,
      run_id: runId,
      workflow_type: options.workflowType ?? 'sdk-conformance',
      task_queue: options.taskQueue ?? 'local-stack',
      activity_id: options.activityId,
      activity_type: options.activityType,
      span_count: options.spanCount ?? 1,
      input: jsonDbValue(options.input ?? []),
      output: jsonDbValue(options.output ?? {}),
      verdict: options.verdict ?? null,
      reason: options.reason ?? null,
      approval_expired_at: options.approvalExpiredAt ?? null,
      decided_at: options.decidedAt ?? null,
      decided_by: options.decidedBy ?? null,
      metadata: jsonDbValue(options.metadata ?? { openbox_conformance: true }),
    })
    .returning(['id', 'session_id as sessionId'])
    .executeTakeFirstOrThrow();

  return row;
}

export async function seedLocalStackAgeEvaluation(
  options: SeedLocalStackAgeEvaluationOptions,
): Promise<string> {
  const row = await localStackDb
    .insertInto('age_evaluations')
    .values({
      agent_id: options.agentId,
      session_id: options.sessionId,
      governance_event_id: options.governanceEventId,
      semantic_type: options.semanticType,
      goal_alignment_checked: options.goalAlignmentChecked ?? true,
      goal_drift: options.goalDrift ?? false,
      goal_alignment_detail: options.goalAlignmentDetail ?? null,
      behavior_violated: options.behaviorViolated ?? false,
      behavior_compliance_detail: options.behaviorComplianceDetail ?? null,
      trust_score: options.trustScore ?? null,
      trust_tier: options.trustTier ?? null,
      behavioral_compliance: options.behavioralCompliance ?? null,
      alignment_consistency: options.alignmentConsistency ?? null,
      evaluated_at: options.evaluatedAt ?? new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

export async function seedLocalStackAuditLog(options: {
  organizationId: string;
  eventType: string;
  actorId: string;
  actorName: string;
  action: string;
  resourceType: string;
  result: string;
  details?: unknown;
  createdAt?: Date;
}): Promise<string> {
  const row = await localStackDb
    .insertInto('organization_audit_logs')
    .values({
      organization_id: options.organizationId,
      event_type: options.eventType,
      actor_id: options.actorId,
      actor_name: options.actorName,
      action: options.action,
      resource_type: options.resourceType,
      result: options.result,
      details: jsonDbValue(options.details ?? {}),
      created_at: options.createdAt ?? new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function deleteLocalStackAuditLog(logId: string): Promise<void> {
  await localStackDb
    .deleteFrom('organization_audit_logs')
    .where('id', '=', logId)
    .execute();
}

export async function readLatestLocalStackApiKeyPermissions(
  keyPrefix: string,
): Promise<string[]> {
  const row = await localStackDb
    .selectFrom('api_keys')
    .select('permissions')
    .where('key_prefix', '=', keyPrefix)
    .where('deleted_at', 'is', null)
    .orderBy('created_at desc')
    .executeTakeFirst();
  return row?.permissions ?? [];
}

export async function setLatestLocalStackApiKeyPermissions(
  keyPrefix: string,
  permissions: readonly string[],
): Promise<void> {
  await localStackDb
    .updateTable('api_keys')
    .set({
      permissions: [...permissions],
      updated_at: new Date(),
    })
    .where('key_prefix', '=', keyPrefix)
    .where('deleted_at', 'is', null)
    .execute();
}

export async function grantTemporaryLocalStackApiKeyPermissions<T>(
  apiKey: string,
  permissions: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keyPrefix = apiKey.slice(0, 12);
  const original = await readLatestLocalStackApiKeyPermissions(keyPrefix);
  const merged = [...new Set([...original, ...permissions])];
  await setLatestLocalStackApiKeyPermissions(keyPrefix, merged);
  try {
    return await fn();
  } finally {
    await setLatestLocalStackApiKeyPermissions(keyPrefix, original);
  }
}

export async function seedLocalStackObservabilityIssue(options: {
  agentId: string;
  sessionId: string;
  governanceEventId: string;
  issueType: string;
  severity: string;
  title: string;
  sourceTool?: string | null;
  sourceWorkflowId?: string | null;
}): Promise<string> {
  const row = await localStackDb
    .insertInto('observability_issues')
    .values({
      agent_id: options.agentId,
      session_id: options.sessionId,
      governance_event_id: options.governanceEventId,
      issue_type: options.issueType,
      severity: options.severity,
      title: options.title,
      source_tool: options.sourceTool ?? null,
      source_workflow_id: options.sourceWorkflowId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function seedLocalStackObservabilityMetric(options: {
  agentId: string;
  organizationId: string;
  metricType: string;
  metricKey: string;
  metricValue: number;
}): Promise<string> {
  const row = await localStackDb
    .insertInto('observability_metrics')
    .values({
      agent_id: options.agentId,
      organization_id: options.organizationId,
      bucket_time: new Date(),
      metric_type: options.metricType,
      metric_key: options.metricKey,
      metric_value: options.metricValue,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function seedLocalStackPolicyEvaluation(options: {
  policyId: string;
  governanceEventId: string;
  input: unknown;
  output: unknown;
  evaluationResult: string;
  evaluationDetails: unknown;
  slug: string;
}): Promise<string> {
  const row = await localStackDb
    .insertInto('policy_evaluations')
    .values({
      policy_id: options.policyId,
      governance_event_id: options.governanceEventId,
      input: jsonDbValue(options.input),
      output: jsonDbValue(options.output),
      evaluation_result: options.evaluationResult,
      evaluation_details: jsonDbValue(options.evaluationDetails),
      slug: options.slug,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function seedLocalStackGuardrailEvaluation(options: {
  guardrailId: string;
  governanceEventId: string;
  guardrailType: string;
  input: string;
  output: string;
  passed: boolean;
  details: unknown;
  status: string;
}): Promise<string> {
  const row = await localStackDb
    .insertInto('guardrails_evaluations')
    .values({
      guardrails_id: options.guardrailId,
      governance_event_id: options.governanceEventId,
      guardrails_type: options.guardrailType,
      input: options.input,
      output: options.output,
      passed: options.passed,
      details: jsonDbValue(options.details),
      status: options.status,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function seedLocalStackTrustLedger(
  options: SeedLocalStackTrustLedgerOptions,
): Promise<{ historyId: string; penaltyId: string }> {
  const session = await seedLocalStackSession({
    agentId: options.agentId,
    workflowIdPrefix: 'trust-ledger-wf-',
    runIdPrefix: 'trust-ledger-run-',
    detail: 'trust ledger conformance',
    metadata: { openbox_conformance: true, source: options.source },
  });
  const history = await localStackDb
    .insertInto('agent_trust_scores_history')
    .values({
      agent_id: options.agentId,
      trust_score: 72.5,
      trust_tier: 2,
      previous_score: 86.0,
      previous_tier: 1,
      change_type: 'policy_violation',
      change_reason: 'trust ledger conformance',
      evaluated_by: 'sdk-e2e',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const trigger = await localStackDb
    .insertInto('trust_rule_triggers')
    .values({
      agent_id: options.agentId,
      session_id: session.id,
      rule_type: 'policy',
      rule_name: 'trust ledger conformance rule',
      verdict: 1,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const penalty = await localStackDb
    .insertInto('trust_penalties')
    .values({
      agent_id: options.agentId,
      session_id: session.id,
      trust_impact: 'medium',
      penalty_amount: 7.5,
      component: 'policy',
      trust_rule_trigger_id: trigger.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { historyId: history.id, penaltyId: penalty.id };
}

function jsonText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export async function readGovernanceEventStorageText(eventId: string): Promise<string> {
  const row = await localStackDb
    .selectFrom('governance_events')
    .select(['input', 'output', 'metadata'])
    .where('id', '=', eventId)
    .executeTakeFirst();

  return [
    jsonText(row?.input),
    '---OUTPUT---',
    jsonText(row?.output),
    '---META---',
    jsonText(row?.metadata),
  ].join('\n');
}

export async function readGovernanceEventInputAndSpansText(eventId: string): Promise<string> {
  const row = await localStackDb
    .selectFrom('governance_events')
    .select(['input', 'spans'])
    .where('id', '=', eventId)
    .executeTakeFirst();

  return [
    jsonText(row?.input),
    '---SPANS---',
    jsonText(row?.spans),
  ].join('\n');
}

export async function listUsageMetricRowsForValues(
  agentId: string,
  metricValues: readonly number[],
): Promise<LocalStackUsageMetricRow[]> {
  const rows = await localStackDb
    .selectFrom('observability_metrics')
    .select([
      'metric_type as metricType',
      'metric_key as metricKey',
      'metric_value as metricValue',
    ])
    .where('agent_id', '=', agentId)
    .where('metric_key', 'in', USAGE_METRIC_KEYS)
    .where('metric_value', 'in', metricValues)
    .orderBy('metric_type')
    .orderBy('metric_key')
    .execute();

  return rows.map((row) => ({
    metricType: row.metricType,
    metricKey: row.metricKey,
    metricValue: Number(row.metricValue),
  }));
}

export async function listUsageMetricRowsForKeys(
  agentId: string,
): Promise<LocalStackUsageMetricRow[]> {
  const rows = await localStackDb
    .selectFrom('observability_metrics')
    .select([
      'metric_type as metricType',
      'metric_key as metricKey',
      'metric_value as metricValue',
    ])
    .where('agent_id', '=', agentId)
    .where('metric_key', 'in', USAGE_METRIC_KEYS)
    .orderBy('metric_type')
    .orderBy('metric_key')
    .execute();

  return rows.map((row) => ({
    metricType: row.metricType,
    metricKey: row.metricKey,
    metricValue: Number(row.metricValue),
  }));
}

export async function expireGovernanceApproval(eventId: string): Promise<string> {
  const row = await localStackDb
    .updateTable('governance_events')
    .set({
      approval_expired_at: new Date(Date.now() - 60_000),
      updated_at: new Date(),
    })
    .where('id', '=', eventId)
    .returning('id')
    .executeTakeFirst();

  return row?.id ?? '';
}
