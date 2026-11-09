"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { House } from "lucide-react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { compareRank } from "@/lib/domain/rank";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { Topbar } from "@/components/workspace/Topbar";

/**
 * There is no built-in dashboard: /home opens the page you chose as your home page.
 * Without one it opens the last page you visited (or your first page), and with no pages it offers to make one.
 */
export function HomeResolver() {
  const ws = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const settings = ws.settings;
  const tree = ws.tree;

  const live = (id: string | null | undefined) => (id && ws.byId.get(id) ? id : null);
  const firstTopLevel = tree
    ?.filter((p) => !p.parentId)
    .sort((a, b) => compareRank(a.rank, b.rank))[0]?._id;
  const target = settings && tree ? (live(settings.homePageId) ?? (settings.startPage === "home" ? firstTopLevel : live(settings.lastPageId)) ?? firstTopLevel ?? null) : undefined;

  useEffect(() => {
    if (!target) return;
    const qs = params.toString();
    router.replace(`/p/${target}${qs ? `?${qs}` : ""}`);
  }, [target, params, router]);

  const createHome = async () => {
    setCreating(true);
    try {
      const id = await ws.createPage({ title: "Home", open: false });
      if (!id) return;
      await ws.call("pages.update", { id, icon: "lucide:house:default" });
      await ws.updateSettings({ homePageId: id });
      router.replace(`/p/${id}`);
    } catch (err) {
      notifyError(err, "Couldn't create your home page.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Topbar crumbs={[]} />
      <div className="grid flex-1 place-items-center">
        {target === null ? (
          <EmptyState icon={<House className="size-5" />} title="Make your home page" body="Your home page is a regular page you design yourself. You can make any page your home page from its ⋯ menu.">
            <Button variant="primary" pending={creating} onClick={createHome}>
              Create home page
            </Button>
          </EmptyState>
        ) : (
          <Spinner label="Opening your home page" />
        )}
      </div>
    </>
  );
}
