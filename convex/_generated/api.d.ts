/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as collaborationChecks from "../collaborationChecks.js";
import type * as collaborationSchema from "../collaborationSchema.js";
import type * as collaborationStore from "../collaborationStore.js";
import type * as convexDb from "../convexDb.js";
import type * as crons from "../crons.js";
import type * as fileCleanup from "../fileCleanup.js";
import type * as http from "../http.js";
import type * as notion from "../notion.js";
import type * as notionCleanup from "../notionCleanup.js";
import type * as notionStore from "../notionStore.js";
import type * as notionWorker from "../notionWorker.js";
import type * as ops from "../ops.js";
import type * as pagePolicyStore from "../pagePolicyStore.js";
import type * as personalDb from "../personalDb.js";
import type * as uploadAccount from "../uploadAccount.js";
import type * as uploadActions from "../uploadActions.js";
import type * as uploadChecks from "../uploadChecks.js";
import type * as uploadCleanup from "../uploadCleanup.js";
import type * as uploadHttp from "../uploadHttp.js";
import type * as uploadMutations from "../uploadMutations.js";
import type * as uploadOrphans from "../uploadOrphans.js";
import type * as uploadRegistration from "../uploadRegistration.js";
import type * as uploadSchema from "../uploadSchema.js";
import type * as uploadStore from "../uploadStore.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  collaborationChecks: typeof collaborationChecks;
  collaborationSchema: typeof collaborationSchema;
  collaborationStore: typeof collaborationStore;
  convexDb: typeof convexDb;
  crons: typeof crons;
  fileCleanup: typeof fileCleanup;
  http: typeof http;
  notion: typeof notion;
  notionCleanup: typeof notionCleanup;
  notionStore: typeof notionStore;
  notionWorker: typeof notionWorker;
  ops: typeof ops;
  pagePolicyStore: typeof pagePolicyStore;
  personalDb: typeof personalDb;
  uploadAccount: typeof uploadAccount;
  uploadActions: typeof uploadActions;
  uploadChecks: typeof uploadChecks;
  uploadCleanup: typeof uploadCleanup;
  uploadHttp: typeof uploadHttp;
  uploadMutations: typeof uploadMutations;
  uploadOrphans: typeof uploadOrphans;
  uploadRegistration: typeof uploadRegistration;
  uploadSchema: typeof uploadSchema;
  uploadStore: typeof uploadStore;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
