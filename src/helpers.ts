/**
 * PovioLabs SPA Deploy Script Helpers
 *
 * @version 1.2
 */

import * as dotenv from "dotenv";
import * as fs from "fs";

/**
 * Load from .env.${STAGE}
 *  - use values with STAGE_[stage]_ prefixes if they exist
 */
export function parseDotEnv(
  envFiles: string[],
  stage: string
): Record<string, string> {
  let out: Record<string, any> = { };
  const ustage = stage.replace(/-/g, "_");
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      // eslint-disable-next-line no-console
      // console.log(`INFO\t Reading from ${envFile}`);
      out = { ...out, ...dotenv.parse(fs.readFileSync(envFile)) };
    }
  }
  // override with env
  for (const [key, value] of Object.entries(out)) {
    if (key.startsWith(`STAGE_${stage}_`)) {
      out[key.replace(`STAGE_${stage}_`, "")] = value;
    } else {
      // underscore fallback
      if (key.startsWith(`STAGE_${ustage}_`)) {
        out[key.replace(`STAGE_${ustage}_`, "")] = value;
      }
    }
  }
  return { ...out, ...process.env };
}
