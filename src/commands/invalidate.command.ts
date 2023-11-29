import yargs from "yargs";
import { z } from "zod";
import { getVersion } from "../helpers/version.helper";

import { getBuilder, YargOption, YargsOptions } from "../helpers/yargs.helper";
import {
  logBanner,
  logInfo,
  logVariable,
  logWarning,
} from "../helpers/cli.helper";
import { executeCloudfrontInvalidation } from "../helpers/aws-cloudfront.helper";
import { safeLoadConfig } from "../helpers/ze-config";

import { CloudfrontConfig } from "./invalidate";

class InvalidateOptions implements YargsOptions {
  @YargOption({ envAlias: "RELEASE", demandOption: true })
  release!: string;

  @YargOption({ envAlias: "PWD", demandOption: true })
  pwd!: string;

  @YargOption({ envAlias: "STAGE", demandOption: true })
  stage!: string;

  @YargOption({ default: false })
  target!: string;

  @YargOption({ envAlias: "VERBOSE", default: false })
  verbose!: boolean;
}

export const command: yargs.CommandModule = {
  command: "invalidate [target]",
  describe: "Deploy SPA to target",
  builder: getBuilder(InvalidateOptions),
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as InvalidateOptions;
    if (argv.verbose) {
      logBanner(`SPA Deploy ${getVersion()}`);
      logVariable("nodejs", process.version);
      logVariable("pwd", argv.pwd);
      logVariable("stage", argv.stage);
    }

    const InvalidateConfigItem = z.object({
      name: z.string(),
      cloudfront: CloudfrontConfig,
    });

    const config = await safeLoadConfig(
      "spa-deploy",
      argv.pwd,
      argv.stage,
      z.object({
        deploy: z
          .union([
            InvalidateConfigItem.extend({ name: z.string().optional() }),
            InvalidateConfigItem.array(),
          ])
          .transform((val) => (Array.isArray(val) ? val : [val])),
        aws: z
          .object({
            region: z.string().optional(),
            accountId: z.string().optional(),
            endpoint: z.string().optional(),
          })
          .optional(),
      }),
      false,
    );

    for (const d of config.deploy) {
      if (argv.target && d.name !== argv.target) {
        continue;
      }

      if (!d.cloudfront) {
        continue;
      }

      const region = d.cloudfront.region || config.aws?.region;
      if (!region) {
        logWarning("Missing region");
        continue;
      }

      const cloudfrontInvalidations = d.cloudfront.invalidatePaths || [];
      const cloudfrontIds = d.cloudfront.distributionId || [];
      if (cloudfrontInvalidations.length > 0) {
        logBanner(`Cloudfront invalidations`);
        for (const i of cloudfrontInvalidations) {
          console.log(i);
        }
        if (cloudfrontIds.length < 1) {
          logWarning(`Cloudfront distributionId is not set`);
        }
        await executeCloudfrontInvalidation(
          cloudfrontInvalidations,
          cloudfrontIds,
          region,
        );
      } else {
        logInfo(`No cloudfront invalidations`);
      }
    }
  },
};
