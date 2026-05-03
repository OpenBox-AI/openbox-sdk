// Trust-tier color tokens for approval rows. Returns hex strings; the
// consumer wraps these in its own style primitive (RN ViewStyle, CSS
// color, VS Code ThemeColor adapter, etc.) so this module stays
// platform-agnostic.
//
// Tier mapping:
//   4+: green   (low risk / high trust)
//   3 : blue    (default brand)
//   2 : orange  (caution)
//   1 : red     (high risk)
//   undefined: neutral gray

const BRAND_PRIMARY = '#3b9eff';

export function tierColor(tier?: number | null): string {
  if (tier == null) return '#8E8E93';
  if (tier >= 4) return '#30D158';
  if (tier === 3) return BRAND_PRIMARY;
  if (tier === 2) return '#FF9F0A';
  return '#FF453A';
}

export function tierBg(tier?: number | null): string {
  const c = tierColor(tier);
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},0.15)`;
}
