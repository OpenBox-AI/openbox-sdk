// typespec-env; decorators that describe how a runtime
// environment value is sourced + validated. Authored once here, used
// by every language's env emitter so that the lookup order
// (process env override → token store → built-in default) stays
// consistent across TS / Rust / Python / Go.

import "../dist/index.js";

using TypeSpec.Reflection;

namespace OpenBox.Env;

/**
 * Marks a property as environment-variable-backed. The TS / Rust /
 * Python / Go emitters generate `process.env.<name>` (or equivalent)
 * lookups with `defaultValue` as the fallback when unset.
 *
 * @param name The OS environment variable name. SCREAMING_SNAKE_CASE.
 * @param defaultValue Optional fallback when the env var is unset.
 */
extern dec env_var(target: ModelProperty, name: valueof string, defaultValue?: valueof string);

/**
 * Constrains a string property to a runtime token format, such as
 * the `obx_live_<48hex>` API key shape. Emitters generate validators
 * that reject malformed inputs at the CLI or SDK boundary instead of
 * letting them reach the wire.
 *
 * @param pattern A regular expression in JS / PCRE-compatible syntax.
 *   Must be language-portable; emitters translate to each language's
 *   regex flavor.
 */
extern dec token_format(target: ModelProperty, pattern: valueof string);

/**
 * Marks a string property as a filesystem path that should be
 * resolved against the per-OS user data directory.
 * Linux/macOS: `~/.openbox/`. Windows: `%APPDATA%/openbox/`. macOS app
 * sandbox: `~/Library/Application Support/openbox/`. Emitters use the
 * per-language stdlib equivalent of `env-paths` / `dirs` / `platformdirs`.
 */
extern dec os_path(target: ModelProperty);
