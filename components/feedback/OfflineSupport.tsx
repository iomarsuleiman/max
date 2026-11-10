"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Script from "next/script";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui";

declare global {
  interface Window {
    MaxPaperHop?: { mount: (host: HTMLElement) => () => void };
  }
}
function subscribe(update: () => void) {
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}
export function PaperHop() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready && host.current && window.MaxPaperHop) return window.MaxPaperHop.mount(host.current);
  }, [ready]);
  return (
    <>
      <Script src="/offline-game.js" onReady={() => setReady(true)} onError={() => setReady(false)} />
      <div ref={host} />
      <noscript>This optional game needs JavaScript.</noscript>
    </>
  );
}
export function OfflineRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
export function OfflineNotice() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const [open, setOpen] = useState(false);
  if (online) return null;
  return (
    <>
      <div role="status" className="border-line bg-surface-2 text-fg-2 flex flex-wrap items-center justify-center gap-3 border-b px-4 py-2 text-xs">
        <span>You’re offline. Keep this tab open and check the save status before leaving.</span>
        <button type="button" className="underline underline-offset-4" onClick={() => setOpen(true)}>
          Take a small break
        </button>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-[var(--scrim)]" />
          <Dialog.Content className="bg-overlay shadow-dialog fixed top-1/2 left-1/2 z-[71] w-[min(650px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6">
            <Dialog.Title className="mb-2 text-lg font-semibold">A little lift while you wait</Dialog.Title>
            <Dialog.Description className="text-fg-2 mb-5 text-sm">An optional game. Your page stays open underneath.</Dialog.Description>
            <PaperHop />
            <Dialog.Close asChild>
              <Button className="mt-5">Back to my page</Button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
