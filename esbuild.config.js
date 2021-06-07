const esbuild = require('esbuild')

// Automatically exclude all node_modules from the bundled version
const { nodeExternalsPlugin } = require('esbuild-node-externals')

esbuild.build({
  entryPoints: ['./src/deploy.ts'],
  outfile: 'bin/povio-spa-deploy.js',
  bundle: true,
  minify: true,
  platform: 'node',
  sourcemap: false,
  target: 'node14',
  plugins: [nodeExternalsPlugin()]
})
  .catch((e) => {
    console.error(e);
    process.exit(1)
  })
