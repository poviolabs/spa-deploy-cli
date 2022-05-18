import { sync as fgSync } from "fast-glob";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import { chk } from "./cli.helper";

export enum SyncAction {
  unknown = "Unknown",
  unchanged = "Unchanged",
  ignore = "Ignored",
  delete = "Delete",
  update = "Update",
  create = "Create",
}

export const SyncActionColors = {
  [SyncAction.unknown]: chk.yellow,
  [SyncAction.unchanged]: chk.reset,
  [SyncAction.ignore]: chk.reset,
  [SyncAction.delete]: chk.red,
  [SyncAction.update]: chk.magenta,
  [SyncAction.create]: chk.magenta,
};

export interface LocalFile {
  path: string;
  key: string;
  hash: string;
  size: number;
}

export interface ScanLocalOptions {
  path: string;
  ignore_glob?: string[];
  include_glob?: string[];
}

export async function* scanLocal(
  options: ScanLocalOptions
): AsyncGenerator<LocalFile> {
  for await (const entry of fgSync(options.include_glob || ["**"], {
    onlyFiles: true,
    ignore: options.ignore_glob,
    cwd: options.path,
    unique: true,
  })) {
    const absPath = path.join(options.path, entry);
    yield {
      path: absPath,
      key: entry,
      size: fs.statSync(absPath).size,
      hash: await fileMd5(absPath),
    };
  }
}

export async function fileMd5(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = fs.createReadStream(path);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
