import path from "path";
import fs from "fs";

/**
 * Fetch the version from package.json
 */
export function getVersion(
  root = path.join(__dirname, "..", "..")
): string | undefined {
  const packageJsonPath = path.join(root, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      return packageJson.version as string;
    } catch (e) {
      console.error(`[ERROR] ${(e as Error).toString()}`);
    }
  }
  return undefined;
}
