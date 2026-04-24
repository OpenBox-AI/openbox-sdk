import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

const SKILL_REPO = 'https://github.com/OpenBox-AI/openbox-skill.git';
const MCP_REPO = 'https://github.com/OpenBox-AI/openbox-mcp-skunkworks.git';

export function registerSetupCommands(program: Command) {
  const setup = program.command('setup').description('Install OpenBox skill and MCP server');

  setup
    .command('skill')
    .description('Install OpenBox skill for Claude Code and/or Cursor')
    .option('--claude', 'Install for Claude Code')
    .option('--cursor', 'Install for Cursor')
    .action((opts) => {
      const targets: { name: string; dir: string }[] = [];
      if (opts.claude || (!opts.claude && !opts.cursor)) {
        targets.push({ name: 'Claude Code', dir: join(homedir(), '.claude', 'skills', 'openbox') });
      }
      if (opts.cursor || (!opts.claude && !opts.cursor)) {
        targets.push({ name: 'Cursor', dir: join(homedir(), '.cursor', 'skills', 'openbox') });
      }

      for (const t of targets) {
        if (existsSync(t.dir)) {
          console.error(`${t.name}: already installed at ${t.dir}`);
          try {
            execSync('git pull', { cwd: t.dir, stdio: 'inherit' });
          } catch {}
          continue;
        }
        console.error(`${t.name}: installing to ${t.dir}`);
        mkdirSync(resolve(t.dir, '..'), { recursive: true });
        execSync(`git clone ${SKILL_REPO} "${t.dir}"`, { stdio: 'inherit' });
      }
    });

  setup
    .command('mcp')
    .description('Install OpenBox MCP server and register in Cursor')
    .option('--dir <path>', 'Install directory', join(homedir(), 'workspace', 'openbox-mcp-skunkworks'))
    .action((opts) => {
      const dir = resolve(opts.dir);

      if (existsSync(dir)) {
        console.error(`MCP server already at ${dir}, updating...`);
        try {
          execSync('git pull && npm install && npm run build', { cwd: dir, stdio: 'inherit' });
        } catch {}
      } else {
        console.error(`Installing MCP server to ${dir}`);
        execSync(`git clone ${MCP_REPO} "${dir}" && cd "${dir}" && npm install && npm run build`, { stdio: 'inherit' });
      }

      // Register in Cursor mcp.json
      const mcpJsonPath = join(homedir(), '.cursor', 'mcp.json');
      let mcpConfig: any = { mcpServers: {} };
      if (existsSync(mcpJsonPath)) {
        try { mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8')); } catch {}
      }
      mcpConfig.mcpServers = mcpConfig.mcpServers || {};
      mcpConfig.mcpServers.openbox = {
        command: 'node',
        args: [join(dir, 'dist', 'index.js')],
      };
      mkdirSync(resolve(mcpJsonPath, '..'), { recursive: true });
      writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
      console.error(`Registered in ${mcpJsonPath}`);
    });

  setup
    .command('all')
    .description('Install skill + MCP server (flags forwarded to each subcommand)')
    .option('--claude', 'Install skill for Claude Code')
    .option('--cursor', 'Install skill for Cursor')
    .option('--dir <path>', 'MCP install directory', join(homedir(), 'workspace', 'openbox-mcp-skunkworks'))
    .action((opts) => {
      // Forward target flags so `setup all --cursor` doesn't silently install for every editor.
      const skillFlags: string[] = [];
      if (opts.claude) skillFlags.push('--claude');
      if (opts.cursor) skillFlags.push('--cursor');
      const mcpFlags = opts.dir ? ['--dir', opts.dir] : [];
      // Use spawnSync with argv array - no shell, so paths with $ or backticks
      // can't be interpolated. Using process.execPath + process.argv[1] lets
      // the child inherit the same node binary even under pnpm/yarn shims.
      const node = process.execPath;
      const bin = process.argv[1];
      const runSub = (args: string[]) => {
        const res = spawnSync(node, [bin, ...args], { stdio: 'inherit' });
        if (res.status !== 0) process.exit(res.status ?? 1);
      };
      runSub(['setup', 'skill', ...skillFlags]);
      runSub(['setup', 'mcp', ...mcpFlags]);
    });
}
