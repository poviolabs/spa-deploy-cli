import fs from "node:fs";

const version = JSON.parse(fs.readFileSync("package.json", "utf-8")).version;

import { defineConfig } from "tsup";

export default defineConfig(() => {
  return [
    {
      entry: ["src/sh.ts"],
      splitting: false,
      sourcemap: false,
      clean: true,
      keepNames: true,
      platform: "node",
      format: "cjs",
      bundle: true,
      target: "node24",
      treeshake: true,
      minify: true,
      define: {
        "process.env.SPA_DEPLOY_VERSION": `"${version}"`,
      },
    },
  ];
});
