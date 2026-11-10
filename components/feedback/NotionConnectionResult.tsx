"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Link2, Loader2 } from "lucide-react";
import { RecoveryPanel, recoveryLinkClass, recoverySecondaryClass } from "./RecoveryPanel";
import { connectionMessage } from "./connectionState";

type ConnectionState = "checking" | "connected" | "unconfirmed";

function isConnected(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    typeof value.result === "object" &&
    value.result !== null &&
    "connected" in value.result &&
    value.result.connected === true
  );
}

/** A success query is merely a hint. Only the authenticated backend can confirm access. */
export function NotionConnectionResult({ returned, reason }: { returned: boolean; reason?: string }) {
  const [state, setState] = useState<ConnectionState>(returned ? "checking" : "unconfirmed");
  useEffect(() => {
    if (!returned) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    void fetch("/api/notion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "status", args: {} }),
      signal: controller.signal,
    })
      .then(async (response) => response.ok && isConnected(await response.json()))
      .then((connected) => setState(connected ? "connected" : "unconfirmed"))
      .catch(() => setState("unconfirmed"))
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [returned]);

  if (returned && state === "checking") {
    return (
      <RecoveryPanel
        eyebrow="Notion connection"
        title="Checking your connection…"
        icon={<Loader2 className="animate-spin motion-reduce:animate-none" />}
        body={<span role="status">Max is verifying that your account has access to Notion.</span>}
      >
        <Link href="/home?settings=connections" className={recoverySecondaryClass}>
          Open Connections
        </Link>
      </RecoveryPanel>
    );
  }
  if (returned && state === "connected") {
    return (
      <RecoveryPanel
        eyebrow="Notion connected"
        title="Your ideas can come along."
        icon={<Check />}
        body="Notion is connected to your Max account. Choose shared pages and databases in Connections to import private copies."
        footnote="Connecting does not import anything. Your originals stay in Notion."
      >
        <Link href="/home?settings=connections" className={recoveryLinkClass}>
          Choose pages to import
        </Link>
        <Link href="/home" className={recoverySecondaryClass}>
          Open Max
        </Link>
      </RecoveryPanel>
    );
  }
  const message = connectionMessage(reason);
  const signIn = reason === "session_expired" || reason === "unauthenticated" || reason === "permission_denied";
  return (
    <RecoveryPanel
      eyebrow="Notion connection"
      title={returned ? "Check your connection in Max." : message.title}
      icon={<Link2 />}
      body={
        returned
          ? "Authorization returned to Max, but this tab could not confirm an active connection. Sign in and check Connections before importing."
          : message.body
      }
    >
      <Link href={signIn ? "/sign-in" : "/home?settings=connections"} className={recoveryLinkClass}>
        {returned ? "Open Connections" : message.action}
      </Link>
      <Link href="/home?settings=data" className={recoverySecondaryClass}>
        Import an export file
      </Link>
    </RecoveryPanel>
  );
}
