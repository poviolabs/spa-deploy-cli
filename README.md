# SPA Deploy CLI

Use this tool to deploy a SPA to AWS with CI or manually.

Features:
 - Targeted CloudFront invalidation and caching
 - CircleCI, Bitbucket, and  GitHub Actions examples
 - Embedded Globals and Build uplifting ( dev -> stg -> prd )
- Uses the [node-stage](https://github.com/poviolabs/node-stage) tool for configuration.

Examples:
 - [Vue Basic](./examples/vue-basic)

# Setup

```bash
yarn add spa-deploy-cli@poviolabs/spa-deploy-cli#v3

# update
yarn up spa-deploy-cli@poviolabs/spa-deploy-cli#v3
```

or install globally 

```bash
npm i -g spa-deploy-cli@poviolabs/spa-deploy-cli#v3 --force
```

## Full config.yaml

Please see the [examples](./examples/vue-basic/config.yaml) for sane defaults!

```yaml

stages:
  myapp-dev: # one stage per deploy
    spaDeploy:
      verbose: false
      buildPath: "./dist"
      includeGlob: "**"
      ignoreGlob:
        
      aws:
        region: us-east-1
        accountId:
        
      s3:
        acl: "public-read"
        bucket: myapp-dev-website
        prefix:
        purge: false
        force: false
        invalidateGlob: # extra glob for invalidation
      
      cloudfront:
        distributionId:
          - CF324365475432
        invalidatePaths:

      releaseStrategy:
  
    spaIndexGlob: index.html
  
    # inject variables into the website
    spaGlobals:
      # APP_STAGE: automatic via stage
      # APP_VERSION: automatic via appVersion option
      # APP_RELEASE: automatic via git
  
    ## dotenv overrides
    # envFiles: [ '.env.myapp-dev.secrets' ]
    ## environment overrides
    # environment:
    #  app__spaDeploy__s3__bucket: myapp-dev-website
```

## Injecting globals

Add this snippet to the `head` section in the main `index.html`.
The content will be replaced with `spaGlobals` in the environment
at build time.

```html
<script id="env-data">
    // you can add local testing variables here,
    // this will get overwritten at build
    window.APP_STAGE = "myapp-stg";
</script>
```

## Local Deploy

Check the examples for CI deploy strategies or you can manually deploy with setting up the AWS environment:

config.local.yaml  (don't forget to gitignore!)
```yaml
stages:
  myapp-dev:
    environment:
      AWS_ACCESS_KEY_ID: 
      AWS_SECRET_ACCESS_KEY:
```

```bash
yarn spa-deploy-cli deploy --stage myapp-stg --appVersion 0.0.1
```

# spa-deploy-cli deploy

Descriptions for useful flags. Use `--help` for a comprehensive list

### --stage

The slug of the deployment (ie. prd/stg/dev). Used in config.yaml.

### --appVersion

Version of the deploy. Tied to a specific Release and Stage. 
If supplied with a semver format, the version will be prefixed with `${STAGE}`

### --ignoreGitChanges

Use this flag while debugging the build. This might have unintended consequences - never deploy a build made using this flag.

### --verbose

Display more output

# Development

## Test locally

```bash
# test with ts-node
yarn test:ts-node:cli --help

# build new version
yarn build

# test build
yarn test --help
```
