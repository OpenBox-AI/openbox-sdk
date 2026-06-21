import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const POSTGRES_CONTAINER_NAME =
  process.env.OPENBOX_E2E_POSTGRES_CONTAINER ?? 'openbox-local-sdk-postgres-1';

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function runLocalStackSql(sql: string): Promise<string> {
  const command = [
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    '"$POSTGRES_USER"',
    '-d',
    '"$POSTGRES_DB"',
    '-Atc',
    JSON.stringify(compactSql(sql)),
  ].join(' ');
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', POSTGRES_CONTAINER_NAME, 'sh', '-lc', command],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout;
}
