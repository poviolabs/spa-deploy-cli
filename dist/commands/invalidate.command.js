"use strict";
/*
  Invalidate CloudFront distribution
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
const process_1 = __importDefault(require("process"));
const node_stage_1 = require("node-stage");
const cli_1 = require("node-stage/cli");
const yargs_1 = require("node-stage/yargs");
const chalk_1 = require("node-stage/chalk");
const aws_helpers_1 = require("../helpers/aws.helpers");
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
    command: "invalidate",
    describe: "Invalidate CloudFront distribution for SPA app",
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
        const { spaDeploy } = argv.config;
        const awsRegion = spaDeploy?.aws?.region;
        if (!awsRegion) {
            (0, cli_1.logError)(`AWS Region is not set`);
            return process_1.default.exit(1);
        }
        (0, cli_1.logVariable)("app__aws__region", awsRegion);
        // cloudfront plan
        const cloudfrontInvalidations = parseArray(spaDeploy?.cloudfront?.invalidatePaths);
        const cloudfrontId = parseArray(spaDeploy?.cloudfront?.distributionId);
        if (cloudfrontInvalidations.length < 1) {
            (0, cli_1.logInfo)('No validations set. Invalidate everything');
            cloudfrontInvalidations.push('/*');
        }
        if (cloudfrontInvalidations.length > 0) {
            (0, cli_1.logBanner)(`CloudFront invalidations`);
            for (const i of cloudfrontInvalidations) {
                (0, cli_1.logInfo)(i);
            }
        }
        // deploy
        (0, cli_1.logBanner)(`Deploy`);
        if (cloudfrontId.length < 1 && cloudfrontInvalidations.length > 0) {
            (0, cli_1.logWarning)("No cloudfront set - will not invalidate cache!");
            return;
        }
        if (!argv.ci) {
            if (!(await (0, cli_1.confirm)("Press enter to deploy..."))) {
                (0, cli_1.logInfo)("Canceled");
                return;
            }
        }
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
//# sourceMappingURL=invalidate.command.js.map