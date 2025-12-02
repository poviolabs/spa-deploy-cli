#!/usr/bin/env node

import { deployCommand } from "./commands/deploy.command";
import { injectCommand } from "./commands/inject.command";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.log(`
NAME:
  spa-deploy - Deploy a Single Page Application

USAGE:
  Deploy a Single Page Application

  Documentation is available at https://github.com/povio/spa-deploy-cli
  
VERSION:
  ${process.env.SPA_DEPLOY_VERSION} 

AUTHOR:
  {Marko Zabreznik marko.zabreznik@povio.com}

COMMANDS
  inject - Inject environment variables into SPA
  deploy - Deploy a Single Page Application
  
COPYRIGHT:
  (c) 2025 Povio inc., All rights reserved.
`);
  process.exit(1);
}

switch (command) {
  case "inject":
    injectCommand(args);
    break;
    
  case "deploy":
    deployCommand(args);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
