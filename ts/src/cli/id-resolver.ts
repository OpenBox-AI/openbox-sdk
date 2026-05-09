// Short-ID resolution. Lets users / LLMs pass a partial UUID prefix
// (e.g., `2e6cee17` or `2e6cee17-...`) and have it resolved to the
// full ID before any backend call. The backend doesn't support
// partial lookups; without this, every truncated value 404s.
//
// Both the CLI (wireSubcommands, wireRecipes) and the MCP server's
// recipe-tools share the resolver via a name-keyed map: a positional
// arg called `agentId` is resolved through `client.listAgents`, etc.
// New resource types are a 5-line addition (entry in RESOLVER_MAP).
//
// The resolver is a no-op for fully-formed UUIDs: the regex check
// short-circuits before any HTTP traffic. Cost is paid only when the
// caller actually shortened.

const FULL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Looks like a partial UUID": at least 4 leading hex chars,
// optionally followed by dash-separated hex segments. Catches real
// truncated IDs like `2e6cee17`, `2e6cee17-6302`, `2e6cee17-6302-…`,
// while excluding obvious non-UUIDs like test strings (`bad`, `a1`,
// `bogus`, `agent-1`). The lower bound (4) keeps the resolver from
// firing on noise — real users pasting from `agent list` always
// have at least the first segment.
const UUID_PREFIX_RE = /^[0-9a-f]{4,}(-[0-9a-f]+)*[-…]*\.{0,3}$/i;

export function isFullUuid(value: unknown): boolean {
  return typeof value === 'string' && FULL_UUID_RE.test(value);
}

export function looksLikeUuidPrefix(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (FULL_UUID_RE.test(value)) return false; // full UUID is not a "prefix"
  return UUID_PREFIX_RE.test(value);
}

/** Strip common truncation markers people paste from terminal output:
 *    `2e6cee17-...`        → `2e6cee17-`
 *    `2e6cee17-6302-...`   → `2e6cee17-6302-`
 *    trailing dash, ellipsis, whitespace.
 *  Empty result throws so the caller errors with a clear message
 *  instead of asking the backend for "everything that starts with ''". */
function normalisePrefix(input: string): string {
  const stripped = input.replace(/[\s.…]+$/g, '').replace(/-+$/g, '');
  if (!stripped) {
    throw new Error(`cannot resolve empty id prefix from '${input}'`);
  }
  return stripped;
}

type ListMethod = (
  ...a: unknown[]
) => Promise<unknown>;
type ClientLike = Record<string, ListMethod>;

interface ResolverConfig {
  /** Method on the client that returns the list of candidates. */
  listMethod: string;
  /** Positional args to pass to the list method, in order, before
   *  the pagination opts object. Some lists are scoped (e.g.,
   *  listTeams takes orgId), some aren't. */
  scopeArgs?: ReadonlyArray<string>;
  /** Field on each row that holds the canonical ID. */
  idField: string;
  /** Human-readable resource name for error messages. */
  resourceName: string;
}

/** Map from positional-arg name (as declared in `@cli_command` /
 *  `@cli_recipe` op signatures) to the resolution config. Adding a
 *  new resource type is a single entry here. */
const RESOLVER_MAP: Record<string, ResolverConfig> = {
  agentId: {
    listMethod: 'listAgents',
    idField: 'id',
    resourceName: 'agent',
  },
  // teamId would need orgId in scope; defer until we have a recipe
  // that exercises it. Same for sessionId (needs agentId).
};

/** Walk all pages of the list method, collecting every row. Cap at
 *  10 pages of 100 to bound the worst case (org with thousands of
 *  agents); the prefix should narrow within the first page anyway. */
