import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  wireSubcommands,
  type SubcommandSpec,
} from '../../ts/src/cli/wire-subcommands.js';

function makeProgram(
  sub: SubcommandSpec,
  client: Record<string, (...args: unknown[]) => Promise<unknown>>,
): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  const parent = program.command('demo');
  wireSubcommands(parent, [sub], () => client);
  return program;
}

describe('wireSubcommands branch coverage', () => {
  it('merges JSON bodies, parsed flags, dto defaults, pagination, and body args', async () => {
    const calls: unknown[][] = [];
    const client = {
      create: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
        return { status: 'ok', data: { id: 'created' } };
      }),
    };
    const sub: SubcommandSpec = {
      name: 'create',
      description: 'create item',
      args: [{ name: 'mode', bodyKey: 'mode', choices: ['safe', 'fast'] }],
      flags: [
        { name: 'body', long: 'body', description: 'json body' },
        { name: 'count', long: 'count', description: 'count', parse: 'int' },
        { name: 'tags', long: 'tags', description: 'tags', parse: 'csv' },
        { name: 'meta', long: 'meta', description: 'meta', parse: 'json' },
        { name: 'enabled', long: 'enabled', description: 'enabled', parse: 'bool' },
        { name: 'left', long: 'left', description: 'left' },
        { name: 'right', long: 'right', description: 'right' },
        { name: 'note', long: 'note', description: 'note' },
      ],
      backend: { method: 'create', shape: 'body' },
      pagination: true,
      jsonMerge: 'fill',
      atLeastOne: ['note', 'count'],
      requiredTogether: ['left', 'right'],
      dtoDefaults: { nested: { keep: true }, count: 1 },
      output: { kind: 'json' },
    };

    const program = makeProgram(sub, client);
    await program.parseAsync([
      'node',
      'openbox',
      'demo',
      'create',
      'safe',
      '--body',
      '{"count":9,"nested":{"custom":true}}',
      '--count',
      '3',
      '--tags',
      'a, b,, c',
      '--meta',
      '{"x":1}',
      '--enabled',
      'true',
      '--left',
      'L',
      '--right',
      'R',
      '--note',
      'hello',
      '--page',
      '2',
      '--limit',
      '25',
    ]);

    expect(calls[0][0]).toMatchObject({
      mode: 'safe',
      count: 9,
      tags: ['a', 'b', 'c'],
      meta: { x: 1 },
      enabled: true,
      left: 'L',
      right: 'R',
      note: 'hello',
      page: 2,
      perPage: 25,
      nested: { custom: true },
    });
  });

  it('rejects missing required JSON fields and partial required-together groups', async () => {
    const sub: SubcommandSpec = {
      name: 'update',
      description: 'update item',
      args: [],
      flags: [
        { name: 'body', long: 'body', description: 'json body' },
        { name: 'name', long: 'name', description: 'name', required: true },
        { name: 'left', long: 'left', description: 'left' },
        { name: 'right', long: 'right', description: 'right' },
      ],
      backend: { method: 'update', shape: 'body' },
      pagination: false,
      jsonMerge: 'fill',
      requiredTogether: ['left', 'right'],
      output: { kind: 'json' },
    };
    const client = { update: vi.fn(async () => ({})) };
    const program = makeProgram(sub, client);
    const originalExit = process.exit;
    const errors: string[] = [];
    const originalError = console.error;
    let exitCode: number | undefined;

    try {
      (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
        exitCode = code;
        throw new Error(`exit:${code}`);
      }) as never;
      console.error = (...args: unknown[]) => {
        errors.push(args.join(' '));
      };

      await expect(
        program.parseAsync([
          'node',
          'openbox',
          'demo',
          'update',
          '--left',
          'L',
        ]),
      ).rejects.toThrow('exit:1');
    } finally {
      (process as unknown as { exit: typeof originalExit }).exit = originalExit;
      console.error = originalError;
    }

    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('partial config');
    expect(client.update).not.toHaveBeenCalled();
  });

  it('routes positional-shaped commands, binary output, and missing client methods', async () => {
    const writes: unknown[] = [];
    const originalWrite = process.stdout.write;
    (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk) => {
      writes.push(chunk);
      return true;
    };
    try {
      const sub: SubcommandSpec = {
        name: 'download',
        description: 'download bytes',
        args: [{ name: 'id' }],
        flags: [
          { name: 'format', long: 'format', description: 'format', choices: ['raw', 'json'] },
          { name: 'ids', long: 'ids', description: 'ids', variadic: true },
        ],
        backend: { method: 'download', shape: 'positional' },
        pagination: false,
        output: { kind: 'binary' },
      };
      const client = {
        download: vi.fn(async (...args: unknown[]) => {
          expect(args).toEqual(['item-1', 'raw', ['a', 'b']]);
          return new Uint8Array([65, 66]);
        }),
      };

      await makeProgram(sub, client).parseAsync([
        'node',
        'openbox',
        'demo',
        'download',
        'item-1',
        '--format',
        'raw',
        '--ids',
        'a',
        'b',
      ]);

      expect(writes).toHaveLength(1);
      expect(writes[0]).toBeInstanceOf(Uint8Array);

      const broken = makeProgram(
        { ...sub, backend: { method: 'missing', shape: 'positional' } },
        {},
      );
      const originalExit = process.exit;
      let exitCode: number | undefined;
      (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
        exitCode = code;
        throw new Error(`exit:${code}`);
      }) as never;
      try {
        await expect(
          broken.parseAsync(['node', 'openbox', 'demo', 'download', 'item-1']),
        ).rejects.toThrow('exit:1');
      } finally {
        (process as unknown as { exit: typeof originalExit }).exit = originalExit;
      }
      expect(exitCode).toBe(1);
    } finally {
      (process.stdout as unknown as { write: typeof originalWrite }).write = originalWrite;
    }
  });

  it('covers MCP governance span variants used by the stdio server', async () => {
    const { buildMcpGovernanceSpan, MCP_ACTIVITY_TYPE_MAP } = await import(
      '../../ts/src/runtime/mcp/governance-span.js'
    );
    const cases = [
      ['llm', { prompt: 'hi' }, 'llm.chat.completion'],
      ['file_read', { file_path: '/tmp/a' }, 'file.read'],
      ['file_write', { file_path: '/tmp/a' }, 'file.write'],
      ['shell', { command: 'ls', cwd: '/tmp' }, 'ShellExecution'],
      ['http', { method: 'get', url: 'https://example.test' }, 'GET https://example.test'],
      ['db', { operation: 'update', system: 'postgresql', statement: 'select 1' }, 'UPDATE'],
      ['mcp', { tool_name: 'read_file' }, 'tool.read_file'],
      ['unknown', {}, 'unknown'],
    ] as const;

    for (const [kind, input, name] of cases) {
      expect(buildMcpGovernanceSpan(kind, input)).toMatchObject({ name });
    }

    expect(MCP_ACTIVITY_TYPE_MAP).toMatchObject({
      llm: 'PromptSubmission',
      file_read: 'FileRead',
      file_write: 'FileEdit',
      shell: 'ShellExecution',
      http: 'HTTPRequest',
      db: 'DatabaseQuery',
      mcp: 'MCPToolCall',
    });
  });

  it('keeps test temporary directories disposable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openbox-wire-'));
    rmSync(dir, { recursive: true, force: true });
  });
});
