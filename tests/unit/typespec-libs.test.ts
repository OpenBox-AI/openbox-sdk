// Smoke test: compile the project's TypeSpec sources end-to-end and
// assert that every custom decorator we ship attaches the state it
// claims to. If the decorator wiring breaks (state-key drift,
// mis-registered namespace, missing tsp-index re-export), this test
// catches it without needing the per-language emitters to be in place.

import { compile, NodeHost, resolvePath } from '@typespec/compiler';
import { describe, expect, test, beforeAll } from 'vitest';
import {
  getEnvVar,
  getTokenFormat,
  isOsPath,
} from '../../codegen/typespec-libs/env/dist/decorators.js';
import {
  getCommand,
  getFlag,
  getValidator,
  isOutput,
} from '../../codegen/typespec-libs/cli/dist/decorators.js';
import {
  getActivity,
  getVerdictModel,
  getWorkflow,
} from '../../codegen/typespec-libs/workflow/dist/decorators.js';

import type { Program, Model, Interface, Operation, ModelProperty } from '@typespec/compiler';

let program: Program;

beforeAll(async () => {
  const root = resolvePath(import.meta.dirname, '..', '..');
  const main = resolvePath(root, 'specs', 'typespec', 'main.tsp');
  program = await compile(NodeHost, main, {
    noEmit: true,
  });
  // Surface compile failures up-front; otherwise the per-test asserts
  // would all just fail with "model not found" without explaining why.
  const fatals = program.diagnostics.filter((d) => d.severity === 'error');
  if (fatals.length > 0) {
    const summary = fatals
      .map((d) => `${(d.target as { file?: { path?: string } })?.file?.path ?? '?'}: ${d.code}`)
      .slice(0, 5)
      .join('\n');
    throw new Error(`TypeSpec compile produced errors:\n${summary}`);
  }
}, 30_000);

function findModel(name: string): Model {
  for (const ns of walkNamespaces(program)) {
    const m = ns.models.get(name);
    if (m) return m;
  }
  throw new Error(`model not found: ${name}`);
}

function findInterface(name: string): Interface {
  for (const ns of walkNamespaces(program)) {
    const i = ns.interfaces.get(name);
    if (i) return i;
  }
  throw new Error(`interface not found: ${name}`);
}

function* walkNamespaces(p: Program) {
  const stack = [p.getGlobalNamespaceType()];
  while (stack.length) {
    const ns = stack.pop()!;
    yield ns;
    for (const sub of ns.namespaces.values()) stack.push(sub);
  }
}

function prop(model: Model, name: string): ModelProperty {
  const p = model.properties.get(name);
  if (!p) throw new Error(`${model.name} has no property ${name}`);
  return p;
}

function activityOp(iface: Interface, name: string): Operation {
  const op = iface.operations.get(name);
  if (!op) throw new Error(`${iface.name} has no operation ${name}`);
  return op;
}

describe('@openbox/typespec-env', () => {
  test('@env_var attaches name + default', () => {
    const config = findModel('RuntimeConfig');
    expect(getEnvVar(program, prop(config, 'apiUrl'))?.name).toBe('OPENBOX_API_URL');
    expect(getEnvVar(program, prop(config, 'coreUrl'))?.name).toBe('OPENBOX_CORE_URL');
    expect(getEnvVar(program, prop(config, 'platformUrl'))?.name).toBe('OPENBOX_PLATFORM_URL');
    expect(getEnvVar(program, prop(config, 'env'))).toBeUndefined();
  });

  test('@token_format attaches the regex literally', () => {
    const creds = findModel('Credentials');
    expect(getTokenFormat(program, prop(creds, 'apiKey'))).toBe(
      '^obx_(?:live|test)_[0-9a-f]{48}$',
    );
    expect(getTokenFormat(program, prop(creds, 'env'))).toBeUndefined();

    const variant = findModel('ClientVariant');
    expect(getTokenFormat(program, prop(variant, 'value'))).toBe('^[A-Za-z0-9._+-]+$');
  });

  test('@os_path is a flag', () => {
    const creds = findModel('Credentials');
    expect(isOsPath(program, prop(creds, 'path'))).toBe(true);
    expect(isOsPath(program, prop(creds, 'apiKey'))).toBe(false);
  });
});

describe('@openbox/typespec-cli', () => {
  test('@cli_command attaches name + description', () => {
    const auth = findInterface('Auth');
    const c = getCommand(program, auth);
    expect(c?.name).toBe('auth');
    expect(c?.description).toMatch(/Authenticate/);
  });

  test('@cli_flag captures description, short alias, env binding', () => {
    const auth = findInterface('Auth');
    const login = activityOp(auth, 'login');
    const envParam = login.parameters.properties.get('env');
    if (!envParam) throw new Error('Auth.login has no `env` parameter');
    const f = getFlag(program, envParam);
    expect(f?.description).toMatch(/Override the default environment/);
    expect(f?.short).toBe('e');
    expect(f?.env).toBe('OPENBOX_ENV');
  });

  test('@cli_validator and @cli_output attach', () => {
    const creds = findModel('PersistedCredentials');
    expect(getValidator(program, prop(creds, 'apiKey'))).toBe('validateApiKeyFormat');
    expect(isOutput(program, findModel('AuthProfileOutput'))).toBe(true);
  });
});

describe('@openbox/typespec-workflow', () => {
  test('@workflow attaches the domain (snake_case fallback)', () => {
    const agent = findInterface('GovernedAgent');
    const w = getWorkflow(program, agent);
    expect(w?.domain).toBe('governed_agent');
  });

  test('@activity captures canonicalType + stage', () => {
    const agent = findInterface('GovernedAgent');
    const promptSub = getActivity(program, activityOp(agent, 'promptSubmission'));
    expect(promptSub?.canonicalType).toBe('PromptSubmission');
    expect(promptSub?.stage).toBe('pre');

    const tool = getActivity(program, activityOp(agent, 'toolCompleted'));
    expect(tool?.canonicalType).toBe('ToolCompleted');
    expect(tool?.stage).toBe('both');
  });

  test('@verdict singleton resolves', () => {
    const verdict = getVerdictModel(program);
    expect(verdict?.name).toBe('WorkflowVerdict');
  });
});
