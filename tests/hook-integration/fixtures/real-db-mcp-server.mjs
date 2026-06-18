import { spawnSync } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'realdb', version: '0.0.0-test' });

function runPsql(query) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'openbox-postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'openbox',
      '-P',
      'pager=off',
      '-t',
      '-A',
      '-F',
      ',',
      '-c',
      query,
    ],
    {
      encoding: 'utf-8',
      timeout: 15_000,
    },
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `psql exited ${result.status}`).trim());
  }
  return result.stdout.trim();
}

server.tool(
  'query_database',
  'Run a read-only SQL query against the local OpenBox Postgres test database.',
  {
    query: z.string(),
    operation: z.string().optional(),
    system: z.string().optional(),
  },
  async ({ query, operation = 'QUERY', system = 'postgresql' }) => {
    try {
      if (!/^\s*select\b/i.test(query)) {
        return {
          content: [{ type: 'text', text: 'Error: only SELECT is allowed in the real DB test MCP server' }],
          isError: true,
        };
      }
      const stdout = runPsql(query);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: true, system, operation, query, stdout }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  },
);

await server.connect(new StdioServerTransport());
