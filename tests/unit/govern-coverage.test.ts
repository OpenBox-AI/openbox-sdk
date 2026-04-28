// Asserts every entry in PRESET_MANIFEST has a corresponding method on
// the matching generated Session class. Adding a new preset method to
// `specs/typespec/govern/main.tsp` without the emitter generating it
// fails CI on the next `npm run specs:compile`.
//
// The first-line check is `tsc --noEmit` - every Session class extends
// BaseGovernedSession and the spec→code shape is fully generated, so a
// missing method on a class would be a compiler error. This test backs
// that with a runtime assertion that each manifest entry's method is a
// `function` on the right Session prototype.

import { describe, expect, test } from 'vitest';
import {
  PRESET_MANIFEST,
  presets,
  BaseGovernedSession,
  CustomSession,
} from '../../ts/src/core-client/generated/govern.js';
import * as corePublic from '../../ts/src/core-client/index.js';

const PRESET_TO_CAMEL: Record<string, keyof typeof presets> = {
  airflow: 'airflow',
  argocd: 'argocd',
  autogen: 'autogen',
  'claude-code': 'claudeCode',
  cline: 'cline',
  codex: 'codex',
  copilot: 'copilot',
  crewai: 'crewai',
  cursor: 'cursor',
  custom: 'custom',
  default: 'default',
  langchain: 'langchain',
  langgraph: 'langgraph',
  llamaindex: 'llamaindex',
  mastra: 'mastra',
  'modern-treasury': 'modernTreasury',
  n8n: 'n8n',
  pagerduty: 'pagerduty',
  'pydantic-ai': 'pydanticAi',
  'semantic-kernel': 'semanticKernel',
  temporal: 'temporal',
  'vercel-ai': 'vercelAi',
};

// Pascal-case the preset name the same way the emitter does (drops dashes,
// title-cases each segment, appends "Session"). Keeps the index re-export
// in lockstep with the manifest without hard-coding the 22 names.
function presetClassName(preset: string): string {
  return preset
    .split(/[-_]/)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join('') + 'Session';
}

describe('every PRESET_MANIFEST entry has a matching Session class', () => {
  test('PRESET_TO_CAMEL covers every shipped preset', () => {
    const shipped = PRESET_MANIFEST.map((p) => p.preset).sort();
    const mapped = Object.keys(PRESET_TO_CAMEL).sort();
    expect(mapped).toEqual(shipped);
  });

  test('core-client/index.ts re-exports every preset Session class', () => {
    const missing = PRESET_MANIFEST
      .map((p) => presetClassName(p.preset))
      .filter((name) => !(name in corePublic));
    expect(
      missing,
      `Add these to ts/src/core-client/index.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  for (const preset of PRESET_MANIFEST) {
    describe(`preset: ${preset.preset}`, () => {
      const camel = PRESET_TO_CAMEL[preset.preset];
      const SessionCtor = presets[camel];

      test('registry entry is a class extending BaseGovernedSession', () => {
        expect(SessionCtor).toBeDefined();
        expect(typeof SessionCtor).toBe('function');
        // Walking the prototype chain - the generated file uses
        // `extends BaseGovernedSession` for every preset.
        expect(SessionCtor.prototype).toBeInstanceOf(BaseGovernedSession);
      });

      if (preset.preset === 'custom') {
        test('CustomSession has the free-form `activity` method', () => {
          expect(typeof CustomSession.prototype.activity).toBe('function');
        });
      } else {
        for (const m of preset.methods) {
          test(`method ${m.name} → ${m.eventType} / ${m.activityType}`, () => {
            const proto = SessionCtor.prototype as unknown as Record<string, unknown>;
            expect(
              typeof proto[m.name],
              `${SessionCtor.name} is missing the \`${m.name}\` method declared in PRESET_MANIFEST`,
            ).toBe('function');
          });
        }
      }
    });
  }
});
