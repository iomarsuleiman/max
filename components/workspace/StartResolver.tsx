"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { compareRank } from "@/lib/domain/rank";
import { pageHref } from "@/lib/pageUrl";
import { notifyError, useWorkspace } from "./context";
import { Topbar } from "./Topbar";

/**
 * Opening Max lands on the page you were last on, like Notion; with none, your first page.
 * With no pages at all it offers to make one. There is no separate home screen.
 */
export function StartResolver() {
  const ws = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const { settings, tree } = ws;
  const live = (id: string | null | undefined) => (id && ws.byId.get(id) ? id : null);
  const first = tree?.filter((p) => !p.parentId).sort((a, b) => compareRank(a.rank, b.rank))[0]?._id;
  const target = settings && tree ? (live(settings.lastPageId) ?? first ?? null) : undefined;

  useEffect(() => {
    if (!target) return;
    const qs = params.toString();
    router.replace(`${pageHref(target, ws.byId.get(target)?.title)}${qs ? `?${qs}` : ""}`);
  }, [target, params, router, ws.byId]);

  const create = async () => {
    setCreating(true);
    try {
      await ws.createPage();
    } catch (err) {
      notifyError(err, "Couldn't create a page.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Topbar crumbs={[]} />
      <div className="grid flex-1 place-items-center">
        {target === null ? (
          <EmptyState icon={<FilePlus2 className="size-5" />} title="No pages yet" body="Start with a blank page, pick a template, or import from Notion.">
            <Button variant="primary" pending={creating} onClick={create}>
              New page
            </Button>
          </EmptyState>
        ) : (
          <Spinner label="Opening your last page" />
        )}
      </div>
    </>
  );
}
