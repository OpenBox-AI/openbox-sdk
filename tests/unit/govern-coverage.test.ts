// Asserts every entry in ACTIVITY_MANIFEST has a corresponding method
// on `GovernedSession` (which `implements GovernedAgent`). Adding a new
// activity to `specs/typespec/govern/main.tsp` without implementing the
// matching method now fails CI on the next `npm run specs:compile`.
//
// The first-line check is `tsc --noEmit` (the `implements GovernedAgent`
// declaration would already fail), but this test backs that with a
// runtime assertion that each manifest entry's method is a `function`
// on the class prototype.

import { describe, expect, test } from 'vitest';
import {
  ACTIVITY_MANIFEST,
  GovernedSession,
  type GovernedAgent,
} from '../../ts/core-client/src/generated/govern.js';

describe('GovernedSession covers every ACTIVITY_MANIFEST entry', () => {
  test.each(ACTIVITY_MANIFEST as readonly { method: string; canonicalType: string }[])(
    '$method ($canonicalType)',
    ({ method }) => {
      const proto = GovernedSession.prototype as unknown as Record<string, unknown>;
      expect(
        typeof proto[method],
        `GovernedSession is missing the \`${method}\` method declared in ACTIVITY_MANIFEST. ` +
          'Add it to ts/core-client/src/govern.ts or remove it from the spec.',
      ).toBe('function');
    },
  );

  test('`implements GovernedAgent` covers every method (compile-time gate)', () => {
    // Static check - if this file compiles, the class structurally
    // satisfies the spec interface. The cast below is the runtime
    // version of the same guarantee.
    const _check: GovernedAgent = new GovernedSession({
      core: undefined as unknown as never,
    });
    expect(_check).toBeDefined();
  });
});
