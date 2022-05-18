/*
  Deploy files to S3
 */

import yargs from "yargs";
import path from "path";
import fs from "fs";
import micromatch from "micromatch";

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
import {
  executeS3SyncPlan,
  prepareS3SyncPlan,
  printS3SyncPlan,
} from "~aws.helpers";

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
    envAlias: "APP_VERSION",
    envAliases: ["CIRCLE_TAG", "BITBUCKET_TAG"],
    type: "string",
    alias: "ecsVersion",
  })
  appVersion: string;

  @Option({
    default: "gitsha",
    choices: ["gitsha", "gitsha-stage"],
    type: "string",
  })
  releaseStrategy: "gitsha" | "gitsha-stage";

  @Option({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges: boolean;

  @Option({ describe: "Remove all undefined files from S3" })
  purge: boolean;

  @Option({ describe: "Replace all files even if not changed" })
  force: boolean;

  @Option({ envAlias: "VERBOSE", default: false })
  verbose: boolean;

  @Option({ envAlias: "CI" })
  ci: boolean;

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

    const pwd = argv.pwd;
    variable("PWD", pwd);
    variable("NODE_VERSION", process.version);

    variable("GIT_CLI_VERSION", await getGitVersion(pwd));

    const stage = argv.stage;
    if (stage) {
      // get current STAGE if set
      // CI would not use this for builds
      variable("STAGE", argv.stage);
    }

    if (!argv.ci) {
      cli.info("Running Interactively");
    }

    const verbose = !!argv.verbose;

    const gitChanges = await getGitChanges(pwd);
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
        return process.exit(1);
      }
    }

    cli.banner("Build Environment");

    const buildPath = path.join(pwd, argv.config.buildPath || "dist");
    cli.variable("app__buildPath", buildPath);
    if (!fs.lstatSync(buildPath).isDirectory()) {
      cli.error(`Build path ${buildPath} is not a directory.`);
      return process.exit(1);
    }

    const release = argv.release;
    cli.variable("RELEASE", argv.release);

    cli.banner("App Environment");

    let version = argv.appVersion;
    if (!version) {
      version = `${stage}-${release}`;
    } else if (/^[\d.]+$/.exec(version)) {
      // if just the semver is passed in, prefix it!
      version = `${stage}-${version}`;
    }

    const prodEnv: Record<string, string> = {
      ...(argv.config.spaEnv ? argv.config.spaEnv : {}),
      APP_STAGE: stage,
      APP_VERSION: version,
      APP_RELEASE: release,
    };

    for (const [k, v] of Object.entries(prodEnv)) {
      cli.variable(k, v);
    }

    cli.banner("Deploy Environment");

    const awsRegion = argv.config.aws?.region;
    if (!awsRegion) {
      cli.error(`AWS Region is not set`);
      return process.exit(1);
    }
    cli.variable("app__aws__region", awsRegion);

    if (argv.config.aws?.endpoint) {
      cli.variable("app__aws__endpoint", argv.config.aws?.endpoint);
    }

    const deployBucket = argv.config.s3?.deployBucket;
    if (!deployBucket) {
      cli.error(`S3 Deploy Bucket is not set`);
      return process.exit(1);
    }

    if (argv.config.s3?.prefix) {
      cli.variable("app__s3__prefix", argv.config.s3?.prefix);
    }

    const s3Options = {
      region: awsRegion,
      bucket: deployBucket,
      endpoint: argv.config.aws?.endpoint,
      prefix: argv.config.s3?.prefix,
      force: argv.force,
      purge: argv.purge,
      invalidateGlob: argv.config.s3?.invalidateGlob,
      acl: argv.config.s3?.acl,
    };

    // prepare sync plan
    const plan = await prepareS3SyncPlan(
      {
        path: buildPath,
        include_glob: argv.config.spa_deploy?.include_glob,
        ignore_glob: argv.config.spa_deploy?.ignore_glob,
      },
      s3Options
    );

    // inject globals into index files
    const indexFiles = argv.config.spaIndexGlob
      ? micromatch(Object.keys(plan), argv.config.spaIndexGlob)
      : [];
    if (indexFiles.length > 0) {
      const injectedData = `<script id="env-data">${Object.entries(prodEnv)
        .map(([k, v]) => {
          return `window.${k}='${v}'`;
        })
        .join(";")}</script>`;

      for (const path of indexFiles) {
        plan[path].transformers = [
          ...(plan[path].transformers || []),
          (fileContents) => {
            return fileContents.replace(
              /<script id="env-data">[^<]*<\/script>/,
              injectedData
            );
          },
        ];
      }
    }

    printS3SyncPlan(plan, true, verbose);

    if (!argv.ci) {
      if (!(await cli.confirm("Press enter to deploy S3..."))) {
        cli.info("Canceled");
        return;
      }
    }

    // execute file sync
    await executeS3SyncPlan(plan, s3Options);

    // todo execute cloudfront invalidation
  },
};
