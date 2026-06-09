import { afterEach, describe, expect, it } from 'vitest';
import {
  currentMaturityLevel,
  enableFeature,
  enableFeatures,
  isFeatureEnabled,
  isMaturityVisible,
  listFeatures,
  maturityOf,
  setMaturityLevel,
} from '../../ts/src/maturity/index.js';

const beforeLevel = process.env.OPENBOX_EXPERIMENTAL_LEVEL;
const beforeFeatures = process.env.OPENBOX_FEATURES;

afterEach(() => {
  setMaturityLevel(null);
  if (beforeLevel === undefined) delete process.env.OPENBOX_EXPERIMENTAL_LEVEL;
  else process.env.OPENBOX_EXPERIMENTAL_LEVEL = beforeLevel;
  if (beforeFeatures === undefined) delete process.env.OPENBOX_FEATURES;
  else process.env.OPENBOX_FEATURES = beforeFeatures;
});

describe('maturity helpers', () => {
  it('resolves override, env, invalid env, and visibility ordering', () => {
    process.env.OPENBOX_EXPERIMENTAL_LEVEL = 'beta';
    expect(currentMaturityLevel()).toBe('beta');
    expect(isMaturityVisible('stable')).toBe(true);
    expect(isMaturityVisible('experimental')).toBe(false);

    setMaturityLevel('experimental');
    expect(currentMaturityLevel()).toBe('experimental');
    expect(isMaturityVisible('experimental')).toBe(true);

    setMaturityLevel(null);
    process.env.OPENBOX_EXPERIMENTAL_LEVEL = 'nonsense';
    expect(currentMaturityLevel()).toBe('stable');
    expect(maturityOf('__missing__')).toBe('stable');
  });

  it('enables features from explicit calls, env vars, and maturity bridge', () => {
    enableFeature('');
    enableFeatures(undefined);
    enableFeatures(['manual.feature']);
    expect(isFeatureEnabled('manual.feature')).toBe(true);

    process.env.OPENBOX_FEATURES = 'env.feature, ,another.feature';
    expect(isFeatureEnabled('env.feature')).toBe(true);
    expect(isFeatureEnabled('another.feature')).toBe(true);

    setMaturityLevel('experimental');
    const registered = listFeatures()[0];
    if (registered) {
      expect(isFeatureEnabled(registered.name)).toBe(true);
    }
  });
});
