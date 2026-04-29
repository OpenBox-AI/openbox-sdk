// Spec-driven CLI subcommand wiring. Hand-coded `register*Commands`
// files load the matching handlers manifest from
// `cli/generated/cli-handlers/<cmd>.ts` and pass it through here, plus
// a getClient resolver. Every detail (positional args, flags,
// validators, body-key remap, --json escape, output renderer) comes
// from the spec - adding a new subcommand is a spec edit.

import type { Command } from 'commander';
import { output, outputList } from './output.js';
import { parseJsonInput } from '../validators/index.js';
import {
  reportAndExit,
  validateEnum,
  validateIsoDate,
  validateUuidList,
  parsePagination,
  warn,
  block,
  validateBehaviorTrigger,
  validateBehaviorStates,
  validateVerdict,
  validateInt,
  validateApprovalTimeout,
  validateGuardrailType,
  validateStage,
  validateGuardrailParams,
  validateActivitiesConfig,
  validateRegoSource,
} from '../validators/index.js';
import type { OpenBoxClient } from '../client/index.js';

export interface FlagSpec {
  /** TypeSpec parameter name (camelCase). */
  name: string;
  /** Long flag form (kebab-case). */
  long: string;
  short?: string;
  description: string;
  env?: string;
  bodyKey?: string;
  parse?: 'int' | 'json' | 'csv' | 'bool';
  choices?: ReadonlyArray<string>;
  default?: string;
  validator?: string;
  /** Variadic (Commander `<v...>`). Value type is string[]. */
  variadic?: boolean;
  /** Emit `requiredOption` instead of `option`. */
  required?: boolean;
  /** Boolean-typed param - Commander option without `<value>` placeholder. */
  noArg?: boolean;
}

export interface ArgSpec {
  /** Positional arg name in camelCase. */
  name: string;
  /** When set, this positional's *value* is routed into the body under
   *  this key instead of being passed as a positional client arg.
   *  Used for hybrid call shapes like `decideApproval(agentId, eventId,
   *  {action})` - agentId/eventId stay positional, action goes in body. */
  bodyKey?: string;
  /** Restrict the positional to a fixed set of values (validateEnum).
   *  Same semantics as @cli_choice on flags. */
  choices?: ReadonlyArray<string>;
  /** Run a named validator on the positional value before forwarding. */
  validator?: string;
}

export interface SubcommandSpec {
  /** Subcommand verb (kebab-case). */
  name: string;
  description: string;
  args: ArgSpec[];
  flags: FlagSpec[];
  backend: {
    /** Method on OpenBoxClient. */
    method: string;
    /** "positional" - positional spec params + flag values all go positional;
     *  "body"       - positional spec params go positional, flags merge into a body object. */
    shape: 'positional' | 'body';
  };
  /** Adds -p / --page + -l / --limit and merges via parsePagination. */
  pagination: boolean;
  /** When set, the action accepts a `--json <body>` flag - the parsed
   *  JSON becomes the body base, then per-flag values fill missing
   *  keys ("fill") / are ignored ("replace") / are absent because
   *  --json is required and exhaustive ("only"). @cli_required flags
   *  are checked against the merged body, not commander.requiredOption. */
  jsonMerge?: 'fill' | 'replace' | 'only';
  /** Cross-field constraint: at least one of these param names must
   *  end up in the merged body. */
  atLeastOne?: ReadonlyArray<string>;
  /** Cross-field constraint: if any of these param names is in the
   *  merged body, ALL must be. Bypassed when --json was supplied. */
  requiredTogether?: ReadonlyArray<string>;
  /** True when the op never calls the backend/core - declared in spec
   *  via @cli_local_only. The action body for these is pure local
   *  state and lives hand-coded in commands/<x>.ts (this entry just
   *  carries the marker for drift tests). */
  localOnly?: boolean;
  /** Name of a registered preflight callback (PREFLIGHT_REGISTRY)
   *  that runs before the main call with (body, getClient). */
  preflight?: string;
  /** Spec-declared DTO defaults - merged into the body for keys not
   *  filled by --json or flag values. */
  dtoDefaults?: unknown;
  /** Names of post-validate callbacks (POST_VALIDATE_REGISTRY) that
   *  run after body assembly and before the call. */
  postValidate?: ReadonlyArray<string>;
  output: {
    kind: 'table' | 'list' | 'json' | 'kv' | 'binary' | 'custom';
    label?: string;
    /** Dotted path into the response - renderer pulls this sub-value
     *  instead of the full envelope. */
    pluck?: string;
    /** Name of a registered post-output callback. */
    post?: string;
  };
}

