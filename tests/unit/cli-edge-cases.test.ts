// CLI edge cases by topic. Each describe block names the source file
// + the specific edge it's exercising:
//   - client/client.ts; 429 + 401 envelope handling
//   - validators; additional uncovered validator branches
//   - verify; additional rule-firing on non-fixture paths
//   - runtime/mcp; module-shape sanity (full coverage in mcp-server-coverage)
//   - cli/config; getCoreClient with bad / missing OPENBOX_API_KEY
//   - runtime configs; file-based config.json precedence

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

let dir: string;
let originalHome: string | undefined;
let originalCwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-final-grind-'));
  originalHome = process.env.OPENBOX_HOME;
  process.env.OPENBOX_HOME = dir;
  originalCwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome !== undefined) process.env.OPENBOX_HOME = originalHome;
  else delete process.env.OPENBOX_HOME;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('client/client.ts; 429 + auth-error paths', () => {
  it('429 throws OpenBoxApiError with rate-limit status', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
      res.end(JSON.stringify({ status: 429, message: 'too many' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      const { OpenBoxClient } = await import('../../ts/src/client');
      const client = new OpenBoxClient({ apiUrl: url, accessToken: 't', retryAttempts: 0 } as any);
      let caught: any;
      try {
        await client.health();
      } catch (e) { caught = e; }
      expect(caught?.status).toBe(429);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('401 throws OpenBoxApiError with auth status', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 401, message: 'unauthorized' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      const { OpenBoxClient } = await import('../../ts/src/client');
      const client = new OpenBoxClient({ apiUrl: url, accessToken: 't', retryAttempts: 0 } as any);
      let caught: any;
      try {
        await client.health();
      } catch (e) { caught = e; }
      expect(caught?.status).toBe(401);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('GET with query params builds URL search string', async () => {
    const captured: string[] = [];
    const server = createServer((req, res) => {
      captured.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 200, data: [] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      const { OpenBoxClient } = await import('../../ts/src/client');
      const client = new OpenBoxClient({ apiUrl: url, accessToken: 't' });
      await client.listAgents({ page: 1, perPage: 25, search: 'foo bar', tiers: [1, 2] } as any);
      expect(captured[0]).toMatch(/page=1/);
      expect(captured[0]).toMatch(/perPage=25/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('cli/index.ts; import side effects', () => {
  it('can be imported without executing the CLI parser', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`unexpected process.exit(${String(code)})`);
    }) as never);

    try {
      const mod = await import('../../ts/src/cli/index');

      expect(typeof mod.runOpenBoxCli).toBe('function');
      expect(typeof mod.program).toBe('object');
      expect(exit).not.toHaveBeenCalled();
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
      exit.mockRestore();
    }
  });
});

describe('validators; every uncovered branch', () => {
  it('validateActivitiesConfig is a compatibility no-op (accepts anything)', async () => {
    const { validateActivitiesConfig } = await import('../../ts/src/validators');
    expect(() =>
      validateActivitiesConfig([{ activity_type: 'PromptSubmission', fields_to_check: ['prompt'] }], '0'),
    ).not.toThrow();
    // documented back-compat no-op — even a malformed value is accepted.
    expect(() => validateActivitiesConfig('invalid' as unknown, '0')).not.toThrow();
  });

  it('validateGuardrailParams enforces required params for type 4/5, passes others', async () => {
    const { validateGuardrailParams } = await import('../../ts/src/validators');
    expect(() => validateGuardrailParams('4', {})).toThrow(); // ban_list needs banned_words
    expect(() => validateGuardrailParams('4', { banned_words: ['x'] })).not.toThrow();
    expect(() => validateGuardrailParams('5', {})).toThrow(); // regex needs params.regex
    expect(() => validateGuardrailParams('1', {})).not.toThrow(); // no required params
  });

  it('validateBehaviorTrigger / validateBehaviorStates accept canonical names, reject unknown', async () => {
    const { validateBehaviorTrigger, validateBehaviorStates } = await import('../../ts/src/validators');
    expect(validateBehaviorTrigger('http_post')).toBe('http_post');
    expect(validateBehaviorTrigger('file_read')).toBe('file_read');
    expect(() => validateBehaviorTrigger('made_up')).toThrow();
    expect(validateBehaviorStates(['http_get', 'http_post'])).toEqual(['http_get', 'http_post']);
    expect(() => validateBehaviorStates(['made_up'])).toThrow();
  });

  it('validateApprovalTimeout requires a positive timeout only for verdict 2', async () => {
    const { validateApprovalTimeout } = await import('../../ts/src/validators');
    expect(() => validateApprovalTimeout(2, null)).toThrow(); // require_approval needs a timeout
    expect(() => validateApprovalTimeout(2, 0)).toThrow(); // must be >= 1
    expect(() => validateApprovalTimeout(2, 300)).not.toThrow();
    expect(() => validateApprovalTimeout(0, null)).not.toThrow(); // other verdicts: no-op
  });

  it('validateRegoSource requires non-empty source with a package declaration', async () => {
    const { validateRegoSource } = await import('../../ts/src/validators');
    expect(() => validateRegoSource('')).toThrow(); // empty
    expect(() => validateRegoSource('default allow = true')).toThrow(); // missing package
    expect(() =>
      validateRegoSource('package x\nresult := {"decision": "allow"}'),
    ).not.toThrow();
  });
});

describe('verify; additional rules + edge fixtures', () => {
  it('verify --fail-on=warn surfaces all warns', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'verify-warn-'));
    try {
      // Write a sample with a non-canonical event_type → warn-level rule.
      writeFileSync(
        join(tmp, 'sample.ts'),
        `
        const event = { event_type: 'NotInCanonicalSet', activity_input: [{}] };
        export { event };
        `,
      );
      const { registerVerifyCommand } = await import('../../ts/src/cli/commands/verify');
      const program = new Command();
      program.exitOverride();
      registerVerifyCommand(program);

      const out: string[] = [];
      const ol = console.log;
      const oe = console.error;
      console.log = (...a: any[]) => out.push(a.join(' '));
      console.error = (...a: any[]) => out.push(a.join(' '));
      const ovExit = process.exit;
      (process as any).exit = ((_c?: number) => { throw new Error('exit'); }) as never;
      try {
        await program.parseAsync(['node', 'openbox', 'verify', tmp, '--json', '--fail-on', 'warn']);
      } catch { /* exit */ }
      finally {
        console.log = ol;
        console.error = oe;
        (process as any).exit = ovExit;
      }
      expect(out.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('runtime/mcp/index; additional helpers', () => {
  it('mcp module exports runMcpServer (import smoke)', async () => {
    // (renamed: this asserts the module export, not hex — hex is not exported.)
    const mod = await import('../../ts/src/runtime/mcp');
    expect(typeof mod.runMcpServer).toBe('function');
  });
});

describe('cli/config; getCoreClient + edge cases', () => {
  it('getCoreClient bails when OPENBOX_API_KEY is unset', async () => {
    delete process.env.OPENBOX_API_KEY;
    const { getCoreClient } = await import('../../ts/src/cli/config');
    let caught: any;
    const ovExit = process.exit;
    (process as any).exit = ((c?: number) => { caught = c; throw new Error('exit'); }) as never;
    const oe = console.error;
    console.error = () => {};
    try {
      try {
        getCoreClient();
      } catch { /* expected */ }
    } finally {
      (process as any).exit = ovExit;
      console.error = oe;
    }
    // getCoreClient MUST bail (call process.exit) when the key is unset — caught
    // is the exit code. (Was a tautology that passed even if it returned a client.)
    expect(typeof caught).toBe('number');
    expect(caught).not.toBe(0);
  });

  it('getCoreClient rejects malformed OPENBOX_API_KEY', async () => {
    process.env.OPENBOX_API_KEY = 'invalid-format';
    const { getCoreClient } = await import('../../ts/src/cli/config');
    const ovExit = process.exit;
    let observedExit: number | undefined;
    (process as any).exit = ((c?: number) => {
      observedExit = c;
      throw new Error('exit:' + c);
    }) as never;
    const oe = console.error;
    let stderr = '';
    console.error = (msg: any) => { stderr += String(msg) + '\n'; };

    let threw = false;
    try {
      getCoreClient();
    } catch {
      threw = true;
    } finally {
      (process as any).exit = ovExit;
      console.error = oe;
      delete process.env.OPENBOX_API_KEY;
    }

    // Concrete contract: getCoreClient with bad-format key MUST not
    // silently return a client. Either it throws (validation error),
    // or it process.exits via reportAndExit. Both are acceptable .
    // proceeding silently is not.
    expect(threw || observedExit !== undefined).toBe(true);
    if (observedExit !== undefined) {
      // cli/config validateApiKeyFormat bails with EXIT.AUTH (3); the
      // user-facing intent is "your API key is bad, fix your auth", not
      // "the command syntax is wrong".
      expect(observedExit).toBe(3);
    }
    // The bailout path always prints a hint message; verify it surfaced.
    expect(stderr.toLowerCase()).toMatch(/openbox_api_key|api key|key format/);
  });
});

describe('runtime configs; file-based config.json paths', () => {
  it('claude-code config reads the project .openbox runtime config', async () => {
    const fs = await import('node:fs');
    const cfgDir = join(dir, '.openbox', 'claude-code');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      join(cfgDir, 'config.json'),
      JSON.stringify({
        OPENBOX_API_KEY: 'obx_test_filebased' + 'x'.repeat(40),
        OPENBOX_CORE_URL: 'http://localhost:9999',
        VERBOSE: true,
      }),
    );
    // Steer the adapter's config dir at our sandbox by loading it
    // from the current project directory.
    const ovEnv = { ...process.env };
    const ovCwd = process.cwd();
    delete process.env.OPENBOX_API_KEY;
    try {
      process.chdir(dir);
      // Bust the require cache so loadConfig re-reads.
      vi.resetModules();
      const mod = await import('../../ts/src/runtime/claude-code/config');
      const cfg = mod.loadConfig();
      expect(cfg.openboxApiKey).toBe('obx_test_filebased' + 'x'.repeat(40));
    } finally {
      process.chdir(ovCwd);
      process.env = ovEnv;
    }
  });
});
