import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, resolve as pathResolve } from "node:path";
import { resolveConfig, resolveTemplate } from "@povio/resolve-config";
import picomatch from "picomatch";
import * as z from "zod";

import { Logger } from "../helpers/logger";

export function injectEnvIntoHtml(_options: {
    source: string;
    destination: string;
    env: any;
    scriptTag?: string;
    scriptVariable?: string;
}, logger: Logger = new Logger(false)) {

    const { source, destination, env } = _options;
    const scriptTag = _options.scriptTag || 'id="env-data"';
    const scriptVariable = _options.scriptVariable || 'window.__ENV__';

    let html = readFileSync(source, "utf8");

    const injectedData = `<script ${scriptTag}>${scriptVariable} = ${JSON.stringify(
        env,
    )}</script>`;

    if (html.match(`<script ${scriptTag}>`)) {
        html = html.replace(RegExp(`<script ${scriptTag}>[^<]*</script>`), injectedData);
    } else if (html.match("</head>")) {
        // language=text
        logger.warn(
            `> Warning: Could not find <script id="env-data"> in ${source}. Fallback to end of </head>`,
        );
        html = html.replace(/<\/head>/, injectedData + `</head>`);
    } else {
        throw new Error(`Could not find injection point in ${source}`);
    }

    mkdirSync(dirname(destination), { recursive: true });

    writeFileSync(destination, html);
}


const InjectItems = z.array(z.object({
    name: z.string(),
    sourceGlob: z.string(),
    destinationPrefix: z.string().optional(),
    sourcePrefix: z.string().optional(),
    config: z.string(),
    configModule: z.string().default("spa"),
    scriptTag: z.string().optional(),
    scriptVariable: z.string().optional(),
}));


export async function injectEnvIntoFiles(options: {
    cwd: string;
    stage: string;
    module: string;
}, logger: Logger = new Logger(false)): Promise<void> {

    const { cwd, stage, module } = options;

    let config = await resolveTemplate({
        cwd,
        stage,
        module,
    }) as any;
    let injects;

    try {
        injects = InjectItems.parse(Array.isArray(config.inject) ? config.inject : [config.inject]);
    } catch (error: any) {
        logger.error(error);
        process.exit(1);
    }

    for (const inject of injects) {

        const env = await resolveConfig({
            cwd,
            stage,
            module: inject.configModule,
            target: inject.config,
        });



        let sourcePrefix = inject.sourcePrefix && inject.sourcePrefix.startsWith("/") ? inject.sourcePrefix : inject.sourcePrefix ? pathResolve(cwd, inject.sourcePrefix) : cwd;
        const sourceGlobPattern = inject.sourceGlob;
        const isMatch = picomatch(sourceGlobPattern);

        logger.info(`> Injecting environment variables from '${inject.config}' into '${sourceGlobPattern}'`);
        logger.debug(`> Injecting env values: ${JSON.stringify(env)}`);
        for await (const file of await glob("**/*", { cwd: sourcePrefix, withFileTypes: true })) {
            if (!isMatch(file.name)) {
                continue;
            }
            let source = pathResolve(sourcePrefix, file.name);
            let destination = source;
            if (inject.destinationPrefix) {
                destination = inject.destinationPrefix.startsWith("/") ? inject.destinationPrefix : pathResolve(cwd, inject.destinationPrefix);
                destination = pathResolve(destination, file.name);
            }
            logger.debug(`>> Injecting environment variables into ${destination}`);
            await injectEnvIntoHtml({ source, destination, env, scriptTag: inject.scriptTag, scriptVariable: inject.scriptVariable }, logger);
        }
    }
}