const VALIDATOR_REGISTRY: Record<string, (val: unknown, label: string) => unknown> = {
  validateIsoDate,
  validateUuidList,
};

/**
 * Post-output callbacks runnable via @cli_output_post(name). Each
 * receives the original response (pre-pluck) and writes any side-effect
 * banner the spec asks for. Add a callback here when you spec a new
 * post hook - the spec tells the runtime *which* to call by name; the
 * body lives here so the spec stays language-agnostic.
 */
export const OUTPUT_POST_REGISTRY: Record<string, (data: unknown) => void> = {
  /** Highlight the runtime API key returned by `agent create` and
   *  `api-key rotate` to stderr. The wire returns the obx_live_/
   *  obx_test_ token under `token` (sometimes nested under `agent`);
   *  we surface it once because subsequent fetches won't see it. */
  highlightRuntimeKey(data: unknown): void {
    const d = data as { token?: string; agent?: { id?: string } } | null;
    const key = d?.token;
    if (typeof key !== 'string' || (!key.startsWith('obx_live_') && !key.startsWith('obx_test_'))) return;
    const agentId = d?.agent?.id ?? '<id>';
    console.error('');
    console.error('────────────────────────────────────────────────────────────');
    console.error('  Runtime API key (capture now - only shown once):');
    console.error(`    ${key}`);
    console.error('');
    console.error('  Use this as OPENBOX_API_KEY for core/governance calls.');
    console.error(`  To recover later: openbox api-key rotate ${agentId}`);
    console.error('  (rotation invalidates the previous key).');
    console.error('────────────────────────────────────────────────────────────');
  },

  /** Log the org-approvals response's `metrics` envelope to stderr. The
   *  spec already plucks the `approvals` sub-object for rendering; this
   *  callback surfaces the metrics that were dropped. */
  logApprovalMetrics(data: unknown): void {
    const m = (data as { metrics?: unknown } | null)?.metrics;
    if (m) console.error(`metrics: ${JSON.stringify(m)}`);
  },

  /** Highlight a webhook's signing secret (one-time display) after a
   *  rotate. Mirrors highlightRuntimeKey but for the `secret` field. */
  highlightWebhookSecret(data: unknown): void {
    const secret = (data as { secret?: string } | null)?.secret;
    if (typeof secret !== 'string') return;
    console.error('');
    console.error('────────────────────────────────────────────────────────────');
    console.error('  New webhook signing secret (capture now - shown once):');
    console.error(`    ${secret}`);
    console.error('────────────────────────────────────────────────────────────');
  },
};

