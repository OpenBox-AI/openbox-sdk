// TypeSpec compiler entry. This file MUST NOT re-export the `$<name>`
// decorator implementations directly - the compiler auto-discovers any
// such symbol at the module top level as a global decorator and double-
// registers ours, which makes them ambiguous against the namespaced
// declarations in lib/main.tsp.
//
// Emitters and tests should import from './decorators.js' instead.

import { $env_var, $token_format, $os_path } from './decorators.js';

export { $lib } from './lib.js';

export const $decorators = {
  'OpenBox.Env': {
    env_var: $env_var,
    token_format: $token_format,
    os_path: $os_path,
  },
};
