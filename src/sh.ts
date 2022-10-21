#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { command as deployCommand } from "./commands/deploy.command";
import { command as invalidateCommand } from "./commands/invalidate.command";
import { logError, logInfo } from "@povio/node-stage";

import { getVersion } from "./helpers/version.helper";

yargs(hideBin(process.argv))
  .version(getVersion() || "unknown")
  .scriptName("spa-deploy-cli")
  .command(deployCommand)
  .command(invalidateCommand)
  .help()
  .demandCommand(1)
  .strictCommands(true)
  .showHelpOnFail(true)
  .fail((msg, err, yargs) => {
    if (msg) logError(msg);
    if (err) {
      if (!!process.env.VERBOSE) {
        console.error(err);
      } else {
        logError(err.message);
      }
    }
    logInfo("Use '--help' for more info");
    process.exit(1);
  })
  .parse();