function getPath(env: unknown, path: string): unknown {
  if (env == null || typeof env !== 'object') return undefined;
  let cur: unknown = env;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Preflight callbacks named by @cli_preflight. Each receives the
 *  assembled body + the client resolver and may issue HTTP calls,
 *  mutate the body in place, or throw to block the main call. */
export const PREFLIGHT_REGISTRY: Record<
  string,
  (body: Record<string, unknown>, getClient: ClientResolver) => Promise<void>
> = {
  /** `agent create` preflight: verify each --team UUID resolves in the
   *  caller's org and warn on agent-name collisions. Skipped when the
   *  user passes --skip-preflight (set on the body via spec) - they
   *  own the failure mode in that case. */
  async agentCreatePreflight(body, getClient) {
    if (body.skipPreflight) {
      // Strip the marker so it doesn't leak into the wire.
      delete body.skipPreflight;
      return;
    }
    const client = getClient() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const teams = (body.team_ids as string[] | undefined) ?? [];
    let orgId: string | undefined;
    try {
      const profile = (await client.getProfile()) as Record<string, unknown>;
      orgId =
        (profile.orgId as string | undefined) ??
        (profile.org_id as string | undefined) ??
        ((profile.user as { orgId?: string })?.orgId);
    } catch {
      warn('Pre-flight getProfile() failed - skipping team existence check. Pass --skip-preflight to silence this.');
    }
    if (orgId) {
      for (const teamId of teams) {
        try {
          await client.getTeam(orgId, teamId);
        } catch (e) {
          const status = (e as { status?: number; response?: { status?: number } }).status ??
            (e as { response?: { status?: number } }).response?.status;
          if (status === 404 || status === 403) {
            block(
              'team-not-found',
              `Team ${teamId} does not exist or you lack access in org ${orgId}. Creating the agent now would orphan it (403 on every subsequent call).`,
              `List accessible teams: \`openbox team list ${orgId}\`. Use --skip-preflight only if you're sure the team exists and this check is mis-reporting.`,
            );
          }
          warn(`Pre-flight GET /team/${teamId} failed (${(e as Error).message}). Continuing; the create will fail if the team is missing.`);
        }
      }
    }
    try {
      const existing = (await client.listAgents({ search: body.agent_name as string })) as { data?: unknown };
      const rows = existing?.data ?? existing;
      const arr = Array.isArray(rows) ? rows : ((rows as { data?: unknown[] })?.data ?? []);
      if ((arr as { agent_name: string }[]).some((a) => a.agent_name === body.agent_name)) {
        warn(`An agent named "${body.agent_name}" already exists in this org. The backend may accept duplicate names, but subsequent lookups by name will be ambiguous. Consider a unique name.`);
      }
    } catch { /* non-fatal */ }
  },
};

/** Post-validate callbacks named by @cli_post_validate. Run AFTER
 *  body assembly, BEFORE the main call. Throw to block. */
export const POST_VALIDATE_REGISTRY: Record<string, (body: Record<string, unknown>) => void> = {
  /** behavior create/update body cross-field check: when verdict is
   *  REQUIRE_APPROVAL (2), approval_timeout must be set. */
  behaviorRuleCrossField(body) {
    if (body.trigger != null) validateBehaviorTrigger(body.trigger);
    if (body.states != null) validateBehaviorStates(body.states);
    if (body.verdict != null) validateVerdict(body.verdict);
    if (body.priority != null) validateInt(body.priority, 'priority', { min: 1, max: 100 });
    if (body.time_window != null) validateInt(body.time_window, 'time_window', { min: 1 });
    if (body.verdict != null) validateApprovalTimeout(Number(body.verdict), body.approval_timeout);
    if (body.trust_impact != null) {
      validateEnum(body.trust_impact, ['none', 'low', 'medium', 'high'] as const, 'trust_impact');
    }
  },

  /** guardrail create/update body validation: type + stage + params shape. */
  guardrailCrossField(body) {
    if (body.guardrail_type != null) {
      body.guardrail_type = validateGuardrailType(body.guardrail_type);
    }
    if (body.processing_stage != null) {
      body.processing_stage = validateStage(body.processing_stage);
    }
    if (body.guardrail_type) {
      validateGuardrailParams(body.guardrail_type as string, body.params);
    }
    if ((body.settings as { activities?: unknown })?.activities && body.processing_stage) {
      validateActivitiesConfig(
        (body.settings as { activities: unknown }).activities,
        body.processing_stage as '0' | '1',
      );
    }
    if (body.trust_impact != null) {
      validateEnum(body.trust_impact, ['none', 'low', 'medium', 'high'] as const, '--trust-impact');
    }
  },

  /** policy create body validation: rego source linter. */
  policyCrossField(body) {
    if (typeof body.rego_code === 'string') validateRegoSource(body.rego_code);
    if (body.trust_impact != null) {
      validateEnum(body.trust_impact, ['none', 'low', 'medium', 'high'] as const, '--trust-impact');
    }
    if (body.trust_threshold != null) {
      body.trust_threshold = validateInt(body.trust_threshold, '--trust-threshold', { min: 0, max: 100 });
    }
  },
};

async function runPreflight(
  name: string,
  body: Record<string, unknown>,
  getClient: ClientResolver,
): Promise<void> {
  const fn = PREFLIGHT_REGISTRY[name];
  if (!fn) throw new Error(`preflight callback '${name}' not registered`);
  await fn(body, getClient);
}

function runPostValidate(name: string, body: Record<string, unknown>): void {
  const fn = POST_VALIDATE_REGISTRY[name];
  if (!fn) throw new Error(`post-validate callback '${name}' not registered`);
  fn(body);
}

/** Deep-merge `defaults` into `target` only for keys `target` doesn't
 *  already have. Recurses into nested objects so a partial AIVSS
 *  override doesn't lose unrelated default sub-fields. */
function mergeDefaults(target: Record<string, unknown>, defaults: unknown): void {
  if (!defaults || typeof defaults !== 'object') return;
  for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) {
    if (target[k] === undefined || target[k] === null) {
      target[k] = v;
    } else if (
      typeof target[k] === 'object' &&
      target[k] !== null &&
      !Array.isArray(target[k]) &&
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v)
    ) {
      mergeDefaults(target[k] as Record<string, unknown>, v);
    }
  }
}

