#!/bin/sh

yarn ncc build src/deploy.ts -o bin

echo '#!/usr/bin/env node\n' > ./bin/spa-deploy-cli
cat ./bin/index.js >> ./bin/spa-deploy-cli
chmod +x ./bin/spa-deploy-cli
rm ./bin/index.js
