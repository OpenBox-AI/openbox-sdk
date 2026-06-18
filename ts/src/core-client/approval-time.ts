export function parseApprovalExpirationMs(
  value: string | null | undefined,
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const withTimezone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const timestamp = new Date(withTimezone).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
