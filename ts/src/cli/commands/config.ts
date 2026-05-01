// `openbox config`; persistent KV store for CLI defaults. Two scopes:
// global (file lines `<KEY>=<value>`) and per-env (`<env>.<KEY>=<value>`).
// `--global` selects global; otherwise the active --env (or
// $OPENBOX_ENV) is the scope. Some keys are inherently global .
// OPENBOX_ENV, OPENBOX_HOME, OPENBOX_CLIENT_VARIANT,
// OPENBOX_EXPERIMENTAL_LEVEL; and auto-promote regardless of flags;
// the response surfaces `scope_promoted: true` so the user knows.
import { Command } from 'commander';
import { resolveEnv } from '../../env/index.js';
import { output } from '../output.js';
import {
  setConfig,
  getConfig,
  unsetConfig,
  listConfig,
  configStorePath,
  effectiveScope,
  GLOBAL_ONLY_KEYS,
  type Scope,
} from '../config-store.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { reportAndExit } from '../../validators/index.js';

function pickScope(opts: { global?: boolean }): Scope {
  return opts.global ? 'global' : resolveEnv();
}

function describeScope(s: Scope): string {
  return s === 'global' ? 'global (all envs)' : s;
}

export function registerConfigCommands(program: Command) {
  const config = program
    .command('config')
    .description('Persistent CLI config (URL overrides, default flags)');

  config
    .command('set <key> <value>')
    .description(
      'Persist a config value. By default scopes to the active --env, ' +
        'so OPENBOX_API_URL would apply to staging only. Pass --global ' +
        'to apply across every env, useful for keys like ' +
        'OPENBOX_CLIENT_VARIANT. Always-global keys auto-promote: ' +
        Array.from(GLOBAL_ONLY_KEYS).join(', ') +
        '.',
    )
    .option('-g, --global', 'Store globally across all envs.')
    .action((key: string, value: string, opts: { global?: boolean }) => {
      try {
        const requested = pickScope(opts);
        const { scope, purged } = setConfig(requested, key, value);
        const promoted = scope !== requested;
        output({
          scope: describeScope(scope),
          key,
          value,
          file: configStorePath(),
          ...(promoted
            ? { scope_promoted: true, note: `${key} is always global; --env was ignored.` }
            : {}),
          ...(purged > 0
            ? { purged_stale_env_scoped: purged, note_legacy: `Removed ${purged} stale per-env entr${purged === 1 ? 'y' : 'ies'} for ${key}.` }
            : {}),
        });
      } catch (err) {
        reportAndExit(err);
      }
    });

  config
    .command('get <key>')
    .description(
      'Look up a previously-persisted value. Resolves global-only keys ' +
        'globally; everything else from the active --env. Exits 5 if absent.',
    )
    .option('-g, --global', 'Read from global scope (across all envs).')
    .action((key: string, opts: { global?: boolean }) => {
      const requested = pickScope(opts);
      const scope = effectiveScope(requested, key);
      const value = getConfig(scope, key);
      if (value === undefined) {
        bailWith(
          EXIT.NOT_FOUND,
          `No config value for ${describeScope(scope)} / ${key}.\n` +
            `  File: ${configStorePath()}\n` +
            `  Set via: openbox ${scope === 'global' ? 'config set --global' : `--env ${scope} config set`} ${key} <value>`,
        );
      }
      output({ scope: describeScope(scope), key, value });
    });

  config
    .command('unset <key>')
    .description("Remove a config value. No-op if it wasn't set.")
    .option('-g, --global', 'Operate on global scope.')
    .action((key: string, opts: { global?: boolean }) => {
      try {
        const requested = pickScope(opts);
        const { scope, removed } = unsetConfig(requested, key);
        output({ scope: describeScope(scope), key, removed });
      } catch (err) {
        reportAndExit(err);
      }
    });

  config
    .command('list')
    .description(
      'Print persisted values. Default lists per-env (--env). With --global, ' +
        'lists global-scope values. With --all, prints both sections.',
    )
    .option('-g, --global', 'List global-scope values only.')
    .option('--all', 'List both global and per-env values.')
    .action((opts: { global?: boolean; all?: boolean }) => {
      const env = resolveEnv();
      if (opts.all) {
        output({
          file: configStorePath(),
          global: listConfig('global'),
          [env]: listConfig(env),
        });
        return;
      }
      const scope: Scope = opts.global ? 'global' : env;
      output({
        scope: describeScope(scope),
        file: configStorePath(),
        values: listConfig(scope),
      });
    });
}
