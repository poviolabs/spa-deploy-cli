/*
 Notify a Slack channel
 */

import yargs from "yargs";
import { WebClient } from "@slack/web-api";

import {
  getYargsOptions,
  loadYargsConfig,
  Option,
  YargsOptions,
} from "~yargs.helper";

import { getCommitMessage, getRelease, getSha, getShortSha } from "~git.helper";

class SlackOptions extends YargsOptions {
  @Option({ envAlias: "PWD", demandOption: true })
  pwd: string;

  @Option({ envAlias: "STAGE", demandOption: true })
  stage: string;

  @Option({ envAlias: "SERVICE" })
  service: string;

  @Option({
    envAlias: "SLACK_ACCESS_TOKEN",

    demandOption: true,
  })
  slackAccessToken: string;

  @Option({
    envAlias: "SLACK_CHANNEL",
    configAlias: (c) => c.slackNotify?.channel,
    demandOption: true,
  })
  slackChannel: string;

  @Option({
    envAlias: "RELEASE",
    envAliases: ["CIRCLE_SHA1", "BITBUCKET_COMMIT", "GITHUB_SHA"],
    demandOption: true,
  })
  release: string;

  @Option({
    envAlias: "RELEASE_STRATEGY",
    default: "gitsha",
    choices: ["gitsha", "gitsha-stage"],
    type: "string",
  })
  releaseStrategy: "gitsha" | "gitsha-stage";

  @Option({
    envAlias: "APP_VERSION",
    envAliases: ["CIRCLE_TAG", "BITBUCKET_TAG"],
    type: "string",
    alias: "ecsVersion",
  })
  appVersion: string;

  @Option({
    demandOption: true,
    choices: ["success", "failure", "info"],
    default: "info",
  })
  messageType: string;

  @Option({ demandOption: false })
  message: string;

  @Option({
    envAlias: "BRANCH_NAME",
    envAliases: ["CIRCLE_BRANCH", "BITBUCKET_BRANCH", "GITHUB_REF_NAME"],
    demandOption: false,
  })
  branchName: string;

  @Option({
    envAlias: "BUILD_URL",
    envAliases: ["CIRCLE_BUILD_URL"],
    demandOption: false,
  })
  buildUrl: string;

  @Option({
    envAlias: "REPO_NAME",
    envAliases: [
      "CIRCLE_PROJECT_REPONAME",
      "BITBUCKET_REPO_SLUG",
      "GITHUB_REPOSITORY",
    ],
    demandOption: false,
  })
  repoName: string;
}

export const command: yargs.CommandModule = {
  command: "slack",
  describe: "Send Status to Slack",
  builder: async (y) => {
    return y
      .options(getYargsOptions(SlackOptions))
      .middleware(async (_argv) => {
        const argv = loadYargsConfig(SlackOptions, _argv as any, "spa_deploy");
        argv.release =
          argv.release || (await getRelease(argv.pwd, argv.releaseStrategy));

        return argv as any;
      }, true);
  },
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as SlackOptions;

    const { service, pwd } = argv;
    const commitMessage = await getCommitMessage(pwd);

    const {
      appVersion,
      branchName,
      repoName,
      buildUrl,
      slackAccessToken,
      slackChannel,
    } = argv;

    const slackAutolinkPrefix = argv.config.slackNotify?.autolinkPrefix;
    const slackAutolinkTarget = argv.config.slackNotify?.autolinkTarget;
    const slackCommitPrefix = argv.config.slackNotify?.commitPrefix;
    const slackProjectName = argv.config.slackNotify?.projectName;

    const gitSha = await getSha(pwd);
    const gitShortSha = await getShortSha(pwd);

    const web = new WebClient(slackAccessToken);

    const templates = {
      success: {
        icon: ":greencircle:",
      },
      info: {
        icon: ":information_source:",
      },
      failure: {
        icon: ":red_circle:",
      },
    };

    let message = `${templates[argv.messageType].icon} `;

    if (slackProjectName) {
      message += `*${slackProjectName}* `;
    }

    const deployName = `${repoName ? `${repoName}:` : ""}${
      appVersion || branchName || ""
    }`;

    let text = `[${templates[argv.messageType].icon}] ${deployName}`;

    if (argv.message) {
      text += ` ${argv.message}`;
    }

    if (buildUrl) {
      message += `<${buildUrl}|${deployName}>`;
    } else {
      message += deployName;
    }

    if (service) {
      message += ` Service: ${service}`;
    }

    if (slackCommitPrefix) {
      message += `\n\t\t :memo: <${slackCommitPrefix}${gitSha}|${gitShortSha}>\t`;
    } else {
      message += `\n\t\t :memo: ${gitShortSha}\t`;
    }

    if (slackAutolinkTarget && slackAutolinkPrefix) {
      message += `_${commitMessage.replace(
        new RegExp(`\\b${slackAutolinkPrefix}[a-zA-Z0-9]+\\b`, "gm"),
        (a) => {
          return `<${slackAutolinkTarget}|${a}>`;
        }
      )}_`;
    } else {
      message += `_${commitMessage}_`;
    }

    if (argv.message) {
      message += `\n${argv.message}`;
    }

    await web.chat.postMessage({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: message,
          },
        },
      ],
      text,
      channel: slackChannel,
      unfurl_links: false,
      unfurl_media: false,
    });
  },
};
