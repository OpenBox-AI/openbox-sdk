// Unit coverage for the tier-2 recipe runner. Locks the contract:
//   - all steps run in parallel (Promise.all)
//   - each step's result lands under `step.into`
//   - paginate: walks every page until empty / total reached
//   - optional: catches failures and stores null
//   - non-optional failure → reportAndExit (process.exit shimmed)
//   - description gets `[recipe]` prefix and `Composes:` suffix
//
// Driven via a fake Commander program + fake client. No real I/O.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

import { wireRecipes, type RecipeSpec } from '../../ts/src/cli/recipes';

vi.mock('../../ts/src/cli/output', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  note: vi.fn(),
  banner: vi.fn(),
  info: vi.fn(),
  action: vi.fn(),
  success: vi.fn(),
  row: vi.fn(),
  summary: vi.fn(),
  kv: vi.fn(),
  table: vi.fn(),
}));

import { output } from '../../ts/src/cli/output';

function newProgram(): Command {
  const p = new Command();
  p.exitOverride();
  return p;
}

describe('wireRecipes', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('fans out to every step and assembles the named envelope', async () => {
    const calls: string[] = [];
    const client = {
      getAgent: vi.fn(async (id: string) => {
        calls.push(`getAgent(${id})`);
        return { id, name: 'a' };
      }),
      listGuardrails: vi.fn(async (id: string) => {
        calls.push(`listGuardrails(${id})`);
        return [{ rule: 'x' }];
      }),
    };
    const spec: RecipeSpec = {
      name: 'describe',
      description: 'Test recipe',
      args: [{ name: 'agentId' }],
      steps: [
        { call: 'getAgent', args: ['agentId'], into: 'agent' },
        { call: 'listGuardrails', args: ['agentId'], into: 'guardrails' },
      ],
      output: { kind: 'json' },
    };
    const program = newProgram();
    wireRecipes(program, [spec], () => client as never);

    await program.parseAsync(['node', 'cli', 'describe', 'a-1']);

    expect(client.getAgent).toHaveBeenCalledWith('a-1');
    expect(client.listGuardrails).toHaveBeenCalledWith('a-1');
    expect(output).toHaveBeenCalledWith({
      agent: { id: 'a-1', name: 'a' },
      guardrails: [{ rule: 'x' }],
    });
  });

  it('paginate: true walks every page until empty', async () => {
    const pages = [
      { data: [1, 2, 3], total: 7 },
      { data: [4, 5, 6], total: 7 },
      { data: [7], total: 7 },
    ];
    let page = 0;
    const client = {
      listSessions: vi.fn(async (id: string, opts: { page: number }) => {
        expect(opts.page).toBe(page);
        const r = pages[page];
        page += 1;
        return r;
      }),
    };
    const spec: RecipeSpec = {
      name: 'demo',
      description: 'paged',
      args: [{ name: 'agentId' }],
      steps: [
        {
          call: 'listSessions',
          args: ['agentId'],
          into: 'sessions',
          paginate: true,
        },
      ],
      output: { kind: 'json' },
    };
    const program = newProgram();
    wireRecipes(program, [spec], () => client as never);
    await program.parseAsync(['node', 'cli', 'demo', 'agent-1']);

    expect(client.listSessions).toHaveBeenCalledTimes(3);
    expect(output).toHaveBeenCalledWith({
      sessions: [1, 2, 3, 4, 5, 6, 7],
    });
  });

  it('optional: true catches failures and stores null', async () => {
    const client = {
      getAgent: vi.fn(async () => ({ id: 'a' })),
      flakyGet: vi.fn(async () => {
        throw new Error('500 internal');
      }),
    };
    const spec: RecipeSpec = {
      name: 'demo',
      description: 'tolerant',
      args: [{ name: 'agentId' }],
      steps: [
        { call: 'getAgent', args: ['agentId'], into: 'agent' },
        { call: 'flakyGet', args: ['agentId'], into: 'maybe', optional: true },
      ],
      output: { kind: 'json' },
    };
    const program = newProgram();
    wireRecipes(program, [spec], () => client as never);
    await program.parseAsync(['node', 'cli', 'demo', 'a']);

    expect(output).toHaveBeenCalledWith({
      agent: { id: 'a' },
      maybe: null,
    });
  });

  it('non-optional failure routes through reportAndExit (process.exit fires)', async () => {
    const client = {
      getAgent: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const spec: RecipeSpec = {
      name: 'demo',
      description: 'fragile',
      args: [{ name: 'agentId' }],
      steps: [{ call: 'getAgent', args: ['agentId'], into: 'agent' }],
      output: { kind: 'json' },
    };
    const program = newProgram();
    wireRecipes(program, [spec], () => client as never);
    await program.parseAsync(['node', 'cli', 'demo', 'a']);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('description is tagged with [recipe] and Composes: line', async () => {
    const spec: RecipeSpec = {
      name: 'show',
      description: 'Show me everything',
      args: [{ name: 'agentId' }],
      steps: [
        { call: 'a', args: [], into: 'a' },
        { call: 'b', args: [], into: 'b' },
        { call: 'c', args: [], into: 'c' },
      ],
      output: { kind: 'json' },
    };
    const program = newProgram();
    wireRecipes(program, [spec], () => ({} as never));
    const cmd = program.commands.find((c) => c.name() === 'show');
    expect(cmd).toBeDefined();
    const desc = cmd!.description();
    expect(desc).toContain('[recipe]');
    expect(desc).toContain('Show me everything');
    expect(desc).toContain('Composes: a, b, c');
  });

  it('unknown step.call throws (caught by reportAndExit → exit 1)', async () => {
    const client = { realCall: vi.fn() };
    const spec: RecipeSpec = {
      name: 'broken',
      description: 'typo',
      args: [{ name: 'agentId' }],
      steps: [{ call: 'doesNotExist', args: ['agentId'], into: 'x' }],
      output: { kind: 'json' },
    };
    const program = newProgram();
    wireRecipes(program, [spec], () => client as never);
    await program.parseAsync(['node', 'cli', 'broken', 'a']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
