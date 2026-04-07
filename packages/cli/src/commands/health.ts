import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';

export function registerHealthCommands(program: Command) {
  program
    .command('health')
    .description('Check API health')
    .action(async () => {
      try {
        const data = await getClient().health();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
