import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();

// Organizations' trash and history retention, and recurring automations, once an hour.
crons.hourly("retention and recurring tasks", { minuteUTC: 17 }, makeFunctionReference<"mutation">("retention:sweep"));
// Webhooks that failed are retried on their own schedule; this catches any that were left behind.
crons.hourly("webhook catch-up", { minuteUTC: 41 }, makeFunctionReference<"action">("integrations:deliver"));

export default crons;
