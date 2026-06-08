// ts/src/env/os-paths.ts
import { homedir } from "os";
import { join } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "openbox");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, "openbox");
  }
  return join(homedir(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};
export {
  openboxDataRoot,
  resolveOsPath
};
