"use client";

import { useState, type FormEvent } from "react";
import { ChevronDown, Globe, Link2, Lock, UserPlus, Users } from "@/components/icons";
import { toast } from "sonner";
import { Button, Popover, Select, Spinner, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { pageHref, publicHref } from "@/lib/pageUrl";
import type { ShareLevel, ShareRow } from "@/lib/domain/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { Avatar } from "@/components/workspace/Sidebar";
import { SiteForm } from "@/components/site/SiteForm";
import { can, usePageAccess } from "./access";
import { OrgAccessSection } from "@/components/org/PageAccess";
import { isOrgId, useOrgDetails } from "@/lib/client/organizations";
import { activeWorkspace } from "@/lib/client/workspace";

const LEVEL_OPTIONS: { value: ShareLevel; label: string; hint: string }[] = [
  { value: "full_access", label: "Full access", hint: "Edit, comment and share with others" },
  { value: "edit", label: "Can edit", hint: "Edit content and comment" },
  { value: "comment", label: "Can comment", hint: "Read and comment" },
  { value: "view", label: "Can view", hint: "Read only" },
];
const LABEL = Object.fromEntries(LEVEL_OPTIONS.map((o) => [o.value, o.label])) as Record<ShareLevel, string>;

interface ShareList {
  ownerId: string;
  direct: ShareRow[];
  inherited: (ShareRow & { fromTitle: string })[];
  link: { token: string; level: ShareLevel; public: boolean; pageId: string; fromTitle: string | null; expiresAt?: number | null } | null;
}

interface Person {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

export async function findPerson(email: string): Promise<Person> {
  const res = await fetch(`/api/people?email=${encodeURIComponent(email)}`);
  const body = (await res.json().catch(() => ({}))) as { person?: Person; error?: { message: string } };
  if (!res.ok || !body.person) throw new Error(body.error?.message ?? "Couldn't find that person.");
  return body.person;
}

type SharePage = { _id: string; title: string; icon?: string | null; kind?: string; isTemplate?: boolean; teamspace?: boolean };

/** Notion's Share menu: a Share tab for people and links, and a Publish tab for the web and sites. */
export function ShareMenu({ page }: { page: SharePage }) {
  const access = usePageAccess();
  const manage = can(access, "full_access");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"share" | "publish">("share");
  const canPublish = manage && !page.isTemplate && (page.kind ?? "page") === "page";
  // Organization pages: who inside the organization can see it, above sharing with others.
  const orgId = activeWorkspace();
  const inOrg = isOrgId(orgId);
  const orgTeams = useOrgDetails(inOrg && open ? orgId : null).data?.teams.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name }));
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(440px,calc(100vw-24px))] p-0"
      trigger={
        <button type="button" className="inline-flex h-7 items-center rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg" aria-haspopup="dialog">
          Share
        </button>
      }
    >
      {open && canPublish && (
        <div role="tablist" aria-label="Share or publish" className="flex gap-1 border-b border-line px-3 pt-2">
          {(["share", "publish"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="share-tab">
              {t === "share" ? "Share" : "Publish"}
            </button>
          ))}
        </div>
      )}
      {open && inOrg && tab === "share" && access.level === "owner" && <OrgAccessSection pageId={page._id} teams={orgTeams} />}
      {open && (canPublish && tab === "publish" ? <PublishPanel page={page} /> : manage ? <ManageShares page={page} /> : <SharedWithYou page={page} />)}
    </Popover>
  );
}

function copy(url: string, message = "Link copied") {
  void navigator.clipboard
    .writeText(url)
    .then(() => toast.success(message, { duration: 1500 }))
    .catch(() => toast.error("Couldn't copy. Copy the address from the browser instead."));
}

function SharedWithYou({ page }: { page: { _id: string; title: string } }) {
  const access = usePageAccess();
  return (
    <div className="grid gap-3 p-4">
      <p className="text-[13.5px] text-fg">
        You have <strong className="font-semibold">{access.level === "owner" ? "full access" : LABEL[access.level].toLowerCase()}</strong> access to “{pageTitle(page.title)}”.
      </p>
      <p className="text-[12.5px] text-fg-3">Only people with full access can invite others or change who can open this page.</p>
      <Button variant="secondary" icon={<Link2 className="size-4" />} onClick={() => copy(`${location.origin}${pageHref(page._id, page.title)}`)}>
        Copy link
      </Button>
    </div>
  );
}

