import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { reportAndExit } from '../validators/index.js';

export function registerHealthCommands(program: Command) {
  program
    .command('health')
    .description('Check API health')
    .action(async () => {
      try {
        const data = await getClient().health();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
