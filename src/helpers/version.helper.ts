/**
 * Fetch the version from package.json
 */
export function getVersion(): string | undefined {
  return process.env.ECS_DEPLOY_VERSION;
}
