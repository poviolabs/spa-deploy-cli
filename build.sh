#!/bin/sh

yarn ncc build src/deploy.ts -o bin

SHEBANG='#!/usr/bin/env node\n'
echo "${SHEBANG}$(cat ./bin/index.js)" > ./bin/index.js

