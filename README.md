# SPA Deploy CLI

Use this tool to deploy a SPA to AWS with CI or manually.

Features:
 - Targeted CloudFront invalidation and caching
 - CircleCI, Bitbucket, and  GitHub Actions examples
 - Embedded Globals and Build uplifting ( dev -> stg -> prd )
 - Uses the config.yaml structure

Examples:
 - [Vue Basic](./examples/vue-basic)

# Setup

```bash
yarn add spa-deploy-cli@poviolabs/spa-deploy-cli#v1

# update
yarn up spa-deploy-cli@poviolabs/spa-deploy-cli
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
  
    slackNotify:
      channel: C03AXDS9F2B
      autolinkPrefix: SP-
      autolinkTarget: https://github.com/poviolabs/spa-deploy-cli/issues/
      commitPrefix: https://github.com/poviolabs/spa-deploy-cli/commit/
      projectName: SPA-Deploy
  
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

### --pwd

Root from where to fetch `config.yaml` and the base for all relative paths.

### --stage

The slug of the deployment (ie. prd/stg/dev). Used in config.yaml.

### --release 

Release of the build (ie the git sha) and is unique per code.

### --appVersion

Version of the deploy. Tied to a specific Release and Stage. 
If supplied with a semver format, the version will be prefixed with `${STAGE}`

### --releaseStrategy

- gitsha - make the same build for all stages
- gitsha-stage - make a build based on the stage and git sha in cases where the build is different per stage

### --ignoreGitChanges

Use this flag while debugging the build. This might have unintended consequences - never deploy a build made using this flag.

### --verbose

Display more output

# spa-deploy-cli slack

### --message

Any text appended to the Slack message

```
yarn ecs-deploy-cli slack --messageType success --message A custom message!
```

### --messageType

- `success`
- `failure`
- `info`

# Development

## Test locally

```bash
# test with ts-node
yarn test:ts-node --help

# build new version
yarn build

# test build
yarn test --help
```

## Analyze package
npx webpack-bundle-analyzer ./dist/stats.json

### Overriding config and global prefix

```yaml
CONFIG_PREFIX=app
CONFIG_FILE=config.yaml
```
