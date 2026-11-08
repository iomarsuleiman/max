"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Segmented, Skeleton } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import type { PageSummary } from "@/lib/client/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { Topbar } from "@/components/workspace/Topbar";
import { PageIcon } from "@/components/workspace/PageIcon";

interface GalleryItem {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
}

export function TemplatesPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const gallery = useOp<{ templates: GalleryItem[] }>("gallery.list", {});
  const mine = useOp<{ templates: PageSummary[] }>("templates.list", {});
  const [category, setCategory] = useState("All");
  const [busy, setBusy] = useState<string | null>(null);
  const categories = ["All", ...new Set((gallery.data?.templates ?? []).map((t) => t.category))];
  const install = async (t: GalleryItem) => {
    setBusy(t.key);
    try {
      const { id } = await ws.call<{ id: string }>("gallery.install", { key: t.key });
      toast.success(`Added “${t.name}” to your pages`);
      router.push(`/p/${id}`);
    } catch (err) {
      notifyError(err, "Couldn't add the template.");
    } finally {
      setBusy(null);
    }
  };
  const use = async (t: PageSummary) => {
    setBusy(t._id);
    try {
      const { id } = await ws.call<{ id: string }>("templates.apply", { templateId: t._id });
      router.push(`/p/${id}`);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Topbar crumbs={[{ href: "/templates", title: "Templates" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[960px] px-4 pb-20 pt-10 sm:px-10">
          <h1 className="text-[28px] font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 text-[14px] text-fg-2">Start from a ready-made setup, or save any page as your own template from its ⋯ menu.</p>

          <section className="mt-8" aria-label="Your templates">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-fg-3">Your templates</h2>
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={async () => {
                  try {
                    const { template } = await ws.call<{ template: { _id: string } }>("templates.create", { title: "New template" });
                    router.push(`/p/${template._id}`);
                  } catch (err) {
                    notifyError(err);
                  }
                }}
              >
                New template
              </Button>
            </div>
            {!mine.data ? (
              <Skeleton className="h-16" />
            ) : mine.data.templates.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {mine.data.templates.map((t) => (
                  <li key={t._id} className="flex items-center gap-3 rounded-lg bg-overlay p-3 shadow-[0_0_0_1px_var(--line)]">
                    <PageIcon icon={t.icon} kind={t.kind} size={20} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{pageTitle(t.title)}</span>
                    <Button size="xs" variant="ghost" icon={<Pencil className="size-3" />} onClick={() => router.push(`/p/${t._id}`)}>
                      Edit
                    </Button>
                    <Button size="xs" variant="primary" pending={busy === t._id} onClick={() => use(t)}>
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<LayoutTemplate className="size-5" />} title="No templates of your own yet" body="Open any page, then choose ⋯ → Save as template. Database row templates live in each database's New ▾ menu." className="py-6" />
            )}
          </section>

          <section className="mt-10" aria-label="Template gallery">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-medium text-fg-3">Gallery</h2>
              <Segmented label="Category" size="sm" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />
            </div>
            {!gallery.data ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {gallery.data.templates
                  .filter((t) => category === "All" || t.category === category)
                  .map((t) => (
                    <li key={t.key} className="flex flex-col rounded-xl bg-overlay p-4 shadow-[0_0_0_1px_var(--line)]">
                      <span className="text-[28px] leading-none">{t.icon}</span>
                      <h3 className="mt-3 text-[15px] font-semibold">{t.name}</h3>
                      <p className="mt-1 flex-1 text-[13px] leading-relaxed text-fg-2">{t.description}</p>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-[12px] text-fg-3">{t.category}</span>
                        <Button size="sm" variant="primary" pending={busy === t.key} onClick={() => install(t)}>
                          Add to my pages
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
