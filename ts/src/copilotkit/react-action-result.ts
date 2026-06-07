import React from 'react';
import {
  parseToolResult,
  resolveTheme,
  useOpenBoxRendererStyles,
} from './react-utils.js';
import type { OpenBoxActionResultProps } from './react-renderer-types.js';

export function OpenBoxActionResult({
  result,
  logoSrc,
  theme,
  artifactRenderers,
}: OpenBoxActionResultProps) {
  useOpenBoxRendererStyles();
  const resolvedTheme = resolveTheme(theme, logoSrc);
  const toolResult = parseToolResult(result);
  const artifact = parseToolResult(toolResult.artifact);
  if (
    (toolResult.status !== 'executed' && toolResult.status !== 'constrained') ||
    !artifact.type
  ) {
    return null;
  }
  const customRenderer = artifactRenderers?.[String(artifact.type)];
  if (customRenderer) {
    return h(
      React.Fragment,
      null,
      customRenderer({
        artifact,
        result: toolResult,
        theme: resolvedTheme,
      }),
    );
  }
  return null;
}

const h = React.createElement;
