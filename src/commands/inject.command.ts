import yargs from "yargs";
import { logBanner, logVariable } from "../helpers/cli.helper";
import { getVersion } from "../helpers/version.helper";

import { getBuilder, YargOption, YargsOptions } from "../helpers/yargs.helper";
import { inject } from "./inject";

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
      logBanner(`SPA Deploy ${getVersion()}`);
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
