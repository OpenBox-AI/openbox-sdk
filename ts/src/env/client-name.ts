// Hand-written X-Openbox-Client header composer. Implements the
// ClientNameResolver interface from specs/typespec/env/main.tsp; the
// regex constant CLIENT_VARIANT_PATTERN is generated from the same
// spec via the @token_format decorator on ClientVariant.value, so
// the allowed character set lives in exactly one place.
//
// Backend treats the header as presence-only; value is a telemetry
// dimension, but the more it tells, the more useful it is in logs.
//
// The base name says which component is calling (openbox-cli,
// runtime/mcp, apps/extension, ...). The optional variant says
// who/what is driving it (claude-code, codex, cursor, etc.).
// Combined: 'openbox-cli/claude-code'.

import {
  CLIENT_VARIANT_PATTERN,
  type ClientNameResolver,
} from './generated/env-bindings.js';

export const resolveClientName: ClientNameResolver['resolveClientName'] = (base, variant) => {
  const raw = variant;
  if (!raw) return base;
  const trimmed = raw.trim();
  if (!trimmed) return base;
  if (!CLIENT_VARIANT_PATTERN.test(trimmed)) {
    console.error(
      `[openbox] client variant '${trimmed}' contains invalid characters; ignoring. ` +
        `Allowed: letters, digits, '.', '_', '+', '-'.`,
    );
    return base;
  }
  return `${base}/${trimmed}`;
};
