// The lean CLI no longer exposes hand-written CRUD/admin command
// groups. Backend authorization is enforced by OpenBox itself for the
// compact `openbox api ...` caller. Keep this hook shape so cached
// permission checks can be reintroduced for specific stable commands
// without changing CLI middleware.

export type CommandKey = string;

export const COMMAND_PERMISSIONS: Record<CommandKey, string[]> = {};

export function missingPermissions(
  required: readonly string[],
  have: readonly string[],
): string[] {
  return required.filter((permission) => !have.includes(permission));
}
