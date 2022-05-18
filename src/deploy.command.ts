/*

 */

import yargs from "yargs";
import path from "path";

import cli, { banner, variable } from "~cli.helper";
import { getGitChanges, getGitVersion, getRelease } from "~git.helper";
import {
  Option,
  getYargsOptions,
  loadYargsConfig,
  Config,
  YargsOptions,
} from "~yargs.helper";
import process from "process";
import { prepareS3SyncPlan } from "~aws.helpers";

const { version: spaDeployVersion } = require("../package.json");

class SpaBuildOptions extends YargsOptions {
  @Option({ envAlias: "PWD", demandOption: true })
  pwd: string;

  @Option({ envAlias: "STAGE", demandOption: true })
  stage: string;

  @Option({
    envAlias: "RELEASE",
    envAliases: ["CIRCLE_SHA1", "BITBUCKET_COMMIT", "GITHUB_SHA"],
    demandOption: true,
  })
  release: string;

  @Option({
    envAlias: "RELEASE_STRATEGY",
    default: "gitsha",
    choices: ["gitsha", "gitsha-stage"],
    type: "string",
  })
  releaseStrategy: "gitsha" | "gitsha-stage";

  @Option({
    envAlias: "APP_VERSION",
    envAliases: ["CIRCLE_TAG", "BITBUCKET_TAG"],
    type: "string",
    alias: "ecsVersion",
  })
  appVersion: string;

  @Option({ envAlias: "AWS_REGION", demandOption: true })
  awsRegion: string;

  @Option({ envAlias: "AWS_ACCOUNT_ID", demandOption: true })
  awsAccountId: string;

  @Option({ envAlias: "AWS_ENDPOINT", demandOption: true })
  awsEndpoint: string;

  @Option({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges: boolean;

  @Option({ envAlias: "CI" })
  ci: boolean;

  @Option({ envAlias: "DEPLOY_BUCKET", demandOption: true })
  deployBucket: string;

  @Option({ envAlias: "DISTRIBUTION_ID" })
  distributionId: string;

  @Option({ envAlias: "BUILD_PATH", demandOption: true })
  buildPath: string;

  @Option({ envAlias: "DEPLOY_PATH" })
  deployPath: string;

  @Option({ envAlias: "VERBOSE", default: false })
  verbose: boolean;

  config: Config;
}

export const command: yargs.CommandModule = {
  command: "deploy",
  describe: "Deploy a SPA app",
  builder: async (y) => {
    return y
      .options(getYargsOptions(SpaBuildOptions))
      .middleware(async (_argv) => {
        const argv = loadYargsConfig(
          SpaBuildOptions,
          _argv as any,
          "spa_deploy"
        );
        argv.release =
          argv.release || (await getRelease(argv.pwd, argv.releaseStrategy));

        return argv as any;
      }, true);
  },
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as SpaBuildOptions;

    banner(`SPA Build ${spaDeployVersion}`);

    variable("PWD", argv.pwd);
    variable("NODE_VERSION", process.version);

    variable("GIT_CLI_VERSION", await getGitVersion(argv.pwd));

    if (argv.stage) {
      // get current STAGE if set
      // CI would not use this for builds
      variable("STAGE", argv.stage);
    }

    if (!argv.ci) {
      cli.info("Running Interactively");
    }

    const gitChanges = await getGitChanges(argv.pwd);
    if (gitChanges !== "") {
      if (argv.ignoreGitChanges) {
        cli.warning("Changes detected in .git");
      } else {
        if (gitChanges === undefined) {
          cli.error("Error detecting Git");
        } else {
          cli.banner("Detected Changes in Git - Stage must be clean to build!");
          console.log(gitChanges);
        }
        process.exit(1);
      }
    }

    cli.banner("Build Environment");

    cli.variable("BUILD_PATH", argv.buildPath);
    cli.variable("RELEASE", argv.release);
    const buildPath = path.join(argv.pwd, argv.buildPath);
    cli.info(`Build path: ${buildPath}`);

    cli.banner("App Environment");

    const prodEnv: Record<string, string> = {
      ...(argv.config.spa_env ? argv.config.spa_env : {}),
      APP_STAGE: argv.stage,
      APP_VERSION: argv.appVersion,
      APP_RELEASE: argv.release,
    };

    for (const [k, v] of Object.entries(prodEnv)) {
      cli.variable(k, v);
    }

    /*
    if (argv.indexFiles) {
      cli.banner("Setting App Environment");

      for (const fileName of argv.indexFiles.split(",")) {
        const filePath = path.resolve(buildPath, fileName);

        const fileContents = fs.readFileSync(filePath, "utf8");

        if (!fileContents.includes('<script id="env-data">')) {
          warning(`${fileName} does not contain env-data`);
        } else {
          info(`Writing env-data into ${fileName}`);
          fs.writeFileSync(
            filePath,
            fileContents.replace(
              /<script id="env-data">[^<]*<\/script>/,
              `<script id="env-data">${Object.entries(prodEnv)
                .map(([k, v]) => {
                  return `window.${k}='${v}'`;
                })
                .join(";")}</script>`
            ),
            "utf8"
          );
        }
      }
    }

     */

    const plan = prepareS3SyncPlan(
      {
        path: buildPath,
        include_glob: argv.config.spa_deploy?.include_glob,
        ignore_glob: argv.config.spa_deploy?.ignore_glob,
      },
      {
        region: argv.s3Region,
        bucket: argv.deployBucket,
        endpoint: argv.awsEndpoint,
        prefix: argv,
      }
    );

    cli.banner("Deploy Environment");
    cli.variable("AWS_REGION", argv.awsRegion);
    cli.variable("DEPLOY_BUCKET", argv.deployBucket);
  },
};
