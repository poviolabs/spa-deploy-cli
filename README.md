# SPA Deploy CLI

Use this tool to deploy a SPA to AWS with CI or manually.

Features:
 - Targeted CloudFront invalidation
 - Environment and AWS credentials storage conventions
 - CircleCI and Bitbucket Pipelines examples
 - Embedded Version and Release ( eg: for Sentry )
 - Build uplifting ( dev -> stg -> prd )

Examples:
 - [React with CRA/Craco](./examples/react-craco)

# Install

Install this package

```
yarn add spa-deploy-cli@poviolabs/spa-deploy-cli#v1
```

# Set up

Add this snippet to the `head` section in the main `index.html`.
The content will be replaced with all APP_[VARIABLE] in the environment
at build time.

```html
<script id="env-data">
    // you can add local testing variables here, 
    // this will get overwritten at build
    window.APP_THING = "value";
</script>
```

Ignore .secret env files
```gitignore
.env.*.secrets
```

## Required environment

You can set these in .env.[stage][.secrets] or just in the CI

.env.[stage]
```dotenv
DEPLOY_BUCKET=
AWS_REGION=us-east-1
DISTRIBUTION_ID= # optional, will invalidate CF cache
INDEX_FILES=index.html # optional, comma separated file names
BUILD_PATH=./build # optional, defaults to `${__dirname}/build`
```

.env.stage.secrets
```dotenv
AWS_ACCESS_KEY_ID= 
AWS_SECRET_ACCESS_KEY=
```

## Per stage overrides

Some CI services are limited to one set of variables, you can use a
prefix `STAGE_[stage]`, that will get used at build.

```
Example: `STAGE_myapp_dev_AWS_REGION=eu-central-1`
will get changed into`AWS_REGION=eu-central-1`.
```


# Manual deploy

```
STAGE=myapp-dev VERSION=myapp-dev-0.0.1 yarn spa-deploy-cli
```
