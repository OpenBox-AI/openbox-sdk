// Sub-path entry: `import { resolveOsPath } from 'openbox-sdk/os-paths';`
// Node-only - uses `os.homedir()` and `path.join()`. Kept off the
// `openbox-sdk/env` default entry so React Native / browser consumers
// don't pull these through their bundler.
export * from 'openbox-sdk/env/os-paths';
