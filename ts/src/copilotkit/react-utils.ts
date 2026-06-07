import React, { useEffect } from 'react';
import { openBoxRendererCss } from './react-styles.js';
import type { OpenBoxRendererTheme } from './react-types.js';

export function buttonClass(kind: 'primary' | 'secondary') {
  const base =
    'inline-flex flex-1 items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60';
  if (kind === 'primary')
    return `${base} bg-[var(--obx-accent,#3B9AF5)] text-white hover:bg-[#1F7FD8]`;
  return `${base} border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]`;
}

export function parseToolResult(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : {};
}

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : {};
}

export function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

export function resolveTheme(
  theme?: OpenBoxRendererTheme,
  logoSrc?: string,
): OpenBoxRendererTheme {
  return {
    mode: 'auto',
    density: 'comfortable',
    accentColor: '#3B9AF5',
    radius: 8,
    ...theme,
    logoSrc: theme?.logoSrc ?? logoSrc,
  };
}

export function rendererStyle(
  theme: OpenBoxRendererTheme,
): React.CSSProperties {
  const radius =
    typeof theme.radius === 'number' ? `${theme.radius}px` : theme.radius;
  return {
    '--obx-accent': theme.accentColor ?? '#3B9AF5',
    '--obx-radius': radius ?? '8px',
    '--obx-density-scale': theme.density === 'compact' ? '0.82' : '1',
  } as React.CSSProperties;
}

export function useOpenBoxRendererStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('openbox-copilotkit-renderer-styles')) return;
    const style = document.createElement('style');
    style.id = 'openbox-copilotkit-renderer-styles';
    style.textContent = openBoxRendererCss;
    document.head.appendChild(style);
  }, []);
}

export function asNode(value: unknown): React.ReactNode | undefined {
  return React.isValidElement(value) ||
    typeof value === 'string' ||
    typeof value === 'number'
    ? value
    : value === null || value === undefined
      ? undefined
      : undefined;
}