/** Apply all spec-derived per-flag transforms (parse, choices, validator)
 *  in declaration order. Returns the coerced value or the original. */
function transformFlag(raw: unknown, flag: FlagSpec): unknown {
  if (raw === undefined || raw === null) return raw;
  let value: unknown = raw;
  // Choices run on the *raw string* before any parse - coerced
  // booleans wouldn't equal the spec's "true"/"false" string literals.
  if (flag.choices && flag.choices.length > 0) {
    value = validateEnum(value, flag.choices, `--${flag.long}`);
  }
  if (flag.parse === 'int') {
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`--${flag.long} must be an integer. Got: ${JSON.stringify(value)}`);
    }
    value = n;
  } else if (flag.parse === 'json') {
    value = parseJsonInput(String(value));
  } else if (flag.parse === 'csv') {
    value = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  } else if (flag.parse === 'bool') {
    const s = String(value).toLowerCase();
    value = s === 'true' ? true : s === 'false' ? false : value;
  }
  if (flag.validator) {
    const fn = VALIDATOR_REGISTRY[flag.validator];
    if (fn) value = fn(value, `--${flag.long}`);
  }
  return value;
}

/** Build the body object the backend method receives. Skips undefined
 *  flags (so the wire shape isn't polluted with explicit nulls).
 *
 *  When `sub.jsonMerge` is set, the `--json <body>` flag's parsed value
 *  is the base; flag values fill missing keys (mode "fill") or are
 *  ignored if --json was provided (mode "replace"). */
