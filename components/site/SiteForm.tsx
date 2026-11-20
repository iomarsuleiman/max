"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Copy, ExternalLink, Globe } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input, Switch } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageSlug } from "@/lib/pageUrl";
import type { SiteRow } from "@/lib/domain/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";

const toSlug = (t: string) => pageSlug(t).replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "my-site";

/**
 * Publishes a page and everything inside it as a website, or updates or takes it down.
 * Lives in Share → Publish, like Notion.
 */
export function SiteForm({ page }: { page: { _id: string; title: string; icon?: string | null } }) {
  const ws = useWorkspace();
  const q = useOp<{ site: SiteRow | null }>("sites.get", { pageId: page._id });
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
      await ws.call("sites.publish", { pageId: page._id, slug, name, description, search, icon: page.icon ?? null });
      toast.success(site ? "Site updated" : "Your site is live", { action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener") } });
    } catch (err) {
      notifyError(err, "Couldn't publish the site.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" aria-label="Publish as a site">
        <Field label="Site name" htmlFor="site-name">
          <Input id="site-name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address" htmlFor="site-slug" help={<span className="break-all font-mono text-[12px]">{url}</span>}>
          <Input id="site-slug" value={slug} maxLength={40} required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
        </Field>
        <Field label="Description" htmlFor="site-description">
          <Input id="site-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="What this site is about (optional)" />
        </Field>
        <div className="flex items-center justify-between gap-3 text-[13.5px]">
          <span>Visitors can search the site</span>
          <Switch label="Visitors can search the site" checked={search} onCheckedChange={setSearch} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="primary" icon={<Globe className="size-4" />} pending={busy}>
            {site ? "Update site" : "Publish site"}
          </Button>
          {site && (
            <>
              <Button size="sm" icon={<ExternalLink className="size-4" />} onClick={() => window.open(`${origin}/site/${site.slug}`, "_blank", "noopener")}>
                Open
              </Button>
              <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(`${origin}/site/${site.slug}`).then(() => toast.success("Link copied", { duration: 1500 }))}>
                Copy link
              </Button>
              <Button
                size="sm"
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
  );
}
