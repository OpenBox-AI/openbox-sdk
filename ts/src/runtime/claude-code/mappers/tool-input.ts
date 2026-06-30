/**
 * Tool-input extractors for the claude-code mapper family.
 *
 * The implementations now live in the single canonical source at
 * `ts/src/internal/tool-input.ts`. This module re-exports them so the existing
 * import sites (claude-code pre/post/permission mappers, cursor + codex
 * mappers) keep importing the same names from here. Single source, no drift.
 */
export {
  filePathFor,
  httpTargetFor,
  httpMethodFor,
  dbStatementFor,
  dbSystemFor,
  dbOperationFor,
  isDatabaseMcpTool,
  isHttpMcpTool,
} from '../../../internal/tool-input.js';
