import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expire unregistered uploads", { minutes: 15 }, internal.uploadCleanup.sweep, {});
export default crons;
