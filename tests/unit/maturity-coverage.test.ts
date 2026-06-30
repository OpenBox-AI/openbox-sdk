import { afterEach, describe, expect, it } from 'vitest';
import {
  currentMaturityLevel,
  enableFeature,
  enableFeatures,
  FEATURE_MATURITY,
  isFeatureEnabled,
  isMaturityVisible,
  listFeatures,
  type Maturity,
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

    // Seed a registered feature so the maturity-bridge branch is exercised
    // deterministically regardless of the (currently empty) generated
    // FEATURE_MATURITY table.
    const bridged = '__bridge_test_feature__';
    (FEATURE_MATURITY as Record<string, Maturity>)[bridged] = 'experimental';
    try {
      // At the default stable level the experimental feature is NOT visible
      // through the bridge and was never explicitly enabled.
      setMaturityLevel(null);
      expect(isFeatureEnabled(bridged)).toBe(false);

      // Raising the level to experimental enables it via the maturity bridge.
      setMaturityLevel('experimental');
      expect(isFeatureEnabled(bridged)).toBe(true);

      // ...and listFeatures reflects the bridged-enabled state.
      const registered = listFeatures().find((f) => f.name === bridged);
      expect(registered).toBeDefined();
      expect(registered?.maturity).toBe('experimental');
      expect(registered?.enabled).toBe(true);
    } finally {
      delete (FEATURE_MATURITY as Record<string, Maturity>)[bridged];
    }
  });
});
