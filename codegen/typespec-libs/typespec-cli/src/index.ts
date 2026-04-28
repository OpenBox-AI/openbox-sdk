// TypeSpec compiler entry - see ../env/src/index.ts for the rationale
// behind only exporting `$lib` and `$decorators`.

import {
  $cli_command,
  $cli_flag,
  $cli_validator,
  $cli_output,
  $cli_maturity,
  $feature_flag,
  $cli_calls,
  $cli_output_kind,
  $cli_pagination,
  $cli_body_key,
  $cli_parse,
  $cli_choice,
  $cli_default,
  $cli_variadic,
} from './decorators.js';

export { $lib } from './lib.js';

export const $decorators = {
  'OpenBox.Cli': {
    cli_command: $cli_command,
    cli_flag: $cli_flag,
    cli_validator: $cli_validator,
    cli_output: $cli_output,
    cli_maturity: $cli_maturity,
    feature_flag: $feature_flag,
    cli_calls: $cli_calls,
    cli_output_kind: $cli_output_kind,
    cli_pagination: $cli_pagination,
    cli_body_key: $cli_body_key,
    cli_parse: $cli_parse,
    cli_choice: $cli_choice,
    cli_default: $cli_default,
    cli_variadic: $cli_variadic,
  },
};
