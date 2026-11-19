"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Copy, ExternalLink, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Switch } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageSlug } from "@/lib/pageUrl";
import type { SiteRow } from "@/lib/domain/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";

const toSlug = (t: string) => pageSlug(t).replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "my-site";

/** Publishes a page and everything inside it as a website, or updates or takes it down. */
export function SiteDialog({ page, open, onOpenChange }: { page: { _id: string; title: string; icon: string | null }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const q = useOp<{ site: SiteRow | null }>("sites.get", open ? { pageId: page._id } : "skip");
  const site = q.data?.site ?? null;
  const [name, setName] = useState(page.title || "My site");
  const [slug, setSlug] = useState(toSlug(page.title));
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!site) return;
    setName(site.name);
    setSlug(site.slug);
    setDescription(site.description);
    setSearch(site.search);
  }, [site]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}/site/${slug}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await ws.call("sites.publish", { pageId: page._id, slug, name, description, search, icon: page.icon });
      toast.success(site ? "Site updated" : "Your site is live", { action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener") } });
    } catch (err) {
      notifyError(err, "Couldn't publish the site.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={site ? "Your site" : "Publish as a site"} description="This page and every page inside it become a simple website anyone can read, with navigation and search. Nothing else in your workspace is visible.">
      <form onSubmit={submit} className="grid gap-4 px-5 pb-5 pt-2">
        <Field label="Site name" htmlFor="site-name">
          <Input id="site-name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address" htmlFor="site-slug" help={<span className="break-all font-mono text-[12px]">{url}</span>}>
          <Input id="site-slug" value={slug} maxLength={40} required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
        </Field>
        <Field label="Description" htmlFor="site-description" help="Shown under the site name in search results and link previews.">
          <Input id="site-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Notes on design, travel and good books" />
        </Field>
        <div className="flex items-center justify-between gap-3 text-[13.5px]">
          <span>Visitors can search the site</span>
          <Switch label="Visitors can search the site" checked={search} onCheckedChange={setSearch} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" icon={<Globe className="size-4" />} pending={busy}>
            {site ? "Update site" : "Publish site"}
          </Button>
          {site && (
            <>
              <Button icon={<ExternalLink className="size-4" />} onClick={() => window.open(`${origin}/site/${site.slug}`, "_blank", "noopener")}>
                Open
              </Button>
              <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(`${origin}/site/${site.slug}`).then(() => toast.success("Link copied", { duration: 1500 }))}>
                Copy link
              </Button>
              <Button
                variant="ghost"
                className="ms-auto text-danger hover:bg-danger-soft"
                onClick={async () => {
                  try {
                    await ws.call("sites.unpublish", { pageId: page._id });
                    toast.success("Site taken down");
                  } catch (err) {
                    notifyError(err);
                  }
                }}
              >
                Unpublish
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
