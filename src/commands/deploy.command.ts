import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTemplate } from "@povio/resolve-config";
import * as z from "zod";

import { getArgs } from "../helpers/args";
import { Logger } from "../helpers/logger";
import { executeDeploy } from "../lib/deploy";

const commandSchema = z.object({
  cwd: z.string().default(process.cwd()),
  stage: z.string(),
  target: z.string().optional(),
  verbose: z.boolean().optional().default(false),
  module: z.string().default("spa"),
  purge: z.boolean().optional().default(false),
  force: z.boolean().optional().default(false),
  scan: z.boolean().optional().default(false),
  apply: z.boolean().optional().default(false),
  concurrency: z.number().optional().default(5),
  help: z.boolean().optional().default(false),
});

export async function deployCommand(argv: string[]) {
  const args = getArgs(argv, {
    config: commandSchema,
    envs: {
      stage: "STAGE",
    },
  });
  const logger = new Logger(args.verbose);
  await deployCommandHandler(args, logger);
}

export async function deployCommandHandler(
  options: {
    cwd: string;
    stage: string;
    target?: string | null;
    verbose: boolean;
    purge: boolean;
    force: boolean;
    apply: boolean;
    module: string;
    scan: boolean;
    concurrency: number;
    help: boolean;
  },
  logger: Logger = new Logger(false),
) {
  const { cwd, stage, target, purge, force, apply, scan, module, help, verbose, concurrency } = options;

  logger.info(`SPA DEPLOY CLI: ${process.env.SPA_DEPLOY_VERSION}`);
  logger.info(`% CWD: ${cwd}`);
  logger.info(`% Stage: ${stage}`);
  logger.info(`% Module: ${module}`);
  logger.info(`% Target: ${target ?? 'default'}`);
  if (target) logger.info(`% Target: ${target}`);
  if (purge) logger.info(`% Purge: remove unknown files from S3`);
  if (force) logger.info(`% Force: replace files and update`);
  logger.info("--------------------------------");


  if (help) {
    logger.info(`Usage: spa-deploy deploy --stage ${stage} --apply`);
    logger.info(`  --purge: remove unknown files from S3`);
    logger.info(`  --force: replace files and update`);
    logger.info(`  --apply: apply changes, dry run is default`);
    logger.info(`  --module: use another name for config, eq ".config/${stage}.${module}$.yml"`);
    logger.info(`  --stage: set the environment ".config/${stage}.spa.yml"`);
    logger.info(`  --verbose: output all logs`);
    logger.info(`  --cwd: run in another directory`);
    process.exit(0);
  }

  logger.info(`${apply ? "> Applying" : "> Dry run"} ${stage}...`);


  try {
    const configs = await (async () => {
      let config = await resolveTemplate({ cwd, stage, module }) as any;
      return Array.isArray(config.deploy) ? config.deploy : [config.deploy];
    })();

    for (const config of configs) {
      if (target) {
        if (config.name !== target) continue;
        logger.info(`> Deploying target: ${config.name || "default"}`);
      }

      if (!config.prefix) {
        logger.error(`Prefix is required for deployment`);
        logger.debug(`Config: ${JSON.stringify(config)}`);
        process.exit(1);
      }

      const prefix = config.prefix || "dist";
      const sourcePath = resolve(cwd, prefix);

      if (!existsSync(sourcePath) || !lstatSync(sourcePath).isDirectory()) {
        logger.error(`prefix does not exist or is not a directory: ${sourcePath}`);
        process.exit(1);
      }

      const result = await executeDeploy(
        {
          ...config,
          prefix: sourcePath,
        },
        {
          apply: apply,
          force: !!force,
          purge: !!purge,
          scan: !!scan,
          concurrency: concurrency,
        },
        logger
      );

      switch (result.result) {
        case "no-changes":
        case "success":
          break;
        default:
          logger.error(`Deployment failed: ${result.result}`);
          process.exit(1);
      }
    }

  } catch (error: any) {
    logger.error("Deployment failed", error);
    process.exit(1);
  }
}