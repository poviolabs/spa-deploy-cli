/*
 Inject environment variables into SPA
 */


import { resolve as pathResolve } from "node:path";
import * as z from "zod";

import { getArgs } from "../helpers/args";
import { Logger } from "../helpers/logger";
import { injectEnvIntoFiles } from "../lib/inject";

const commandSchema = z.object({
  cwd: z.string().default(process.cwd()),
  stage: z.string(),
  verbose: z.boolean().optional().default(false),
  target: z.string().optional().nullable(),
  module: z.string().default("spa"),
});

export async function injectCommand(argv: string[]) {
  const args = getArgs(argv, {
    config: commandSchema,
    envs: {
      stage: "STAGE",
      cwd: "CWD",
      verbose: "VERBOSE",
      target: "TARGET",
    },
  });

  const logger = new Logger(args.verbose);
  await injectCommandHandler(args, logger);
}

export async function injectCommandHandler(
  _args: {
    cwd: string;
    stage: string;

    verbose: boolean;
    target?: string | null;
    module: string;
  },
  logger: Logger = new Logger(false)
) {

  const { cwd: _cwd, stage, target, module } = _args;

  const cwd = _cwd.startsWith("/") ? _cwd : pathResolve(process.cwd(), _cwd);

  logger.info(`SPA DEPLOY CLI: ${process.env.SPA_DEPLOY_VERSION}`);
  logger.info(`- CWD: ${cwd}`);
  logger.info(`- Stage: ${stage}`);
  if (target) logger.info(`- Target: ${target}`);
  logger.info(`- Module: ${module}`);

  try {
    await injectEnvIntoFiles(
      {
        cwd,
        stage,
        module
      },
      logger
    );
  } catch (error: any) {
    logger.error("Error injecting environment variables", error);
    process.exit(1);
  }
}