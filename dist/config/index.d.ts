/** Read a JSON config file. Returns the parsed object as
 *  string-keyed values, with each camelCase key also exposed under
 *  its UPPER_SNAKE form so the consumer's `get('FOO_BAR')` lookup
 *  matches `{ fooBar: ... }` entries. */
declare function loadJsonConfig(file: string): Record<string, string>;
/** Read a dotenv-style file. Comments (`# …`) and blank lines are
 *  ignored; values are trimmed and matching surrounding quotes are
 *  stripped. */
declare function loadDotenv(file: string): Record<string, string>;

type Scope = 'global';
declare function effectiveScope(_requested: Scope, _key: string): Scope;
declare function setConfig(key: string, value: string): {
    scope: Scope;
    purged: number;
};
declare function getConfig(key: string): string | undefined;
declare function unsetConfig(key: string): {
    scope: Scope;
    removed: boolean;
};
declare function listConfig(): Record<string, string>;
declare function configStorePath(): string;
declare function applyConfigToProcessEnv(): void;

export { type Scope, applyConfigToProcessEnv, configStorePath, effectiveScope, getConfig, listConfig, loadDotenv, loadJsonConfig, setConfig, unsetConfig };
