/**
 * PovioLabs SPA Deploy Script Helpers
 *
 * To add a env variable to production, add it as prefixed with
 *  `STAGE_[stage]_` to the build env.
 *
 * Is is generally not recommended to change this script,
 *  if there are issues or missing features, consort the
 *  maintainer at https://github.com/poviolabs/terraform-template
 *
 * @version 1.2
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

/**
 * Load from .env.${STAGE||local} or .env
 *  - override values with prefixes if they exist
 */
export function parseDotEnv(
  roots: string[] = [path.join(__dirname, "..")],
  stage: string
): Record<string, string> {
  const out: Record<string, any> = { ...process.env };
  const ustage = stage.replace(/-/g, "_");
  for (const root of roots) {
    if (fs.existsSync(root)) {
      // eslint-disable-next-line no-console
      for (const [key, value] of Object.entries(
        dotenv.parse(fs.readFileSync(root))
      )) {
        if (key.startsWith(`STAGE_${stage}_`)) {
          out[key.replace(`STAGE_${stage}_`, "")] = value;
        } else {
          // underscore fallback
          if (key.startsWith(`STAGE_${ustage}_`)) {
            out[key.replace(`STAGE_${ustage}_`, "")] = value;
          }
        }
      }
    } else {
      console.log(`NOTICE: ${root} does not exist`);
    }
  }
  // override with env
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(`STAGE_${stage}_`)) {
      out[key.replace(`STAGE_${stage}_`, "")] = value;
    } else {
      // underscore fallback

      if (key.startsWith(`STAGE_${ustage}_`)) {
        out[key.replace(`STAGE_${ustage}_`, "")] = value;
      }
    }
  }
  return out;
}
