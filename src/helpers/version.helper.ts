import path from "path";
import { getVersion as getVersionFromPackageJson } from "@povio/node-stage";

/**
 * Fetch the version from package.json
 */
export function getVersion(): string | undefined {
  return getVersionFromPackageJson(path.join(__dirname, "..", ".."));
}
