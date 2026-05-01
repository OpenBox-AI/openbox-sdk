#!/usr/bin/env node
// Spec-drift detector. Compares specs/typespec/ (compiled to
// specs/generated/openapi3/Openbox{Backend,Core}.json) against:
//   - prod/staging deployed swagger endpoints (via curl)
//   - upstream OpenBox-AI/openbox-{backend,core}@<branch> via gh CLI
//     (path-only; both repos lack runtime openapi export today)
//
// Subcommands:
//   fetch --tier <prod|staging|develop|main> --service <backend|core>
//     Resolves the upstream OpenAPI for the (tier, service) pair and
//     writes it to /tmp/upstream-<service>-<tier>.json. Tier+service
//     combinations that do not exist emit a "skip" marker file. Core
//     has no swagger anywhere, so prod and staging are unsupported.
//
//   diff --tier <...> --service <...>
//     Reads the fetched upstream + the local TypeSpec emit, produces a
//     markdown report at /tmp/spec-drift-<service>-<tier>.md, prints
//     `has_drift=true|false` to GITHUB_OUTPUT (or stdout when run
//     locally), exits 0 either way (drift is reported, not failed).

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { resolve } from 'node:path';

const SERVICES = new Set(['backend', 'core']);
const TIERS = new Set(['prod', 'staging', 'develop', 'main']);

const args = parseArgs(argv.slice(2));
const cmd = args._[0];
if (!cmd || !['fetch', 'diff'].includes(cmd)) usage(`unknown subcommand: ${cmd ?? '(missing)'}`);
if (!SERVICES.has(args.service)) usage(`--service must be one of: ${[...SERVICES].join(', ')}`);
if (!TIERS.has(args.tier)) usage(`--tier must be one of: ${[...TIERS].join(', ')}`);

if (cmd === 'fetch') doFetch(args.service, args.tier);
else if (cmd === 'diff') doDiff(args.service, args.tier);

// ---------------------------------------------------------------------------

function doFetch(service, tier) {
  const out = `/tmp/upstream-${service}-${tier}.json`;

  // Core has no swagger endpoint anywhere; prod/staging tiers skip,
  // develop/main go through the upstream path-regex parser.
  if (service === 'core' && (tier === 'prod' || tier === 'staging')) {
    return writeSkip(out, `core does not expose a swagger endpoint on ${tier}`);
  }

  if (tier === 'prod') {
    const url =
      service === 'backend'
        ? 'https://api.openbox.ai/api/docs-json'
        : null; // unreachable; guarded above
    fetchSwagger(url, out);
    return;
  }

  if (tier === 'staging') {
    const base = env.OPENBOX_STAGING_API_URL;
    if (!base) {
      return writeSkip(out, 'OPENBOX_STAGING_API_URL not set in env');
    }
    fetchSwagger(`${base.replace(/\/$/, '')}/api/docs-json`, out);
    return;
  }

  // develop / main → upstream repo path parse via gh API
  if (tier === 'develop' || tier === 'main') {
    const repo = `OpenBox-AI/openbox-${service}`;
    const branch = tier;
    const paths = parseUpstreamRoutes(repo, branch, service);
    writeFileSync(out, JSON.stringify({ _source: { repo, branch }, paths }, null, 2));
    return;
  }
}

function fetchSwagger(url, outPath) {
  try {
    const body = execSync(`curl -fsS "${url}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    JSON.parse(body); // sanity
    writeFileSync(outPath, body);
  } catch (err) {
    stderr.write(`fetch failed: ${url}\n${err.message}\n`);
    exit(1);
  }
}

function parseUpstreamRoutes(repo, branch, service) {
  // Path-level coverage only: enumerate route declarations and
  // reconstruct {verb, path} tuples. Schema-level diff would require
  // building each upstream and dumping its OpenAPI; deferred until a
  // path-only miss actually bites.
  if (service === 'core') {
    // Echo route table; main.go has lines like:
    //   routesAPI.GET("/auth/validate", ...)
    const main = ghRead(repo, branch, 'internal/api/main.go');
    const routes = [];
    for (const m of main.matchAll(/routesAPI\.(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"/g)) {
      routes.push({ verb: m[1].toLowerCase(), path: `/api/v1${m[2]}` });
    }
    // Health check at root; registered separately via r.GET("/", ...)
    if (/r\.GET\("\/"/.test(main)) routes.push({ verb: 'get', path: '/' });
    return routes;
  }

  if (service === 'backend') {
    // NestJS; controller files use @Get/@Post/@Patch/@Put/@Delete.
    // List the controllers, fetch each, regex out route segments.
    const tree = ghTree(repo, branch, 'src/modules');
    const controllers = tree.filter((f) => /\.controller\.ts$/.test(f) && !/\.spec\./.test(f));
    const routes = [];
    for (const ctrl of controllers) {
      const src = ghRead(repo, branch, ctrl);
      // @Controller('foo') -> base segment
      const baseMatch = src.match(/@Controller\(\s*['"]([^'"]*)['"]\s*\)/);
      const base = baseMatch ? `/${baseMatch[1].replace(/^\//, '')}` : '';
      // @Get('bar') / @Post() / etc.
      for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"]([^'"]*)['"])?\s*\)/g)) {
        const verb = m[1].toLowerCase();
        const sub = m[2] ?? '';
        const path = normalizePath(`${base}/${sub}`).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
        routes.push({ verb, path });
      }
    }
    return routes;
  }
}

