# SPA Deploy CLI

Deploy and configure an SPA. 

Features:

Static SPA deploy:
- Deploy to AWS S3
- Invalidate CloudFront based on GLOB rules
- Purge old files based on GLOB rules or a state file
- Embed environment variables into HTML

Examples:

- [Vue Basic](./examples/vue-basic)

# Setup

One time execution or installed - make sure you pin the package.

```
yarn dlx @povio/spa-deploy-cli@5.0
```

```bash
yarn add @povio/spa-deploy-cli@5.0
```


# Deploy

```bash
yarn spa-deploy deploy --stage myapp-stg --apply
```

### Arguments
 - `--purge` remove all files not defined, forces `--scan`
 - `--force` re-upload all files, even unchanged
 - `--scan` force scanning (update stateFile is set)
 - `--apply` apply changes, dry run is default
 - `--module` use another name for config, eq `.config/${stage}.${module}$.yml`
 - `--stage` set the environment `.config/${stage}.spa.yml`
 - `--verbose` output all logs
 - `--cwd` run in another directory

## Config

`.config/myapp-dev.spa.yml`
```yaml
deploy:

  context:
    # AWS details
    accountId: "000000000000"
    region: us-east-1
    
  # local prefix
  prefix: dist
  
  files:
    - includeGlob: **/*.html

      # Set cache
      cacheControl: "no-cache, no-store, must-revalidate"

      # Do not re-upload files if unchanged, requires scan or stateFile
      #skipUnchanged: false

      # Delete all non-local files, requires scan or stateFile
      #  false, true, 
      #purge: false
      
      # Targeted CloudFront invalidation, adds extra costs
      #invalidate: false

      # Override Mime Type
      #contentType: text/html

      # Override Content Disposition
      #contentDisposition: inline;

      # ACL, not required if using bucket policy
      #acl: "public-read"

      # Priority, lower number is uploaded first
      #priority: 2

      # Ignore this pattern entirely
      #ignore: false

    - includeGlob: 
        - favicon.ico
        - assets/**/*

      priority: 1
      cacheControl: "max-age=2628000, public"
      
  s3:
      bucket: myapp-dev-website
      
      # Prefix to upload to, default is root
      #prefix:

      # Fully scan remote
      #scan: false

      # Keep a state file for versioning
      #  true/false or name of file
      #stateFile: false

      # Do not re-upload files if unchanged
      #  requires scan or stateFile
      #skipUnchanged: false

      # Delete all ignored/unknown files
      #  requires scan or stateFile
      #purge: false
      
      # Set ACL, not needed if using bucket policy
      #acl: "public-read"
          
    cloudfront:
      distributionId: CF000000000000
      invalidatePaths: 
        - "/*"
```


# Injecting the environment into .html 

```bash
yarn spa-deploy inject --stage myapp-stg
```

`.config/myapp-dev.spa.yml`

## Config
```yml
inject:
  - name: "html"

    # files to replace the env into
    sourceGlob: "**/*.html"
    sourcePrefix: ./dist

    #destinationPrefix: ./dist
    
    # resolve-config configuration name and module
    config: html
    #configModule: spa

    #scriptVariable: 'window.__ENV__'
    #scriptTag: 'id="env-data"'

# https://github.com/povio/resolve-config
configs:
  - name: html
    values:
      - name: "APP_STAGE"
        valueFrom: "func:STAGE"
      - name: "APP_API"
        value: "https://api.example.com"

```

### Example

The file will be edited in place, with the following content inserted into
the `<head>` section, replacing any existing `<script id="env-data">`:

```html
<script id="env-data">
  // you can add local testing variables here,
  // this will get overwritten at build
  window.__ENV__ = {"APP_STAGE":"myapp-dev"}
</script>
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
