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
    .description('Run the OpenBox MCP server over stdio or Streamable HTTP')
    .option('--transport <transport>', 'Transport: stdio or http', 'stdio')
    .option('--host <host>', 'Host for Streamable HTTP transport', '127.0.0.1')
    .option('--port <port>', 'Port for Streamable HTTP transport', (value) => Number.parseInt(value, 10), 3927)
    .action(async (opts: { transport?: string; host?: string; port?: number }) => {
      if (opts.transport !== undefined && opts.transport !== 'stdio' && opts.transport !== 'http') {
        console.error('Invalid MCP transport. Expected "stdio" or "http".');
        process.exitCode = 1;
        return;
      }
      if (opts.transport === 'http' && (!Number.isInteger(opts.port) || (opts.port ?? 0) <= 0)) {
        console.error('Invalid MCP HTTP port.');
        process.exitCode = 1;
        return;
      }
      // Lazy-load so the CLI doesn't pay the @modelcontextprotocol/sdk
      // import cost on every invocation.
      const { runMcpServer } = await import('../../runtime/mcp/index.js');
      await runMcpServer({
        transport: opts.transport ?? 'stdio',
        host: opts.host,
        port: opts.port,
      });
    });
}
