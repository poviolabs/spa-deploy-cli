import yargs from "yargs";
import { getVersion } from "../helpers/version.helper";

import { getBuilder, YargOption, YargsOptions } from "../helpers/yargs.helper";

import { logBanner, logInfo, logVariable } from "../helpers/cli.helper";
import { detectGitChanges } from "../helpers/git.helper";
import { deploy } from "./deploy";

class DeployOptions implements YargsOptions {
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

  @YargOption({ envAlias: "CI" })
  ci!: boolean;

  @YargOption({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges!: boolean;

  @YargOption({ describe: "Remove all undefined files from S3" })
  purge!: boolean;

  @YargOption({ describe: "Replace all files even if not changed" })
  force!: boolean;
}

export const command: yargs.CommandModule = {
  command: "deploy [target]",
  describe: "Deploy SPA to target",
  builder: getBuilder(DeployOptions),
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as DeployOptions;
    if (argv.verbose) {
      logBanner(`SPA Deploy ${getVersion()}`);
      logVariable("nodejs", process.version);
      logVariable("pwd", argv.pwd);
      logVariable("release", argv.release);
      logVariable("stage", argv.stage);
    }

    if (argv.ci) {
      if (argv.verbose) logInfo("Running Non-Interactively");
    } else {
      await detectGitChanges(argv.pwd, argv.ignoreGitChanges);
    }

    return deploy({
      pwd: argv.pwd,
      stage: argv.stage,
      release: argv.release,
      target: argv.target,
      verbose: argv.verbose,
      purge: argv.purge,
      force: argv.force,
    });
  },
};
