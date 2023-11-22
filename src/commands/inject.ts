import {
  resolveZeConfigItem,
  safeLoadConfig,
  ZeConfigs,
} from "../helpers/ze-config";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { dump } from "js-yaml";

export async function inject(argv: {
  pwd: string;
  stage: string;
  release: string;
  target?: string;
  verbose?: boolean;
}) {
  const config = await safeLoadConfig(
    "spa-deploy",
    argv.pwd,
    argv.stage,
    z.object({
      inject: ZeConfigs,
      aws: z
        .object({
          region: z.string().optional(),
        })
        .optional(),
    }),
    false,
  );

  for (const ci of config.inject) {
    if (argv.target && ci.name !== argv.target) {
      continue;
    }

    const data = await resolveZeConfigItem(
      ci,
      {
        awsRegion: config.aws?.region,
        release: argv.release,
      },
      argv.pwd,
      argv.stage,
    );

    const { destination } = ci;

    const output = generate(path.basename(destination), data);
    const outputPath = path.join(argv.pwd, destination);
    if (output) {
      console.log(`Writing ${outputPath}`);
      fs.writeFileSync(outputPath, output);
    }
  }
}

export function generate(fileName: string, data: any): string {
  if (fileName.endsWith(".json")) {
    return JSON.stringify(data, null, 2);
  } else if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) {
    return dump(data);
  } else if (fileName.endsWith(".env") || fileName.startsWith(".env")) {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") {
        lines.push(`${key}=${value}`);
      } else {
        lines.push(`${key}=${JSON.stringify(value)}`);
      }
    }
    return lines.join("\n");
  } else {
    throw new Error(`Unknown destination file type: ${fileName}`);
  }
}
