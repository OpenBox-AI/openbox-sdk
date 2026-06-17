function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function filePathFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    toolInput.notebook_path,
  );
}

export function httpTargetFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.url,
    toolInput.uri,
    toolInput.href,
    toolInput.query,
  );
}

export function httpMethodFor(toolInput: Record<string, unknown>): string {
  return firstString(
    toolInput.method,
    toolInput.http_method,
    toolInput.httpMethod,
  )?.toUpperCase() ?? 'GET';
}
