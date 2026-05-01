// Thin wrapper over `_shared/logger.createLogger`; only the adapter
// name differs between runtimes.
import { createLogger } from '../_shared/logger.js';

const _logger = createLogger('claude-code');
export const initLogger = _logger.initLogger;
export const log = _logger.log;
