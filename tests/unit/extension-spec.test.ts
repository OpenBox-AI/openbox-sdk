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
    viewsContainers: Record<string, Array<{ id: string; title: string; icon?: string }>>;
    views: Record<
      string,
      Array<{ id: string; name: string; icon?: string; when?: string }>
    >;
    commands: Array<{
      command: string;
      title: string;
      category?: string;
      icon?: string;
      enablement?: string;
    }>;
    configuration: {
      properties: Record<
        string,
        { type: string; default?: string | boolean | number; description: string }
      >;
    };
    viewsWelcome: Array<{ view: string; contents: string; when?: string }>;
    menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
  };
  scripts: Record<string, string>;
}

function readExtensionPackageJson(): ExtensionPackageJson {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'apps/extension/package.json'), 'utf8'),
  ) as ExtensionPackageJson;
}

function compactRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

describe('extension TypeSpec target surface', () => {
  it('keeps VS Code manifest surfaces pinned to the TypeSpec-emitted spec', () => {
    const packageJson = readExtensionPackageJson();
    const contributedViewContainers = Object.entries(packageJson.contributes.viewsContainers)
      .flatMap(([location, containers]) =>
        containers.map((container) => compactRecord({ location, ...container })),
      );
    const contributedViewDefinitions = Object.entries(packageJson.contributes.views)
      .flatMap(([container, views]) =>
        views.map((view) => compactRecord({ container, ...view })),
      );
    const contributedViews = contributedViewDefinitions
      .map((view) => view.id);
    const contributedCommandDefinitions = packageJson.contributes.commands.map((command) =>
      compactRecord(command),
    );
    const contributedCommands = contributedCommandDefinitions.map(
      (command) => command.command,
    );
    const configurationProperties = Object.entries(packageJson.contributes.configuration.properties)
      .map(([key, property]) =>
        compactRecord({
          key,
          type: property.type,
          defaultValue: property.default,
          description: property.description,
        }),
      );
    const configurationKeys = configurationProperties.map((property) => property.key);
    const viewsWelcome = packageJson.contributes.viewsWelcome.map((entry) => compactRecord(entry));
    const menus = Object.entries(packageJson.contributes.menus)
      .flatMap(([location, entries]) =>
        entries.map((entry) => compactRecord({ location, ...entry })),
      );

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
    expect(contributedViewContainers).toEqual([
      ...OPENBOX_EXTENSION_MANIFEST.viewContainers,
    ]);
    expect(contributedViewDefinitions).toEqual([
      ...OPENBOX_EXTENSION_MANIFEST.viewDefinitions,
    ]);
    expect(contributedViews).toEqual([...OPENBOX_EXTENSION_MANIFEST.views]);
    expect(contributedCommandDefinitions).toEqual([
      ...OPENBOX_EXTENSION_MANIFEST.commandDefinitions,
    ]);
    expect(contributedCommands).toEqual([...OPENBOX_EXTENSION_MANIFEST.commands]);
    expect(configurationProperties).toEqual([
      ...OPENBOX_EXTENSION_MANIFEST.configurationProperties,
    ]);
    expect(configurationKeys).toEqual([...OPENBOX_EXTENSION_MANIFEST.configurationKeys]);
    expect(viewsWelcome).toEqual([...OPENBOX_EXTENSION_MANIFEST.viewsWelcome]);
    expect(menus).toEqual([...OPENBOX_EXTENSION_MANIFEST.menus]);
  });
});
