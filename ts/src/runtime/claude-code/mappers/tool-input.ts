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

export function dbStatementFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.db_statement,
    toolInput.dbStatement,
    toolInput.statement,
    toolInput.sql,
    toolInput.query,
  );
}

export function dbSystemFor(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  const explicit = firstString(
    toolInput.db_system,
    toolInput.dbSystem,
    toolInput.system,
    toolInput.database_system,
  );
  if (explicit) return explicit;
  const lowerName = toolName.toLowerCase();
  if (lowerName.includes('sqlite')) return 'sqlite';
  if (lowerName.includes('mysql')) return 'mysql';
  if (lowerName.includes('postgres')) return 'postgresql';
  return 'postgresql';
}

export function dbOperationFor(toolInput: Record<string, unknown>): string {
  const explicit = firstString(
    toolInput.db_operation,
    toolInput.dbOperation,
    toolInput.operation,
  );
  if (explicit) return explicit.toUpperCase();
  if (dbStatementFor(toolInput)) return 'QUERY';
  return 'QUERY';
}

export function isDatabaseMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  const lowerName = toolName.toLowerCase();
  const nameLooksDatabase =
    lowerName.includes('db') ||
    lowerName.includes('sql') ||
    lowerName.includes('database') ||
    lowerName.includes('postgres') ||
    lowerName.includes('mysql') ||
    lowerName.includes('sqlite');
  if (!nameLooksDatabase) return false;
  return Boolean(dbStatementFor(toolInput)) ||
    lowerName.includes('query') ||
    lowerName.includes('execute') ||
    lowerName.includes('select');
}
