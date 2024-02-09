/*
 Bootstrap the app with a config file
 */

import yargs from "yargs";
import { logBanner, logVariable } from "../helpers/cli.helper";
import { getVersion } from "../helpers/version.helper";

import { getBuilder, YargOption, YargsOptions } from "../helpers/yargs.helper";

import { bootstrap } from "./bootstrap";

class BootstrapOptions implements YargsOptions {
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
  command: "bootstrap [target]",
  describe: "Bootstrap the app with a config file",
  builder: getBuilder(BootstrapOptions),
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as BootstrapOptions;
    if (argv.verbose) {
      logBanner(`SPA Deploy ${getVersion()}`);
      logVariable("nodejs", process.version);
      logVariable("pwd", argv.pwd);
      logVariable("release", argv.release);
      logVariable("stage", argv.stage);
      logVariable("target", argv.target);
    }
    return bootstrap(argv);
  },
};
