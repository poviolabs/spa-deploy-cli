import yargs from "yargs";
import {
  resolveZeConfigItem,
  safeLoadConfig,
  ZeConfigs,
} from "../helpers/ze-config.js";
import { z } from "zod";
import { logVariable } from "../helpers/cli.helper.js";
import { getVersion } from "../helpers/version.helper.js";
import fs from "fs";
import path from "path";
import { dump } from "js-yaml";

import { getBuilder, YargOption, YargsOptions } from "../helpers/yargs.helper";

class InjectOptions implements YargsOptions {
  @YargOption({ envAlias: "PWD", demandOption: true })
  pwd!: string;

  @YargOption({ envAlias: "STAGE", demandOption: true })
  stage!: string;

  @YargOption({ envAlias: "RELEASE", demandOption: true })
  release!: string;

  @YargOption({ envAlias: "VERBOSE", default: false })
  verbose!: boolean;

  @YargOption({ default: false })
  target!: string;
}

export const command: yargs.CommandModule = {
  command: "inject [target]",
  describe: "Inject config into the app",
  builder: getBuilder(InjectOptions),
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as InjectOptions;
    if (argv.verbose) {
      logVariable("spaDeploy", getVersion());
      logVariable("nodejs", process.version);
      logVariable("pwd", argv.pwd);
      logVariable("release", argv.release);
      logVariable("stage", argv.stage);
    }
    return inject({
      pwd: argv.pwd,
      stage: argv.stage,
      release: argv.release,
      target: argv.target,
      verbose: argv.verbose,
    });
  },
};

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
