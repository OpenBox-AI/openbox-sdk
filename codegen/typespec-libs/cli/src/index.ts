// TypeSpec compiler entry - see ../env/src/index.ts for the rationale
// behind only exporting `$lib` and `$decorators`.

import { $cli_command, $cli_flag, $cli_validator, $cli_output } from './decorators.js';

export { $lib } from './lib.js';

export const $decorators = {
  'OpenBox.Cli': {
    cli_command: $cli_command,
    cli_flag: $cli_flag,
    cli_validator: $cli_validator,
    cli_output: $cli_output,
  },
};