function ghRead(repo, branch, path) {
  // GitHub returns base64-encoded file content; --jq .content gives the
  // raw base64 string with embedded newlines that we must strip before
  // decoding.
  const b64 = execSync(
    `gh api "repos/${repo}/contents/${path}?ref=${branch}" --jq .content`,
    { encoding: 'utf8' },
  ).replace(/\s+/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function ghTree(repo, branch, prefix) {
  // List every path in the repo at branch tip and filter by prefix.
  // The /git/trees endpoint returns up to 100k entries; comfortable
  // headroom for src/modules.
  const sha = execSync(`gh api "repos/${repo}/commits/${branch}" --jq .sha`, {
    encoding: 'utf8',
  }).trim();
  const lines = execSync(
    `gh api "repos/${repo}/git/trees/${sha}?recursive=1" --jq '.tree[].path'`,
    { encoding: 'utf8' },
  );
  const norm = prefix.replace(/\/$/, '') + '/';
  return lines
    .trim()
    .split('\n')
    .filter((p) => p.startsWith(norm));
}

function normalizePath(p) {
  return ('/' + p).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// ---------------------------------------------------------------------------

function doDiff(service, tier) {
  const upstreamPath = `/tmp/upstream-${service}-${tier}.json`;
  const outPath = `/tmp/spec-drift-${service}-${tier}.md`;
  if (!existsSync(upstreamPath)) {
    writeFileSync(outPath, `# Spec drift; ${service}@${tier}\n\nfetch step did not run\n`);
    setOutput('has_drift', 'false');
    return;
  }

  const upstream = JSON.parse(readFileSync(upstreamPath, 'utf8'));
  if (upstream._skip) {
    writeFileSync(outPath, `# Spec drift; ${service}@${tier}\n\nskipped: ${upstream._skip}\n`);
    setOutput('has_drift', 'false');
    return;
  }

  const ours = readEmittedSpec(service);
  const upPaths = enumeratePaths(upstream);
  const ourPaths = enumeratePaths(ours);

  const inUpNotOurs = [...upPaths].filter((p) => !ourPaths.has(p)).sort();
  const inOursNotUp = [...ourPaths].filter((p) => !upPaths.has(p)).sort();
  const drift = inUpNotOurs.length + inOursNotUp.length;

  const report = renderReport(service, tier, upstream, inUpNotOurs, inOursNotUp);
  writeFileSync(outPath, report);
  setOutput('has_drift', drift > 0 ? 'true' : 'false');

  // Also print the report to stdout for local runs.
  stdout.write(report);
}

function readEmittedSpec(service) {
  const cap = service === 'backend' ? 'OpenboxBackend' : 'OpenboxCore';
  const p = resolve(process.cwd(), `specs/generated/openapi3/${cap}.json`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function enumeratePaths(spec) {
  const set = new Set();
  // Two shapes: (1) full OpenAPI doc with `paths: { '/foo': { get: {...} } }`
  // (2) our regex-parse output `paths: [{ verb, path }]`
  if (Array.isArray(spec.paths)) {
    for (const r of spec.paths) set.add(`${r.verb.toUpperCase()} ${r.path}`);
    return set;
  }
  for (const [path, verbs] of Object.entries(spec.paths ?? {})) {
    for (const v of Object.keys(verbs)) {
      if (v === 'parameters') continue;
      set.add(`${v.toUpperCase()} ${path}`);
    }
  }
  return set;
}

function renderReport(service, tier, upstream, addedUp, addedOur) {
  const lines = [`# Spec drift; ${service}@${tier}`, ''];
  if (upstream._source) {
    lines.push(`Upstream source: \`${upstream._source.repo}@${upstream._source.branch}\``, '');
  }

  if (addedUp.length === 0 && addedOur.length === 0) {
    lines.push(`✅ in sync; TypeSpec and ${service}@${tier} agree on every path.`);
    return lines.join('\n') + '\n';
  }

  if (addedUp.length > 0) {
    lines.push(`## Paths in ${service}@${tier} but missing from TypeSpec (${addedUp.length})`);
    lines.push('');
    for (const p of addedUp) lines.push(`- \`${p}\``);
    lines.push('');
  }

  if (addedOur.length > 0) {
    lines.push(`## Paths in TypeSpec but missing from ${service}@${tier} (${addedOur.length})`);
    lines.push('');
    for (const p of addedOur) lines.push(`- \`${p}\``);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------

function writeSkip(outPath, reason) {
  writeFileSync(outPath, JSON.stringify({ _skip: reason }, null, 2));
}

function setOutput(key, value) {
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
  } else {
    stdout.write(`${key}=${value}\n`);
  }
}

function parseArgs(rest) {
  const out = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = rest[i + 1];
      i++;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function usage(msg) {
  if (msg) stderr.write(`error: ${msg}\n\n`);
  stderr.write(
    'usage:\n' +
      '  scripts/spec-drift.mjs fetch --service <backend|core> --tier <prod|staging|develop|main>\n' +
      '  scripts/spec-drift.mjs diff  --service <backend|core> --tier <prod|staging|develop|main>\n',
  );
  exit(1);
}
