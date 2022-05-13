import fs from "fs";
import path from "path";

import { parse as parseDotenv } from "dotenv";
import { parse as parseYAML } from "yaml";

interface ConfigItem {
  [key: string]: ConfigItem | string | number | string[] | any;
}
export interface Config extends ConfigItem {
  /**
   * Environment as it was set in the config file - use process.env to account for overrides
   */
  readonly environment?: Record<string, string>;
  /**
   * dotenv files used to load environment
   */
  readonly env_files?: string[];
}

/**
 *  Read config.yaml
 *   - allow for .env file overrides, priority is
 *    1. process.env
 *    2. .env file
 *    3. config.environment
 *   - override config.yaml with process.env.CONFIG_FILE
 *
 */
export function loadConfig(
  root: string,
  stage: string,
  options: {
    service?: string;
    configFileName?: string;
    globalPrefix?: string;
  } = {}
): Config {
  const globalPrefix =
    options.globalPrefix || process.env.CONFIG_PREFIX || "app";

  const configFileName =
    options.configFileName || process.env.CONFIG_FILE || "config.yaml";

  if (!root || !stage) {
    throw new Error("Stage not defined");
  }

  const service = options.service || undefined;

  let config: Config;
  {
    const yamlPath = path.join(root, configFileName);
    if (!fs.existsSync(yamlPath)) {
      // the config file is required
      throw new Error(`Couldn't find configuration file "${yamlPath}"`);
    }

    const configName = service ? `${stage}-${service}` : stage;

    const yamlConfig = readYaml(yamlPath);
    if (!yamlConfig.stages[configName]) {
      throw new Error(`Stage "${configName}" not found in ${configFileName}`);
    }

    config = {
      stage,
      environment: {},
      env_files: [],
      // read tree from .yaml stage
      ...yamlConfig.stages[configName],
    };

    if (service) {
      config.service = service;
    }

    if (configFileName === "config.yaml") {
      if (fs.existsSync(path.join(root, "config.local.yaml"))) {
        const localYamlConfig = readYaml(path.join(root, "config.local.yaml"));
        if (localYamlConfig.stages[configName]) {
          mergeDeep(config, localYamlConfig.stages[configName]);
        }
      }
    }
  }

  const environment: Record<string, string> = {
    // get environment from yaml
    ...config.environment,

    // get .env from env_files defined in yaml
    ...config.env_files.reduce((acc, cur) => {
      return { ...acc, ...readEnv(root, cur) };
    }, {} as Record<string, string>),

    // and finally from process.env
    ...process.env,
  };

  //  add missing environment variables into process.env
  for (const [k, v] of Object.entries(environment)) {
    if (process.env[k] === undefined && process.env[k] !== v) {
      process.env[k] = v;
    }
  }

  loadEnvironmentIntoConfig(config, environment, globalPrefix);

  return config;
}

/**
 * parse environment into config
 *  - converts app__one__two=three into {one: {two: "three" }}
 *  - overrides existing nodes
 * @param config
 * @param environment - dict from dot-env file
 * @param prefix - defaults to "app"
 */
export function loadEnvironmentIntoConfig(
  config: Config,
  environment: Record<string, string>,
  prefix: string | false = "app" || false
) {
  const reservedRoots = ["environment", "env_files"];

  for (const [key, value] of Object.entries(environment)) {
    if (key.startsWith("__") || key.endsWith("__")) {
      // ignore edge cases
      continue;
    }
    const valuePath = key.split("__");

    if (prefix) {
      // only allow variables with a global prefix
      if (valuePath.shift() !== prefix) continue;
    }

    // handle root exceptions
    if (valuePath[0] === undefined || reservedRoots.includes(valuePath[0])) {
      continue;
    }

    // walk the value path
    let p: ConfigItem | Config = config;
    while (true) {
      const n = valuePath.shift();

      if (valuePath.length !== 0) {
        // we need to walk down more objects

        if (p[n] === undefined) {
          // there is nothing here, make a new structure
          p[n] = {};
          (p as unknown) = p[n];
          continue;
        }

        if (p[n] && typeof p[n] === "object") {
          // we're at an object

          if (Array.isArray(p[n])) {
            // interaction with arrays is not defined
            throw new Error(`Tried to change config array: ${key}`);
          }

          // move down
          (p as unknown) = p[n];
          continue;
        }

        // we need to move down but we cant
        throw new Error(`Tried to change config structure with env: ${key}`);
      }

      // we have a simple value to set

      if (p[n] !== undefined) {
        if (typeof p[n] === "object") {
          throw new Error(
            `Tried to override config structure with env: ${key}`
          );
        }

        // we probably have a simple value
      }

      // set a simple value
      p[n] = value;
      break;
    }
  }
  return config;
}

/**
 * Read YAML into json tree
 * @param path
 */
export function readYaml(path: string): Record<string, any> {
  return parseYAML(fs.readFileSync(path, "utf8"), {
    version: "1.1", // support merge keys
  });
}

/**
 * Read dot-env file into dict
 * @param root
 * @param name
 */
export function readEnv(root: string, name: string): Record<string, string> {
  const envPath = path.join(root, name);
  if (envPath) {
    return parseDotenv(fs.readFileSync(envPath));
  } else {
    console.log(`Notice: env file ${envPath} not found`);
  }
  return {};
}

/**
 * Deep merge two objects, mutating the target
 */
function mergeDeep(target: any, ...sources: any[]): object {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  mergeDeep(target, ...sources);
}

function isObject(item: any) {
  return item && typeof item === "object" && !Array.isArray(item);
}
