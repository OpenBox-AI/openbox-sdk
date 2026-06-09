import { Command } from 'commander';
import { output, error } from '../output.js';
import {
  setConfig,
  getConfig,
  unsetConfig,
  listConfig,
  configStorePath,
} from '../../config/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { reportAndExit } from '../../validators/index.js';

export function registerConfigCommands(program: Command) {
  const config = program
    .command('config')
    .description('Persistent CLI config (URL overrides, default flags)');

  config
    .command('set <key> <value>')
    .description('Persist a global config value, such as OPENBOX_API_URL or OPENBOX_CORE_URL')
    .action((key: string, value: string) => {
      try {
        const { scope } = setConfig(key, value);
        output({ scope, key, value, file: configStorePath() });
      } catch (err) {
        reportAndExit(err);
      }
    });

  config
    .command('get <key>')
    .description('Look up a previously-persisted global value')
    .action((key: string) => {
      const value = getConfig(key);
      if (value === undefined) {
        error(`no config value for ${key}`, {
          detail: `file: ${configStorePath()}`,
          help: `openbox config set ${key} <value>`,
        });
        bailWith(EXIT.NOT_FOUND);
      }
      output({ scope: 'global', key, value });
    });

  config
    .command('unset <key>')
    .description('Remove a config value (no-op if unset)')
    .action((key: string) => {
      try {
        const { scope, removed } = unsetConfig(key);
        output({ scope, key, removed });
      } catch (err) {
        reportAndExit(err);
      }
    });

  config
    .command('list')
    .description('Print persisted global values')
    .action(() => {
      output({
        scope: 'global',
        file: configStorePath(),
        values: listConfig(),
      });
    });
}
