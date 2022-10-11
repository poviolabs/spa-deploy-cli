#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const deploy_command_1 = require("./commands/deploy.command");
const invalidate_command_1 = require("./commands/invalidate.command");
const node_stage_1 = require("node-stage");
const version_helper_1 = require("./helpers/version.helper");
(0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .version((0, version_helper_1.getVersion)() || "unknown")
    .scriptName("spa-deploy-cli")
    .command(deploy_command_1.command)
    .command(invalidate_command_1.command)
    .help()
    .demandCommand(1)
    .strictCommands(true)
    .showHelpOnFail(true)
    .fail((msg, err, yargs) => {
    if (msg)
        (0, node_stage_1.logError)(msg);
    if (err) {
        if (!!process.env.VERBOSE) {
            console.error(err);
        }
        else {
            (0, node_stage_1.logError)(err.message);
        }
    }
    (0, node_stage_1.logInfo)("Use '--help' for more info");
    process.exit(1);
})
    .parse();
//# sourceMappingURL=sh.js.map