function ManageShares({ page }: { page: SharePage }) {
  const orgPage = isOrgId(activeWorkspace());
  const ws = useWorkspace();
  const access = usePageAccess();
  const q = useOp<ShareList>("shares.list", { pageId: page._id });
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<ShareLevel>("edit");
  const [busy, setBusy] = useState(false);

  const invite = async (e?: FormEvent) => {
    e?.preventDefault();
    const emails = email.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!emails.length) return;
    setBusy(true);
    try {
      for (const address of emails) {
        const person = await findPerson(address);
        await ws.call("shares.invite", { pageId: page._id, granteeId: person.id, email: person.email, name: person.name, image: person.image, level });
        toast.success(`Shared with ${person.name}`, { duration: 2000 });
      }
      setEmail("");
    } catch (err) {
      notifyError(err, "Couldn't share the page.");
    } finally {
      setBusy(false);
    }
  };
  const change = (share: ShareRow, next: ShareLevel | "remove") =>
    (next === "remove" ? ws.call("shares.remove", { id: share._id }) : ws.call("shares.update", { id: share._id, level: next })).catch((err) => notifyError(err));
  const setLink = (next: ShareLevel | null, web = false) => ws.call<{ link: { token: string } | null }>("shares.setLink", { pageId: page._id, level: next, web }).catch((err) => notifyError(err));
  const link = q.data?.link ?? null;
  const linkHere = link && !link.fromTitle;
  const origin = typeof location === "undefined" ? "" : location.origin;
  // Published pages open at /s/<link>/<page> for anyone; other links open the page in Max.
  const url = link?.public ? `${origin}${publicHref(link.token, page._id, page.title)}` : `${origin}${pageHref(page._id, page.title)}${link ? `?share=${link.token}` : ""}`;
  const levels = access.level === "owner" ? LEVEL_OPTIONS : LEVEL_OPTIONS.filter((o) => o.value !== "full_access" || access.level === "full_access");

  if (page.isTemplate) return <p className="p-4 text-[13.5px] text-fg-2">Templates can't be shared. Share a page made from the template instead.</p>;

  return (
    <div className="grid">
      <form onSubmit={invite} className="flex items-center gap-2 border-b border-line p-3">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 px-2 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <UserPlus className="size-4 shrink-0 text-fg-3" aria-hidden />
          <input
            autoFocus
            type="text"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email, separated by commas"
            aria-label="Invite by email"
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-3"
          />
        </label>
        <Select label="Access for new people" size="sm" variant="ghost" value={level} onChange={setLevel} options={levels.map((o) => ({ value: o.value, label: o.label }))} />
        <Button type="submit" size="sm" variant="primary" pending={busy} disabled={!email.trim()}>
          Invite
        </Button>
      </form>

      <div className="scroll-quiet max-h-[min(50dvh,360px)] overflow-y-auto p-2" aria-label="People with access" role="list">
        <Row name={`${ws.settings?.displayName || ws.identity.name} ${access.level === "owner" ? "(You)" : ""}`.trim()} detail={access.level === "owner" ? ws.identity.email ?? null : null} image={access.level === "owner" ? ws.identity.imageUrl ?? null : null} right={<span className="px-2 text-[12.5px] text-fg-3">{access.level === "owner" ? (orgPage ? "Member" : "Owner") : LABEL[access.level as ShareLevel]}</span>} />
        {!q.data && <div className="grid place-items-center py-4"><Spinner label="Loading people" /></div>}
        {q.data?.direct.map((s) => (
          <Row
            key={s._id}
            name={s.name || s.email || "Someone"}
            detail={s.email}
            image={s.image}
            right={
              <Select
                label={`Access for ${s.name || s.email || "this person"}`}
                size="sm"
                variant="ghost"
                value={s.level}
                onChange={(v) => void change(s, v as ShareLevel | "remove")}
                options={[...levels.map((o) => ({ value: o.value as ShareLevel | "remove", label: o.label })), { value: "remove" as const, label: "Remove" }]}
              />
            }
          />
        ))}
        {q.data && q.data.inherited.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-3 text-[12px] font-medium text-fg-3">Access from a page above</p>
            {q.data.inherited.map((s) => (
              <Row key={s._id} name={s.name || s.email || "Someone"} detail={`From “${pageTitle(s.fromTitle)}”`} image={s.image} right={<span className="px-2 text-[12.5px] text-fg-3">{LABEL[s.level]}</span>} />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-line p-3">
        <p className="mb-2 text-[12px] font-medium text-fg-3">General access</p>
        <div className="flex items-center gap-2.5">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", link ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-fg-2")}>{link?.public ? <Globe className="size-4" /> : link ? <Users className="size-4" /> : <Lock className="size-4" />}</span>
          <div className="min-w-0 flex-1">
            <Select
              label="Who can open the link"
              size="sm"
              variant="ghost"
              className="-ms-2"
              value={link?.public ? "web" : link ? "link" : "restricted"}
              onChange={(v) => void (v === "restricted" ? setLink(null) : setLink("view", v === "web"))}
              disabled={!!link && !linkHere}
              options={[
                { value: "restricted", label: orgPage ? "The organization and people invited" : "Only people invited" },
                { value: "link", label: "Anyone in Max with the link" },
                ...(link?.public ? [{ value: "web", label: "Published to the web" }] : []),
              ]}
            />
            <p className="text-[12px] text-fg-3">
              {link
                ? link.fromTitle
                  ? `Set on “${pageTitle(link.fromTitle)}”.`
                  : link.public
                    ? "Published: anyone with the link can read it, no account needed."
                    : page.teamspace
                      ? "Anyone signed in to Max with the link can open it and join the teamspace."
                      : "Anyone signed in to Max with the link can open it and add it to their sidebar."
                : orgPage
                  ? "People in the organization (as set above) and the people listed here can open it."
                  : "Only people listed above can open this page."}
            </p>
          </div>
          {linkHere && link.public && <span className="px-2 text-[12.5px] text-fg-3">Can view</span>}
          {linkHere && !link.public && (
            <Select
              label="Link access"
              size="sm"
              variant="ghost"
              value={link.level as "view" | "comment" | "edit"}
              onChange={(v) => void setLink(v)}
              options={LEVEL_OPTIONS.filter((o) => o.value !== "full_access").map((o) => ({ value: o.value as "view" | "comment" | "edit", label: o.label }))}
            />
          )}
        </div>
        {linkHere && (
          <div className="mt-2 flex items-center gap-2 ps-[42px] text-[12px] text-fg-3">
            <span>{link.expiresAt ? `Stops working ${new Date(link.expiresAt).toLocaleDateString()}` : "Never expires"}</span>
            <Select
              label="Link expiry"
              size="sm"
              variant="ghost"
              value={""}
              onChange={(v) => void ws.call("shares.setLink", { pageId: page._id, level: link.level, web: !!link.public, expiresInDays: v === "never" ? null : Number(v) }).catch((err) => notifyError(err))}
              options={[{ value: "", label: "Change…" }, { value: "1", label: "Expire in 1 day" }, { value: "7", label: "Expire in 7 days" }, { value: "30", label: "Expire in 30 days" }, { value: "never", label: "Never expire" }]}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
          <ChevronDown className="size-3.5 -rotate-90" aria-hidden />
          Sub-pages are shared too
        </span>
        <Button size="sm" variant="secondary" icon={<Link2 className="size-3.5" />} onClick={() => copy(url, link?.public ? "Link copied. Anyone with it can read the page." : link ? (page.teamspace ? "Invite link copied. Anyone signed in with it can join." : "Link copied. Anyone signed in with it can open the page.") : "Link copied. Only people with access can open it.")}>
          {link && !link.public ? "Copy invite link" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

function Row({ name, detail, image, right }: { name: string; detail: string | null; image: string | null; right: React.ReactNode }) {
  return (
    <div role="listitem" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
      <Avatar name={name.replace(/\s*\(You\)$/, "")} url={image} size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-fg">{name}</p>
        {detail && <p className="truncate text-[12px] text-fg-3">{detail}</p>}
      </div>
      {right}
    </div>
  );
}

/** Share → Publish: put the page on the web with a link, and/or publish it with its sub-pages as a site. */
function PublishPanel({ page }: { page: SharePage }) {
  const ws = useWorkspace();
  const q = useOp<ShareList>("shares.list", { pageId: page._id });
  const [busy, setBusy] = useState(false);
  const link = q.data?.link ?? null;
  const inherited = !!link?.fromTitle;
  const live = !!link?.public;
  const url = link?.public ? `${location.origin}${publicHref(link.token, page._id, page.title)}` : "";
  const toggle = async () => {
    setBusy(true);
    try {
      await ws.call("shares.setLink", { pageId: page._id, level: live ? null : "view", web: !live });
      toast.success(live ? "Unpublished from the web" : "Published. Anyone with the link can read it.", { duration: 2000 });
    } catch (err) {
      notifyError(err, "Couldn't change publishing.");
    } finally {
      setBusy(false);
    }
  };
  return (
    // minmax(0, 1fr): long links and inputs shrink to the menu instead of pushing it wider.
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 p-4" aria-label="Publish to the web">
        <div className="flex items-center gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", live ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-fg-2")}>
            <Globe className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-fg">{live ? "Live on the web" : "Publish to the web"}</p>
            <p className="text-[12px] text-fg-3">{inherited ? `Set on “${pageTitle(link!.fromTitle)}”.` : live ? "Anyone with the link can read it, no account needed." : "Anyone with the link can read it. Sub-pages too."}</p>
          </div>
          {!inherited && (
            <Button size="sm" variant={live ? "ghost" : "primary"} pending={busy || !q.data} onClick={() => void toggle()}>
              {live ? "Unpublish" : "Publish"}
            </Button>
          )}
        </div>
        {live && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-fg-2">{url}</span>
            <Button size="sm" variant="secondary" icon={<Link2 className="size-3.5" />} onClick={() => copy(url, "Link copied. Anyone with it can read the page.")}>
              Copy
            </Button>
          </div>
        )}
      </section>
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 border-t border-line p-4" aria-label="Site">
        <div>
          <p className="text-[13.5px] font-medium text-fg">Publish as a site</p>
          <p className="text-[12px] text-fg-3">This page and everything inside it become a simple website with navigation and search.</p>
        </div>
        <SiteForm page={page} />
      </section>
    </div>
  );
}
