import {
  resolveZeConfigItem,
  safeLoadConfig,
  ZeConfigs,
} from "../helpers/ze-config";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { dump } from "js-yaml";
import { logWarning } from "../helpers/cli.helper.js";

export async function bootstrap(argv: {
  pwd: string;
  stage: string;
  release: string;
  verbose?: boolean;
  target?: string;
}) {
  const config = await safeLoadConfig(
    "spa-deploy",
    argv.pwd,
    argv.stage,
    z.object({
      region: z.string(),
      configs: ZeConfigs,
    }),
    false,
  );

  for (const ci of config.configs) {
    if (argv.target && ci.name !== argv.target) {
      continue;
    }

    const envData = await resolveZeConfigItem(
      ci,
      {
        awsRegion: config.region,
        release: argv.release,
      },
      argv.pwd,
      argv.stage,
    );

    const { destination, source } = ci;

    const fileName = path.basename(destination);

    let output: string | undefined;
    if (fileName.endsWith(".json")) {
      output = generateJson(envData);
    } else if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) {
      output = generateYaml(envData);
    } else if (fileName.endsWith(".env") || fileName.startsWith(".env")) {
      output = generateIni(envData);
    } else if (fileName.endsWith(".html")) {
      output = generateHtml(
        source ? path.join(argv.pwd, source) : path.join(argv.pwd, destination),
        envData,
      );
    } else {
      throw new Error(`Unknown destination file type: ${fileName}`);
    }
    const outputPath = path.join(argv.pwd, destination);
    if (output) {
      console.log(`Writing ${outputPath}`);
      fs.writeFileSync(outputPath, output);
    }
  }
}

export function generateHtml(sourcePath: any, envData: any): string {
  const html = fs.readFileSync(sourcePath, "utf8");

  const injectedData = `<script id="env-data">window.__ENV__ = ${JSON.stringify(
    envData,
  )}</script>`;

  if (html.match('<script id="env-data">')) {
    return html.replace(/<script id="env-data">[^<]*<\/script>/, injectedData);
  } else if (html.match("</head>")) {
    // language=text
    logWarning(
      `Could not find <script id="env-data"> in ${sourcePath}. Fallback to end of </head>`,
    );
    return html.replace(/<\/head>/, injectedData + `</head>`);
  } else {
    throw new Error(`Could not find injection point in ${sourcePath}`);
  }
}

export function generateIni(data: Record<string, any>): string {
  // convert a dictionary to a .env file
  //  - format of the file is ${key}="${value}"
  //  - encode values into single line
  //  - escape values so that we preserve the format of the ini file
  return Object.entries(data)
    .map(([key, value]) => {
      if (typeof value === "object") {
        return `${key}="${JSON.stringify(value)
          .replace(/"/g, '\\"')
          .replace(/\r?\n/g, "\\n")}"`;
      }
      return `${key}="${value
        .toString()
        // escape quotes
        .replace(/"/g, '\\"')
        //  and newlines
        .replace(/\r?\n/g, "\\n")}"`;
    })
    .join("\n");
}

export function generateJson(data: any): string {
  return JSON.stringify(data, null, 2);
}

export function generateYaml(data: any): string {
  return dump(data);
}
