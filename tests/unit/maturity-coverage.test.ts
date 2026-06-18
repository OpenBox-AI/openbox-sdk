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

afterEach(() => {
  setMaturityLevel(null);
});

describe('maturity helpers', () => {
  it('resolves explicit override and visibility ordering', () => {
    expect(currentMaturityLevel()).toBe('stable');
    expect(isMaturityVisible('stable')).toBe(true);
    expect(isMaturityVisible('experimental')).toBe(false);

    setMaturityLevel('experimental');
    expect(currentMaturityLevel()).toBe('experimental');
    expect(isMaturityVisible('experimental')).toBe(true);

    setMaturityLevel(null);
    expect(currentMaturityLevel()).toBe('stable');
    expect(maturityOf('__missing__')).toBe('stable');
  });

  it('enables features from explicit calls and maturity bridge', () => {
    enableFeature('');
    enableFeatures(undefined);
    enableFeatures(['manual.feature']);
    expect(isFeatureEnabled('manual.feature')).toBe(true);

    setMaturityLevel('experimental');
    const registered = listFeatures()[0];
    if (registered) {
      expect(isFeatureEnabled(registered.name)).toBe(true);
    }
  });
});
