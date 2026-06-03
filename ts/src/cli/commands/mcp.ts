import { Command } from 'commander';

/**
 * `openbox mcp <subcommand>`; bridges the OpenBox SDK to MCP-compatible
 * LLM tools (Claude Desktop, Cursor, etc.). Today: just `serve` over
 * stdio. Future: `install` (writes the MCP config block into a tool's
 * settings file).
 */
export function registerMcpCommands(program: Command) {
  const mcp = program.command('mcp').description('OpenBox MCP server');

  mcp
    .command('serve')
    .description('Run the OpenBox MCP server over stdio (invoked by the LLM host, not the user directly)')
    .action(async () => {
      // Lazy-load so the CLI doesn't pay the @modelcontextprotocol/sdk
      // import cost on every invocation.
      const { runMcpServer } = await import('../../runtime/mcp/index.js');
      await runMcpServer();
    });
}
