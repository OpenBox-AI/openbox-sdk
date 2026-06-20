import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPENBOX_EXTENSION_MANIFEST,
  OPENBOX_EXTENSION_SPEC,
} from '../../apps/extension/src/generated/openbox-extension-spec.js';

interface ExtensionPackageJson {
  name: string;
  publisher: string;
  displayName: string;
  main: string;
  activationEvents: string[];
  contributes: {
    views: Record<string, Array<{ id: string }>>;
    commands: Array<{ command: string }>;
    configuration: {
      properties: Record<string, unknown>;
    };
  };
  scripts: Record<string, string>;
}

function readExtensionPackageJson(): ExtensionPackageJson {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'apps/extension/package.json'), 'utf8'),
  ) as ExtensionPackageJson;
}

describe('extension TypeSpec target surface', () => {
  it('keeps VS Code manifest surfaces pinned to the TypeSpec-emitted spec', () => {
    const packageJson = readExtensionPackageJson();
    const contributedViews = Object.values(packageJson.contributes.views)
      .flat()
      .map((view) => view.id);
    const contributedCommands = packageJson.contributes.commands.map(
      (command) => command.command,
    );
    const configurationKeys = Object.keys(packageJson.contributes.configuration.properties);

    expect(OPENBOX_EXTENSION_SPEC).toMatchObject({
      id: 'extension',
      kind: 'app',
      workingDirectory: 'apps/extension',
    });
    expect(OPENBOX_EXTENSION_SPEC.commands).toEqual([
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npm', args: ['run', 'test'] },
    ]);

    expect(packageJson.name).toBe(OPENBOX_EXTENSION_MANIFEST.packageName);
    expect(packageJson.publisher).toBe(OPENBOX_EXTENSION_MANIFEST.publisher);
    expect(packageJson.displayName).toBe(OPENBOX_EXTENSION_MANIFEST.displayName);
    expect(packageJson.main).toBe(OPENBOX_EXTENSION_MANIFEST.main);
    expect(packageJson.activationEvents).toEqual([
      ...OPENBOX_EXTENSION_MANIFEST.activationEvents,
    ]);
    expect(contributedViews).toEqual([...OPENBOX_EXTENSION_MANIFEST.views]);
    expect(contributedCommands).toEqual([...OPENBOX_EXTENSION_MANIFEST.commands]);
    expect(configurationKeys).toEqual([...OPENBOX_EXTENSION_MANIFEST.configurationKeys]);
  });
});
