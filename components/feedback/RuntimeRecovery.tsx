"use client";

import { useSyncExternalStore } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { PublicFrame } from "@/components/marketing/PublicFrame";
import { BackToPages, RecoveryPanel, recoveryLinkClass } from "./RecoveryPanel";
import { PaperHop } from "./OfflineSupport";

function subscribeOnline(update: () => void) {
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}

export function RuntimeRecovery({ retry, workspace = false }: { retry: () => void; workspace?: boolean }) {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const panel = (
    <RecoveryPanel
      eyebrow={online ? "A little interruption" : "Connection lost"}
      title={online ? "We could not load this page." : "You are offline."}
      body={
        online
          ? "Try loading the page again. If it still does not open, return to your pages and try again in a moment."
          : "Check your internet connection, then try again. Keep this tab open if you have unsaved edits."
      }
      icon={online ? <RefreshCw /> : <CloudOff />}
      footnote="If you were editing, check the save status when your page reopens before closing the tab."
    >
      <button type="button" className={recoveryLinkClass} onClick={retry}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Try again
      </button>
      <BackToPages />
      {!online && (
        <details className="mt-6 w-full text-sm">
          <summary className="cursor-pointer">Take a small break with Paper hop</summary>
          <div className="mt-4">
            <PaperHop />
          </div>
        </details>
      )}
    </RecoveryPanel>
  );
  return workspace ? panel : <PublicFrame>{panel}</PublicFrame>;
}
