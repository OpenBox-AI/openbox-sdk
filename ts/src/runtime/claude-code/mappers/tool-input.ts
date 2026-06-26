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

const SQL_VERBS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'EXPLAIN',
] as const;

function dbOperationFromStatement(statement: string | undefined): string | undefined {
  if (!statement) return undefined;
  const normalized = statement.trim().toUpperCase();
  return SQL_VERBS.find((verb) => normalized.startsWith(verb));
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
  const statementOperation = dbOperationFromStatement(dbStatementFor(toolInput));
  const explicit = firstString(
    toolInput.db_operation,
    toolInput.dbOperation,
    toolInput.operation,
  );
  const explicitOperation = explicit?.toUpperCase();
  if (
    explicitOperation &&
    explicitOperation !== 'QUERY' &&
    explicitOperation !== 'UNKNOWN'
  ) {
    return explicitOperation;
  }
  return statementOperation ?? explicitOperation ?? 'QUERY';
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

export function isHttpMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  const lowerName = toolName.toLowerCase();
  const nameLooksHttp =
    lowerName.includes('http') ||
    lowerName.includes('fetch') ||
    lowerName.includes('request') ||
    lowerName.includes('web');
  if (!nameLooksHttp) return false;
  return Boolean(httpTargetFor(toolInput)) ||
    Boolean(firstString(toolInput.method, toolInput.http_method, toolInput.httpMethod));
}
