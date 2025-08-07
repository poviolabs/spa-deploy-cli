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

Running without installing. Make sure to lock the version, check the latest version on npm.

```
yarn dlx @povio/spa-deploy-cli@4.2
```

If using yarn cache, you can install the package:

```bash
yarn add @povio/spa-deploy-cli
```

# Configure

```yaml
accountId: "000000000000"
region: us-east-1

# Static SPA deploy config
deploy:
    buildPath: "./dist"
      
    # only include local files matching this glob
    #includeGlob: 
    # - glob: "**.css"
    #   cacheControl: "max-age=2628000, public"
      
    # exclude local and remote files matching this glob
    #ignoreGlob: "**.css"
        
    s3:
        bucket: myapp-dev-website
        
        # prefix to upload to, default is root
        #prefix:
        
        # delete all ignored/unknown files
        #  use `--dry-run` to see what would be deleted
        #purge: false
        
        # re-upload even if the file is the same (also updates cacheControl)
        #force: false

        # Control individual file invalidations when files change during deployment
        # false (default): create individual CloudFront invalidation paths for each changed file
        # true: skip individual file invalidations, rely only on cloudfront.invalidatePaths
        # Set to true when using wildcard invalidatePaths (e.g. "/*") to reduce CloudFront costs
        #skipChangesInvalidation: false
        
        # default cache control
        #cacheControl: "max-age=2628000, public"
        
        # pattern match cache control, first match wins, default is cacheControl
        #cacheControlGlob:
        # - glob: "*.html"
        #   cacheControl: "no-cache, no-store, must-revalidate"
        
        # @deprecated - set matching files to "public, must-revalidate"
        #invalidateGlob: "*.html"
        
        # set ACL, not needed if using bucket policy
        #acl: "public-read"
          
    cloudfront:
        distributionId: CF000000000000
        invalidatePaths: "/*"

# Environment file config
configs:
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
      - name: "@"
        configFrom: base.template
    
        # simple value mapping
      - name: database__password
        valueFrom: arn:aws:ssm:::parameter/myapp-dev/database/password
    
        # JSON object mapping
      - name: database
        valueFrom: arn:aws:ssm:::parameter/myapp-dev/database
    
      - name: database__host
        valueFrom: env:DATABASE_HOST
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
yarn spa-deploy bootstrap --stage myapp-stg
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
# prerequisites
corepack install
yarn

# run tests
yarn test

# run sources with tsx
yarn start --help
yarn start bootstrap --pwd ./test --stage myapp-dev

# build new version
yarn build

# test build
yarn start:prod --help
yarn start:dist bootstrap --pwd ./test --stage myapp-dev

# test deploy
yarn start:dist deploy --pwd ./test --stage myapp-dev

```
