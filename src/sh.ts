#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { command as injectCommand } from "./commands/inject.command";
import { command as deployCommand } from "./commands/deploy.command";
import { command as invalidateCommand } from "./commands/invalidate.command";
import { logError, logInfo } from "./helpers/cli.helper";

import { getVersion } from "./helpers/version.helper";

yargs(hideBin(process.argv))
  .version(getVersion() || "unknown")
  .scriptName("spa-deploy")
  .command(injectCommand)
  .command(deployCommand)
  .command(invalidateCommand)
  .help()
  .demandCommand(1)
  .strictCommands(true)
  .showHelpOnFail(true)
  .fail((msg, err) => {
    if (msg) logError(msg);
    if (err) logError(err);
    logInfo("Use '--help' for more info");
    process.exit(1);
  })
  .parse();