async function fetchAllRows(
  client: ClientLike,
  cfg: ResolverConfig,
  scopePositional: ReadonlyArray<unknown>,
): Promise<unknown[] | null> {
  const fn = client[cfg.listMethod];
  // Some surfaces (CoreClient for `core overview`, mocked clients in
  // unit tests) legitimately don't carry the list method. Return null
  // so resolveOne short-circuits to pass-through instead of failing
  // — the caller's intent was "resolve if you can, otherwise let
  // the backend handle it" anyway.
  if (typeof fn !== 'function') return null;
  const all: unknown[] = [];
  for (let page = 0; page < 10; page++) {
    const resp = (await fn.apply(client, [
      ...scopePositional,
      { page, perPage: 100 },
    ])) as { data?: unknown[]; total?: number } | unknown[];
    const rows = Array.isArray(resp)
      ? resp
      : (resp.data as unknown[] | undefined) ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    const total =
      !Array.isArray(resp) && typeof resp.total === 'number'
        ? resp.total
        : undefined;
    if (typeof total === 'number' && all.length >= total) break;
  }
  return all;
}

/** Resolve a single arg by name. Returns the full ID, OR the input
 *  unchanged when:
 *    - it's already a full UUID
 *    - the arg name has no resolver entry
 *    - the value isn't a string */
export async function resolveOne(
  argName: string,
  value: unknown,
  client: ClientLike,
  argMap: Record<string, unknown>,
): Promise<unknown> {
  if (typeof value !== 'string') return value;
  if (isFullUuid(value)) return value;
  // Only fire the resolver when the value looks UUID-prefix-shaped.
  // Anything else (test stubs, garbage, names) passes through; if
  // the backend rejects it, the user gets the original error not
  // a noisy "no agent matching X" from this layer.
  if (!looksLikeUuidPrefix(value)) return value;
  const cfg = RESOLVER_MAP[argName];
  if (!cfg) return value;

  const prefix = normalisePrefix(value);
  // If the prefix happens to be a full UUID after normalisation,
  // skip the lookup.
  if (isFullUuid(prefix)) return prefix;

  const scopePositional = (cfg.scopeArgs ?? []).map((n) => argMap[n]);
  const rows = await fetchAllRows(client, cfg, scopePositional);
  // Client doesn't carry the list method (CoreClient, mocked tests).
  // Pass through; backend will 404 if the prefix is invalid, matching
  // pre-resolver behavior.
  if (rows === null) return value;
  const matches = rows.filter((row) => {
    const id = (row as Record<string, unknown>)[cfg.idField];
    return typeof id === 'string' && id.startsWith(prefix);
  });
  if (matches.length === 1) {
    return (matches[0] as Record<string, unknown>)[cfg.idField] as string;
  }
  if (matches.length === 0) {
    throw new Error(
      `no ${cfg.resourceName} with id starting with '${prefix}'. ` +
        `Run \`openbox --experimental ${cfg.resourceName} list\` to see available ids.`,
    );
  }
  const sample = matches
    .slice(0, 5)
    .map((m) => (m as Record<string, unknown>)[cfg.idField] as string)
    .join(', ');
  throw new Error(
    `ambiguous ${cfg.resourceName} prefix '${prefix}': matches ${matches.length} ${cfg.resourceName}s (${sample}${matches.length > 5 ? ', …' : ''}). Type more characters to disambiguate.`,
  );
}

/** Resolve every entry in `argMap` whose name appears in
 *  RESOLVER_MAP. Idempotent for full-UUID values (no HTTP calls).
 *  Returns a NEW map; doesn't mutate the input. Used by both
 *  wireSubcommands (CLI) and runRecipe (CLI + MCP) so all surfaces
 *  share the same resolution semantics. */
export async function resolveArgs(
  argMap: Record<string, unknown>,
  client: ClientLike,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...argMap };
  // Walk in two passes: first the args that don't depend on scope
  // (no scopeArgs), then the args that do. Lets `agentId` resolve
  // before a future `sessionId` that scopes by agent.
  const names = Object.keys(argMap);
  const ordered = [
    ...names.filter((n) => !(RESOLVER_MAP[n]?.scopeArgs ?? []).length),
    ...names.filter((n) => (RESOLVER_MAP[n]?.scopeArgs ?? []).length > 0),
  ];
  for (const name of ordered) {
    out[name] = await resolveOne(name, out[name], client, out);
  }
  return out;
}