function buildBody(opts: Record<string, unknown>, sub: SubcommandSpec): Record<string, unknown> {
  let body: Record<string, unknown> = {};
  let jsonProvided = false;
  if (sub.jsonMerge && typeof opts.json === 'string' && opts.json) {
    try {
      const parsed = JSON.parse(opts.json) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') body = { ...parsed };
      jsonProvided = true;
    } catch (e) {
      throw new Error(`--json: ${(e as Error).message}`);
    }
  }
  if (sub.pagination) {
    Object.assign(body, parsePagination(opts as { page?: unknown; limit?: unknown }));
  }
  for (const flag of sub.flags) {
    if (sub.jsonMerge && flag.name === 'json') continue; // handled above
    let val = transformFlag(opts[flag.name], flag);
    // Variadic flags with no command-line value default to []. Wire
    // shapes that include the field (e.g. createUser body's `roles`)
    // expect an array, not an absent key.
    if (val === undefined && flag.variadic) val = [];
    if (val === undefined || val === null || val === '') continue;
    const key = flag.bodyKey ?? flag.name;
    // jsonMerge "replace"/"only": flag values ignored when --json provided.
    if (jsonProvided && sub.jsonMerge && sub.jsonMerge !== 'fill') continue;
    // jsonMerge "fill": only fill missing keys, don't override --json.
    if (jsonProvided && sub.jsonMerge === 'fill' && key in body) continue;
    body[key] = val;
  }
  // DTO defaults (@cli_dto_defaults) - fill keys flags didn't supply.
  // Skip when --json was provided: the user is opting into a complete
  // DTO and shouldn't get hidden defaults injected mid-body.
  if (sub.dtoDefaults && !jsonProvided) mergeDefaults(body, sub.dtoDefaults);

  // Cross-field "if any then all" check (@cli_required_together).
  // Bypassed when --json was supplied - the user opts into a complete
  // DTO and we trust them.
  if (
    !jsonProvided &&
    sub.requiredTogether &&
    sub.requiredTogether.length > 0
  ) {
    const present = sub.requiredTogether.filter((name) => {
      const flag = sub.flags.find((f) => f.name === name);
      const key = flag?.bodyKey ?? name;
      const v = body[key];
      return v !== undefined && v !== null && v !== '';
    });
    if (present.length > 0 && present.length < sub.requiredTogether.length) {
      const missing = sub.requiredTogether.filter((n) => !present.includes(n));
      const missingFlags = missing
        .map((n) => '--' + (sub.flags.find((f) => f.name === n)?.long ?? n))
        .join(', ');
      throw new Error(
        `partial config: ${missingFlags} also required (or pass --json with full body)`,
      );
    }
  }

  // Cross-field at-least-one check (@cli_at_least_one).
  if (sub.atLeastOne && sub.atLeastOne.length > 0) {
    const present = sub.atLeastOne.some((name) => {
      const flag = sub.flags.find((f) => f.name === name);
      const key = flag?.bodyKey ?? name;
      const v = body[key];
      return v !== undefined && v !== null && v !== '';
    });
    if (!present) {
      const flagList = sub.atLeastOne
        .map((n) => '--' + (sub.flags.find((f) => f.name === n)?.long ?? n))
        .join(' / ');
      throw new Error(`at least one of ${flagList} is required`);
    }
  }

  // Required-in-body check: when jsonMerge is on, @cli_required flags
  // mean "must be present in the merged body". Validate now.
  if (sub.jsonMerge) {
    const missing: string[] = [];
    for (const flag of sub.flags) {
      if (!flag.required) continue;
      if (flag.name === 'json') continue;
      // Variadic flags arrive as undefined when not set, [] when empty.
      // Treat both as missing.
      const key = flag.bodyKey ?? flag.name;
      if (!(key in body) || body[key] === undefined || body[key] === null || body[key] === '') {
        missing.push(`--${flag.long} (or "${key}" in --json)`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`missing required field(s): ${missing.join(', ')}`);
    }
  }
  return body;
}

function renderOutput(data: unknown, sub: SubcommandSpec): void {
  // Pluck happens before rendering - the original response is still
  // forwarded to the post callback (so it sees fields the renderer
  // didn't display, e.g. metrics envelopes).
  const renderable = sub.output.pluck ? getPath(data, sub.output.pluck) : data;
  switch (sub.output.kind) {
    case 'list':
      outputList(renderable, sub.output.label ?? 'items');
      break;
    case 'binary':
      // Binary payload - pass through as-is. Strings go to stdout
      // unmodified; Buffers/Uint8Arrays write their bytes.
      if (typeof renderable === 'string') {
        process.stdout.write(renderable);
      } else if (renderable instanceof Uint8Array) {
        process.stdout.write(renderable);
      } else {
        // Fallback for objects (e.g. wrapped {data: bytes}); JSON-dump.
        output(renderable);
      }
      break;
    case 'table':
    case 'kv':
    case 'json':
    default:
      output(renderable);
  }
  if (sub.output.post) {
    const fn = OUTPUT_POST_REGISTRY[sub.output.post];
    if (fn) fn(data);
  }
}

function attachFlags(cmd: Command, sub: SubcommandSpec): void {
  if (sub.pagination) {
    cmd.option('-p, --page <n>', 'Page number', '0');
    cmd.option('-l, --limit <n>', 'Items per page', '10');
  }
  for (const flag of sub.flags) {
    // When jsonMerge is on the runtime auto-adds --json; skip the
    // spec-declared one to avoid commander duplicate-option errors.
    if (sub.jsonMerge && flag.name === 'json') continue;
    const dots = flag.variadic ? '...' : '';
    const placeholder = flag.noArg ? '' : ` <${flag.long.replace(/-/g, '_')}${dots}>`;
    const flagSig = flag.short
      ? `-${flag.short}, --${flag.long}${placeholder}`
      : `--${flag.long}${placeholder}`;
    // When jsonMerge is on, the runtime checks required-in-body after
    // merging, so commander's hard requiredOption would block --json-only
    // calls. Defer the check.
    if (flag.required && !sub.jsonMerge) {
      cmd.requiredOption(flagSig, flag.description);
    } else if (flag.default !== undefined) {
      cmd.option(flagSig, flag.description, flag.default);
    } else {
      cmd.option(flagSig, flag.description);
    }
  }
  if (sub.jsonMerge) {
    if (sub.jsonMerge === 'only') {
      cmd.requiredOption('--json <json>', 'Full JSON body (required).');
    } else {
      cmd.option('--json <json>', 'Full JSON body - flag values fill missing keys.');
    }
  }
}

export type ClientResolver = () => Pick<OpenBoxClient, never> & Record<string, (...a: unknown[]) => Promise<unknown>>;

/** Wire a list of spec-driven subcommands onto a Commander parent. */
export function wireSubcommands(
  parent: Command,
  specs: readonly SubcommandSpec[],
  getClient: ClientResolver,
): void {
  for (const sub of specs) {
    if (sub.output.kind === 'custom') continue; // hand-coded action elsewhere
    const argSig = sub.args.map((a) => `<${a.name}>`).join(' ');
    const cmd = parent
      .command(argSig ? `${sub.name} ${argSig}` : sub.name)
      .description(sub.description);
    attachFlags(cmd, sub);

    cmd.action(async (...rawArgs: unknown[]) => {
      try {
        // Commander hands the action: <positional1> <positional2> ... <opts> <command>.
        // We slice off positionals based on declared arg count.
        const positionalValues = rawArgs.slice(0, sub.args.length);
        const opts = (rawArgs[sub.args.length] ?? {}) as Record<string, unknown>;
        const client = getClient() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const fn = client[sub.backend.method];
        if (typeof fn !== 'function') {
          throw new Error(`Backend method '${sub.backend.method}' missing on OpenBoxClient`);
        }

        // Positional-with-body-key: argument is captured positionally on
        // the command line, but the value is forwarded into the body
        // object instead of as a positional client arg. Lets us spec
        // hybrid wire signatures like decideApproval(a, e, {action}).
        const clientPositionals: unknown[] = [];
        const bodyFromArgs: Record<string, unknown> = {};
        for (let i = 0; i < sub.args.length; i++) {
          const arg = sub.args[i];
          let value = positionalValues[i];
          if (arg.choices && arg.choices.length > 0) {
            value = validateEnum(value, arg.choices, `<${arg.name}>`);
          }
          if (arg.validator) {
            const fn = VALIDATOR_REGISTRY[arg.validator];
            if (fn) value = fn(value, `<${arg.name}>`);
          }
          if (arg.bodyKey) {
            bodyFromArgs[arg.bodyKey] = value;
          } else {
            clientPositionals.push(value);
          }
        }

        let data: unknown;
        if (sub.backend.shape === 'positional') {
          const trailingArgs = sub.flags.map((f) => transformFlag(opts[f.name], f));
          // Positional shape: run preflight/post-validate over the
          // arg list as a synthetic body so the spec contract still
          // applies (rare but symmetric).
          const synthBody = Object.fromEntries(
            sub.flags.map((f, i) => [f.bodyKey ?? f.name, trailingArgs[i]]),
          ) as Record<string, unknown>;
          if (sub.preflight) await runPreflight(sub.preflight, synthBody, getClient);
          if (sub.postValidate) for (const v of sub.postValidate) runPostValidate(v, synthBody);
          data = await fn.apply(client, [...clientPositionals, ...trailingArgs]);
        } else {
          const body = { ...bodyFromArgs, ...buildBody(opts, sub) };
          if (sub.preflight) await runPreflight(sub.preflight, body, getClient);
          if (sub.postValidate) for (const v of sub.postValidate) runPostValidate(v, body);
          data = await fn.apply(client, [...clientPositionals, body]);
        }
        renderOutput(data, sub);
      } catch (err) {
        reportAndExit(err);
      }
    });
  }
}
