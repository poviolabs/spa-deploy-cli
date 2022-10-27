"use strict";
/*
  Deploy files to S3
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArray = exports.command = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const micromatch_1 = __importDefault(require("micromatch"));
const crypto_1 = require("crypto");
const process_1 = __importDefault(require("process"));
const node_stage_1 = require("@povio/node-stage");
const cli_1 = require("@povio/node-stage/cli");
const git_1 = require("@povio/node-stage/git");
const yargs_1 = require("@povio/node-stage/yargs");
const chalk_1 = require("@povio/node-stage/chalk");
const aws_helpers_1 = require("../helpers/aws.helpers");
const sync_helper_1 = require("../helpers/sync.helper");
const version_helper_1 = require("../helpers/version.helper");
class SpaBuildOptions {
}
__decorate([
    (0, yargs_1.Option)({ envAlias: "PWD", demandOption: true }),
    __metadata("design:type", String)
], SpaBuildOptions.prototype, "pwd", void 0);
__decorate([
    (0, yargs_1.Option)({ envAlias: "STAGE", demandOption: true }),
    __metadata("design:type", String)
], SpaBuildOptions.prototype, "stage", void 0);
__decorate([
    (0, yargs_1.Option)({
        envAlias: "RELEASE",
        envAliases: ["CIRCLE_SHA1", "BITBUCKET_COMMIT", "GITHUB_SHA"],
        demandOption: true,
    }),
    __metadata("design:type", String)
], SpaBuildOptions.prototype, "release", void 0);
__decorate([
    (0, yargs_1.Option)({
        envAlias: "APP_VERSION",
        envAliases: ["CIRCLE_TAG", "BITBUCKET_TAG"],
        type: "string",
        alias: "ecsVersion",
    }),
    __metadata("design:type", String)
], SpaBuildOptions.prototype, "appVersion", void 0);
__decorate([
    (0, yargs_1.Option)({
        default: "gitsha",
        choices: ["gitsha", "gitsha-stage"],
        type: "string",
    }),
    __metadata("design:type", String)
], SpaBuildOptions.prototype, "releaseStrategy", void 0);
__decorate([
    (0, yargs_1.Option)({ envAlias: "IGNORE_GIT_CHANGES" }),
    __metadata("design:type", Boolean)
], SpaBuildOptions.prototype, "ignoreGitChanges", void 0);
__decorate([
    (0, yargs_1.Option)({ describe: "Remove all undefined files from S3" }),
    __metadata("design:type", Boolean)
], SpaBuildOptions.prototype, "purge", void 0);
__decorate([
    (0, yargs_1.Option)({ describe: "Replace all files even if not changed" }),
    __metadata("design:type", Boolean)
], SpaBuildOptions.prototype, "force", void 0);
__decorate([
    (0, yargs_1.Option)({ envAlias: "VERBOSE", default: false }),
    __metadata("design:type", Boolean)
], SpaBuildOptions.prototype, "verbose", void 0);
__decorate([
    (0, yargs_1.Option)({ envAlias: "CI" }),
    __metadata("design:type", Boolean)
], SpaBuildOptions.prototype, "ci", void 0);
exports.command = {
    command: "deploy",
    describe: "Deploy a SPA app",
    builder: async (y) => {
        return y
            .options((0, yargs_1.getYargsOptions)(SpaBuildOptions))
            .middleware(async (_argv) => {
            return (await (0, yargs_1.loadYargsConfig)(SpaBuildOptions, _argv, "spaDeploy"));
        }, true);
    },
    handler: async (_argv) => {
        const argv = (await _argv);
        await (0, chalk_1.loadColors)();
        (0, cli_1.logBanner)(`SPA Build ${(0, version_helper_1.getVersion)()}`);
        const pwd = argv.pwd;
        for (const [k, v] of Object.entries(await (0, cli_1.getToolEnvironment)(argv))) {
            (0, cli_1.logVariable)(k, v);
        }
        const stage = argv.stage;
        if (stage) {
            // get current STAGE if set
            // CI would not use this for builds
            (0, cli_1.logVariable)("STAGE", argv.stage);
        }
        if (!argv.ci) {
            (0, cli_1.logInfo)("Running Interactively");
        }
        const verbose = !!argv.verbose;
        const gitChanges = await (0, git_1.getGitChanges)(pwd);
        if (gitChanges !== "") {
            if (argv.ignoreGitChanges) {
                (0, cli_1.logWarning)("Changes detected in .git");
            }
            else {
                if (gitChanges === undefined) {
                    (0, cli_1.logError)("Error detecting Git");
                }
                else {
                    (0, cli_1.logBanner)("Detected Changes in Git - Stage must be clean to build!");
                    console.log(gitChanges);
                }
                process_1.default.exit(1);
            }
        }
        (0, cli_1.logBanner)("Build Environment");
        const { spaDeploy, spaGlobals, spaIndexGlob } = argv.config;
        const buildPath = path_1.default.join(pwd, spaDeploy?.buildPath || "dist");
        (0, cli_1.logVariable)("app__buildPath", buildPath);
        if (!fs_1.default.lstatSync(buildPath).isDirectory()) {
            (0, cli_1.logError)(`Build path ${buildPath} is not a directory.`);
            return process_1.default.exit(1);
        }
        const release = argv.release;
        (0, cli_1.logBanner)("App Environment");
        let version = argv.appVersion;
        if (!version) {
            version = `${stage}-${release}`;
        }
        else if (/^[\d.]+$/.exec(version)) {
            // if just the semver is passed in, prefix it!
            version = `${stage}-${version}`;
        }
        const prodEnv = {
            ...(spaGlobals ? spaGlobals : {}),
            APP_STAGE: stage,
            APP_VERSION: version,
            APP_RELEASE: release,
        };
        for (const [k, v] of Object.entries(prodEnv)) {
            (0, cli_1.logVariable)(k, v);
        }
        (0, cli_1.logBanner)("Deploy Environment");
        const awsRegion = spaDeploy?.aws?.region;
        if (!awsRegion) {
            (0, cli_1.logError)(`AWS Region is not set`);
            return process_1.default.exit(1);
        }
        (0, cli_1.logVariable)("app__aws__region", awsRegion);
        if (spaDeploy?.aws?.endpoint) {
            (0, cli_1.logVariable)("app__aws__endpoint", spaDeploy?.aws?.endpoint);
        }
        const deployBucket = spaDeploy?.s3?.bucket;
        if (!deployBucket) {
            (0, cli_1.logError)(`S3 Deploy Bucket is not set`);
            return process_1.default.exit(1);
        }
        else {
            (0, cli_1.logVariable)("app__s3__bucket", spaDeploy?.s3?.bucket);
        }
        if (spaDeploy?.s3?.prefix) {
            (0, cli_1.logVariable)("app__s3__prefix", spaDeploy?.s3?.prefix);
        }
        const s3Options = {
            region: awsRegion,
            bucket: deployBucket,
            endpoint: spaDeploy?.aws?.endpoint,
            prefix: spaDeploy?.s3?.prefix,
            force: argv.force,
            purge: argv.purge,
            invalidateGlob: spaDeploy?.s3?.invalidateGlob,
            acl: spaDeploy?.s3?.acl,
        };
        // s3 sync plan
        const plan = await (0, aws_helpers_1.prepareS3SyncPlan)({
            path: buildPath,
            includeGlob: spaDeploy?.includeGlob,
            ignoreGlob: spaDeploy?.ignoreGlob,
        }, s3Options);
        // inject globals into index files
        const indexFiles = spaIndexGlob
            ? plan.items.filter((x) => micromatch_1.default.isMatch(x.key, spaIndexGlob))
            : [];
        if (indexFiles.length > 0) {
            const injectedData = `<script id="env-data">${Object.entries(prodEnv)
                .map(([k, v]) => {
                return `window.${k}='${v}'`;
            })
                .join(";")}</script>`;
            for (const item of indexFiles) {
                item.cache = false;
                item.cacheControl = "public, must-revalidate";
                const data = fs_1.default.readFileSync(item.local.path, "utf-8");
                if (data.match('<script id="env-data">')) {
                    item.data = data.replace(/<script id="env-data">[^<]*<\/script>/, injectedData);
                }
                else if (data.match("</head>")) {
                    (0, cli_1.logWarning)(`Could not find <script id="env-data"> in ${item.key}. Injecting at end of HEAD.`);
                    item.data = data.replace(/<\/head>/, injectedData + `</head>`);
                }
                else {
                    (0, cli_1.logWarning)(`Could not find injection point in ${item.key}`);
                    continue;
                }
                item.dataHash = (0, crypto_1.createHash)("md5").update(item.data).digest("hex");
                if (!argv.force &&
                    item.action === sync_helper_1.SyncAction.update &&
                    item.remote?.eTag) {
                    if (item.remote?.eTag === item.dataHash) {
                        item.action = sync_helper_1.SyncAction.unchanged;
                        item.invalidate = false;
                    }
                }
            }
        }
        const sortAction = {
            [sync_helper_1.SyncAction.unknown]: 0,
            [sync_helper_1.SyncAction.ignore]: 1,
            [sync_helper_1.SyncAction.unchanged]: 2,
            [sync_helper_1.SyncAction.create]: 3,
            [sync_helper_1.SyncAction.update]: 4,
            [sync_helper_1.SyncAction.delete]: 5,
        };
        // sort deploy
        plan.items.sort((a, b) => {
            // > 0	 sort b before a
            // < 0	 sort a before b
            // === 0	 keep original order of a and b
            // sort by action
            if (sortAction[a.action] > sortAction[b.action])
                return 1;
            if (sortAction[a.action] < sortAction[b.action])
                return -1;
            // cached items go first
            if (a.cache && !b.cache)
                return -1;
            if (!a.cache && b.cache)
                return 1;
            return 0;
        });
        // s3 sync plan
        (0, cli_1.logBanner)(`S3 Sync Plan`);
        (0, aws_helpers_1.printS3SyncPlan)(plan, true, verbose);
        // cloudfront plan
        const cloudfrontInvalidations = (0, aws_helpers_1.prepareCloudfrontInvalidation)(plan, parseArray(spaDeploy?.cloudfront?.invalidatePaths));
        const cloudfrontId = parseArray(spaDeploy?.cloudfront?.distributionId);
        if (cloudfrontInvalidations.length > 0) {
            (0, cli_1.logBanner)(`Cloudfront invalidations`);
            for (const i of cloudfrontInvalidations) {
                console.log(i);
            }
        }
        // deploy
        (0, cli_1.logBanner)(`Deploy`);
        if (cloudfrontId.length < 1 && cloudfrontInvalidations.length > 0) {
            (0, cli_1.logWarning)("No cloudfront set - will not invalidate cache!");
        }
        if (!plan.items.some((x) => [sync_helper_1.SyncAction.create, sync_helper_1.SyncAction.update, sync_helper_1.SyncAction.delete].includes(x.action))) {
            (0, cli_1.logInfo)("Nothing to do!");
            return;
        }
        if (!argv.ci) {
            if (!(await (0, cli_1.confirm)("Press enter to deploy..."))) {
                (0, cli_1.logInfo)("Canceled");
                return;
            }
        }
        // execute file sync
        await (0, aws_helpers_1.executeS3SyncPlan)(plan);
        if (cloudfrontInvalidations.length > 0 && cloudfrontId.length > 0) {
            await (0, aws_helpers_1.executeCloudfrontInvalidation)(cloudfrontInvalidations, cloudfrontId, awsRegion);
        }
        (0, cli_1.logInfo)("Done!");
    },
};
function parseArray(input) {
    if (input === undefined || input === null) {
        return [];
    }
    if (Array.isArray(input)) {
        return input;
    }
    return [input];
}
exports.parseArray = parseArray;
//# sourceMappingURL=deploy.command.js.map