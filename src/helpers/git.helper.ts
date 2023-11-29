import fs from "fs";
import path from "path";
import { logBanner, logError, logVariable, logWarning } from "./cli.helper.js";

async function simpleGit(p: string) {
  const { default: _simpleGit } = await import("simple-git");
  return _simpleGit(p);
}

export async function getGitVersion(pwd: string) {
  try {
    const git = await simpleGit(pwd);
    return (await git.raw("--version")).trim();
  } catch (e) {
    return undefined;
  }
}

export async function getGitChanges(pwd: string): Promise<string | undefined> {
  try {
    const git = await simpleGit(pwd);
    return await git.raw("status", "--porcelain");
  } catch (e) {
    console.log(e);
    return undefined;
  }
}

export async function getCommitMessage(pwd: string) {
  const git = await simpleGit(pwd);
  return (await git.raw("show", "-s", "--format=%s", "HEAD")).trim();
}

export async function getSha(pwd: string) {
  const git = await simpleGit(pwd);
  return (await git.raw("rev-parse", "HEAD")).trim();
}

export async function getShortSha(pwd: string) {
  const git = await simpleGit(pwd);
  return (await git.raw("rev-parse", "--short", "HEAD")).trim();
}

export async function detectGitChanges(pwd: string, ignore: boolean) {
  if (fs.existsSync(path.join(pwd, ".git"))) {
    logVariable("Git Bin Version", await getGitVersion(pwd));
    const gitChanges = await getGitChanges(pwd);
    if (gitChanges !== "") {
      if (ignore) {
        logWarning("Changes detected in .git");
      } else {
        if (gitChanges === undefined) {
          logError("Error detecting Git");
        } else {
          logBanner("Detected Changes in Git - Stage must be clean to build!");
          console.log(gitChanges);
        }
        process.exit(1);
      }
    }
  }
}
