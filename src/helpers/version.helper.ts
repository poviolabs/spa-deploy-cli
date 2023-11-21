/**
 * Fetch the version from package.json
 */
export function getVersion(): string | undefined {
  return process.env.SPA_DEPLOY_VERSION;
}
