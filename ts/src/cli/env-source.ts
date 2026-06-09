import { applyConfigToProcessEnv } from '../config/index.js';

export function applyEnvSource(): void {
  applyConfigToProcessEnv();
}

export function isDebugMode(): boolean {
  const truthy = (value: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  applyConfigToProcessEnv();
  return process.env.OPENBOX_DEBUG ? truthy(process.env.OPENBOX_DEBUG) : false;
}
