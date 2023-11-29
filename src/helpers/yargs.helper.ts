import "reflect-metadata";
import type { Options } from "yargs";
import path from "path";

import { getSha } from "./git.helper";

interface IOptionProperties extends Options {
  envAlias?: string;
}

const optionsKey = Symbol("options_key");

export function YargOption(properties: IOptionProperties) {
  return (target: object, propertyKey: string) => {
    if (properties !== undefined && properties !== null) {
      const newMetadata = {
        ...(Reflect.getMetadata(optionsKey, target) || {}),
        [propertyKey]: {
          ...properties,
          describe: properties.envAlias
            ? `${properties.describe || ""} [${properties.envAlias}]`
            : properties.describe,
          type:
            properties.type ||
            Reflect.getMetadata(
              "design:type",
              target,
              propertyKey,
            )?.name?.toLowerCase(),
        },
      };

      Reflect.defineMetadata(optionsKey, newMetadata, target);
    }
  };
}

export function getYargsOption<T>(
  target: any,
): Record<keyof T, IOptionProperties> {
  const options = Reflect.getMetadata(optionsKey, target.prototype);
  if (!options) {
    throw new Error(`Options for ${(target as any).name} were not defined`);
  }
  return options;
}

export function getBuilder(options) {
  return async (y) => {
    return y.options(getYargsOptions(options)).middleware(async (_argv) => {
      return (await loadYargsConfig(options, _argv as any)) as any;
    }, true);
  };
}

export function getYargsOptions<T>(target: any): Record<keyof T, Options> {
  return Object.entries(getYargsOption(target)).reduce(
    (a, [property, options]) => {
      // @ts-ignore
      a[property] = Object.fromEntries(
        Object.entries(options).filter(
          ([optionName]) => !["envAlias", "default"].includes(optionName),
        ),
      );
      return a;
    },
    {} as Record<keyof T, Options>,
  );
}

export interface YargsOptions {
  pwd: string;
  release: string;
}

export async function loadYargsConfig<T extends YargsOptions>(
  cls: new () => T,
  _argv: Record<string, unknown>,
): Promise<T> {
  const argv: T = new cls();

  argv.pwd = path.resolve(
    (_argv.pwd as string) || process.env.PWD || process.cwd(),
  );
  if (!argv.pwd) throw new Error("No PWD given");

  if (!argv.release) {
    argv.release =
      process.env.RELEASE ||
      process.env.RELEASE_SHA ||
      (await getSha(argv.pwd));
  }

  for (const [name, o] of Object.entries(getYargsOption(cls))) {
    if (["pwd", "release"].includes(name)) {
      continue;
    }

    argv[name as keyof typeof argv] =
      // yargs is always right
      (_argv[name] ||
        // fallback to env
        (o.envAlias && process.env[o.envAlias])) ??
      // fallback to default
      o.default;
  }

  return argv;
}
