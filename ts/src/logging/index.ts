// Public sub-path: `openbox-sdk/logging`.
//
// Diagnostic loggers and the hook-event JSONL log. Every runtime
// adapter consumes these; any third-party consumer that wants hook
// activity surfaced through the extension's output channel can do
// the same.

export {
  createLogger,
  type LoggerConfig,
  type AdapterLogger,
} from './logger.js';
export {
  makeHookLog,
  tailHookLog,
  type HookLogger,
  type HookLogLine,
  type TailHandle,
  type TailOptions,
} from './hook-log.js';
