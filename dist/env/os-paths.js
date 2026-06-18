// ts/src/env/os-paths.ts
import { join, resolve } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};
export {
  openboxDataRoot,
  resolveOsPath
};
