# SPA Deploy CLI

Use this tool to deploy and configure an SPA.

Features:

Static SPA deploy:
- Deploy to AWS S3
- Targeted CloudFront invalidation and caching
- Embed environment variables into HTML

Next.js Configuration:
- From SSM Parameter Store

Examples:

- [Vue Basic](./examples/vue-basic)

# Setup

```bash
yarn add @povio/spa-deploy-cli@4
```

or install globally

```bash
npm i -g @povio/spa-deploy-cli@4 --force
```

# Configure

```yaml

# Static SPA deploy config
deploy:
    buildPath: "./dist"
    includeGlob: "**"
    ignoreGlob:
        
    s3:
        acl: "public-read"
        bucket: myapp-dev-website
        prefix:
        purge: false
        force: false
        invalidateGlob: # extra glob for invalidation
          
    cloudfront:
        distributionId:
          - CF000000000000
        invalidatePaths:
          - "/*"

# Environment file config
inject:
    # Write into env file (Next.js)
    #  destination: ./.env.local
    
    # Write into yaml
    #  destination: ./production.yaml
    
    # Write into .html, in the head section or <script id="env-data"></script>
    # Warning: all values will be public
    #  destination: ./dist/index.html

    
    values:
        # load config from ./.config/${stage}.base.template.env
        # and interpolate ${arn:aws:ssm..} and ${env:ENV_VALUE} values
        # load them onto the root
      - name: @
        configFrom: base.template
    
        # simple value mapping
      - name: database__password
        valueFrom: arn:aws:ssm:::parameter/myapp-dev/database/password
    
        # JSON object mapping
      - name: database
        valueFrom: arn:aws:ssm:::parameter/myapp-dev/database
    
      - name: database__host
        valueFrom: env:DATABASE_HOST

aws:
    region: us-east-1
    accountId: 000000000000
```

### Example

Where `configFrom: base.template` and the config file is `.config/${stage}.base.template.yml`:

```yaml
APP_RELEASE: ${func:release}
APP_STAGE: ${func:stage}
APP_VERSION: ${env:APP_VERSION}
STATIC_URL: https://static.example.com
NEXT_PUBLIC_SENTRY_CDN: https://public@sentry.example.com/1
```

the output will be at the set destination, for example `.env.local`:

```
APP_RELEASE=61be6e2c61be6e2c61be6e2c61be6e2c
APP_STAGE=myapp-stg
APP_VERSION=0.0.1
STATIC_URL: https://static.example.com
NEXT_PUBLIC_SENTRY_DSN=https://public@sentry.example.com/1
```

## Injecting the environment

```bash
yarn spa-deploy inject --stage myapp-stg
```

### Pure SPA or after build time configuration

Using the `destination: ./dist/index.html` option, you can inject the environment into the HTML file.

The file will be edited in place, with the following content inserted into
the `<head>` section, replacing any existing `<script id="env-data">`:

```html
<script id="env-data">
  // you can add local testing variables here,
  // this will get overwritten at build
  window.APP_STAGE = "myapp-stg";
</script>
```

## Static SPA Deploy

```bash
yarn spa-deploy deploy --stage myapp-stg
```

# Development

## Test locally

```bash
# run tests
yarn test

# run sources with tsx
yarn start --help
yarn start inject --pwd ./test --stage myapp-dev

# build new version
yarn build

# test build
yarn start:prod --help
yarn start:dist inject --pwd ./test --stage myapp-dev
```
