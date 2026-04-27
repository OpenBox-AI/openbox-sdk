// TypeSpec compiler entry - see ../env/src/index.ts for the rationale
// behind only exporting `$lib` and `$decorators`.

import { $workflow, $activity, $verdict, $observer_hook } from './decorators.js';

export { $lib } from './lib.js';

export const $decorators = {
  'OpenBox.Workflow': {
    workflow: $workflow,
    activity: $activity,
    verdict: $verdict,
    observer_hook: $observer_hook,
  },
};
