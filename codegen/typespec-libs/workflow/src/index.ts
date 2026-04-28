// TypeSpec compiler entry - see ../env/src/index.ts for the rationale
// behind only exporting `$lib` and `$decorators`.

import { $verdict, $preset, $maps_to } from './decorators.js';

export { $lib } from './lib.js';

export const $decorators = {
  'OpenBox.Workflow': {
    verdict: $verdict,
    preset: $preset,
    maps_to: $maps_to,
  },
};
