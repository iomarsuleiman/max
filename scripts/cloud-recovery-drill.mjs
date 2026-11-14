import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { compareSnapshots } from "./cloud-recovery-verify.mjs";

// This harness only accepts the two newly provisioned, expiring drill deployments.
// It cannot target the existing Max development or production deployment.
const SOURCE = "rare-gnat-409";
const TARGET = "rare-hound-549";
const directory = path.resolve(process.argv[3] ?? "");
const mode = process.argv[2];
if (!["seed", "restore", "verify", "inspect", "traffic"].includes(mode) || !process.argv[3])
  throw new Error("Usage: node scripts/cloud-recovery-drill.mjs seed|restore|verify|inspect|traffic private-artifact-directory");
await mkdir(directory, { recursive: true });
const globalConfig = JSON.parse(await readFile(path.join(homedir(), ".convex/config.json"), "utf8"));
const headers = { Authorization: `Bearer ${globalConfig.accessToken}`, "Content-Type": "application/json" };

async function credentials(name) {
  const metadataResponse = await fetch(`https://api.convex.dev/v1/deployments/${name}`, { headers });
  if (!metadataResponse.ok) throw new Error("Cannot verify drill deployment metadata.");
  const metadata = await metadataResponse.json();
  assert.equal(metadata.deploymentType, "dev");
  assert.equal(metadata.isDefault, false);
  assert.equal(metadata.projectId, 3401883);
  assert.equal(metadata.reference, `dev/max-recovery-${name === SOURCE ? "source" : "target"}-20261111`);
  const response = await fetch("https://api.convex.dev/api/deployment/authorize_within_current_project", {
    method: "POST",
    headers,
    body: JSON.stringify({ selectedDeploymentName: name, projectSelection: { kind: "teamAndProjectSlugs", teamSlug: "omar-suliman", projectSlug: "max" } }),
  });
  if (!response.ok) throw new Error("Cannot authorize disposable drill deployment.");
  const result = await response.json();
  assert.equal(result.deploymentName, name);
  return result;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function client(auth, owner) {
  const http = new ConvexHttpClient(auth.url, { logger: false });
  http.setAdminAuth(auth.adminKey, { subject: owner, issuer: "https://max-recovery.invalid", tokenIdentifier: `https://max-recovery.invalid|${owner}` });
  return {
    q: (op, args = {}) => http.query("ops:query", { op, args }),
    m: (op, args = {}) => http.mutation("ops:mutation", { op, args }),
  };
}
function cli(args) {
  const result = spawnSync(process.execPath, [path.resolve("node_modules/convex/bin/main.js"), ...args], { encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) throw new Error(`Convex ${args[0]} failed. Inspect the disposable deployment dashboard.`);
}

if (mode === "seed") {
  const source = await credentials(SOURCE);
  const a = client(source, "recovery-account-a");
  const b = client(source, "recovery-account-b");
  assert.equal((await a.q("pages.tree")).pages.length, 0, "Source already seeded; refusing to duplicate data.");
  assert.equal((await b.q("pages.tree")).pages.length, 0);
  const root = (await a.m("pages.create", { title: "Cloud recovery العربية", markdown: "Initial version" })).page._id;
  const child = (await a.m("pages.create", { parentId: root, title: "Nested bilingual child", markdown: "Nested English العربية" })).page._id;
  const archived = (await a.m("pages.create", { parentId: root, title: "Archived original", markdown: "Retain archived content" })).page._id;
  const db = (await a.m("pages.create", { parentId: root, kind: "database", title: "Recovery tasks" })).page._id;
  const record = (await a.m("records.create", { databaseId: db, values: { Name: "Preserved record" } })).record._id;
  const other = (await b.m("pages.create", { title: "Other tenant private page", markdown: "Tenant B" })).page._id;
  const blocks = JSON.parse(await readFile("tests/fixtures/editor-document.json", "utf8"));
  await a.m("documents.save", { pageId: root, blocks, baseRevision: 1 });
  const version = (await a.m("versions.create", { pageId: root })).versionId;
  const comment = (await a.m("comments.add", { pageId: root, blockId: "gold-paragraph", body: "Preserve anchored comment العربية" })).comment._id;
  await a.m("pages.archive", { id: archived });
  const assets = [];
  for (const [index, bytes] of [Buffer.from([0, 255, 128, 10, 13, 42]), Buffer.from("Binary recovery العربية\n", "utf8")].entries()) {
    const { uploadUrl } = await a.m("assets.createUploadUrl");
    const upload = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "text/plain" }, body: bytes });
    assert.equal(upload.ok, true);
    const { storageId } = await upload.json();
    const asset = await a.m("assets.register", { storageId, pageId: root, name: `recovery-${index}.txt`, type: "text/plain", size: bytes.length });
    assets.push({ id: asset.id, sha256: sha256(bytes), size: bytes.length, type: "text/plain" });
  }
  const document = await a.q("documents.get", { pageId: root });
  const childDocument = await a.q("documents.get", { pageId: child });
  const manifest = { source: SOURCE, target: TARGET, root, child, archived, db, record, other, version, comment, assets, document, childDocument };
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest), { flag: "wx" });
  cli(["export", "--deployment", SOURCE, "--include-file-storage", "--path", path.join(directory, "source.zip")]);
  console.log(JSON.stringify({ seeded: true, pages: 6, attachments: assets.length, source: SOURCE }));
}

if (mode === "restore") {
  await credentials(TARGET);
  cli(["import", "--deployment", TARGET, path.join(directory, "source.zip")]);
  cli(["export", "--deployment", TARGET, "--include-file-storage", "--path", path.join(directory, "restored.zip")]);
  const result = compareSnapshots(await readFile(path.join(directory, "source.zip")), await readFile(path.join(directory, "restored.zip")));
  await writeFile(path.join(directory, "archive-report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ restored: true, ...result }));
}

if (mode === "verify" || mode === "inspect") {
  const target = await credentials(TARGET);
  const a = client(target, "recovery-account-a");
  const b = client(target, "recovery-account-b");
  const f = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const restoredDocument = await a.q("documents.get", { pageId: f.root });
  if (mode === "verify") assert.deepEqual(restoredDocument, f.document);
  else {
    assert.deepEqual(restoredDocument.blocks, f.document.blocks);
    assert.equal(restoredDocument.revision, f.document.revision + 2);
  }
  assert.deepEqual(await a.q("documents.get", { pageId: f.child }), f.childDocument);
  assert.equal((await a.q("pages.get", { id: f.child })).page.parentId, f.root);
  assert.equal((await a.q("pages.get", { id: f.archived })).inTrash, true);
  assert.equal((await a.q("pages.get", { id: f.record })).page.databaseId, f.db);
  const comments = await a.q("comments.list", { pageId: f.root });
  assert.equal(comments.comments[0]._id, f.comment);
  assert.equal(comments.comments[0].blockMissing, false);
  for (const asset of f.assets) {
    const resolved = await a.q("assets.getUrl", { id: asset.id });
    const response = await fetch(resolved.url);
    assert.equal(response.ok, true);
    assert.equal(response.headers.get("Content-Type")?.split(";")[0], asset.type);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), asset.sha256);
    assert.equal(bytes.length, asset.size);
    await assert.rejects(b.q("assets.getUrl", { id: asset.id }));
  }
  for (const [op, args] of [
    ["documents.get", { pageId: f.root }],
    ["pages.get", { id: f.root }],
    ["comments.list", { pageId: f.root }],
    ["versions.get", { id: f.version }],
  ])
    await assert.rejects(b.q(op, args));
  await assert.rejects(a.q("documents.get", { pageId: f.other }));
  assert.equal((await b.q("pages.tree")).pages.length, 1);
  if (mode === "verify") {
    await a.m("documents.writeMarkdown", { pageId: f.root, markdown: "Target-only post-restore edit", baseRevision: f.document.revision });
    const edited = await a.q("documents.get", { pageId: f.root });
    assert.equal(edited.revision, f.document.revision + 1);
    await a.m("versions.restore", { id: f.version });
    assert.deepEqual((await a.q("documents.get", { pageId: f.root })).blocks, f.document.blocks);
  }
  const source = client(await credentials(SOURCE), "recovery-account-a");
  assert.deepEqual(await source.q("documents.get", { pageId: f.root }), f.document);
  const report = {
    verified: true,
    method: "deployed Max operations with Convex administrator identity impersonation",
    sourceUntouched: true,
    stableDocumentIdsAndRevisions: true,
    corpusRestored: true,
    anchoredComment: true,
    archivedAndDatabaseRows: true,
    tenantDenials: 7,
    attachmentDownloads: f.assets.length,
    editRefreshRestore: true,
    clerkBrowserLogin: "not exercised",
    mode,
  };
  await writeFile(path.join(directory, mode === "inspect" ? "inspection-report.json" : "application-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

if (mode === "traffic") {
  const auth = await credentials(SOURCE);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const frames = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 };
  class MeteredSocket extends WebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (event) => {
        frames.received++;
        frames.receivedBytes += typeof event.data === "string" ? Buffer.byteLength(event.data) : (event.data.byteLength ?? event.data.size ?? 0);
      });
    }
    send(data) {
      frames.sent++;
      frames.sentBytes += typeof data === "string" ? Buffer.byteLength(data) : (data.byteLength ?? data.size ?? 0);
      super.send(data);
    }
  }
  const live = new ConvexClient(auth.url, { logger: false, webSocketConstructor: MeteredSocket });
  live.setAdminAuth(auth.adminKey, {
    subject: "recovery-account-a",
    issuer: "https://max-recovery.invalid",
    tokenIdentifier: "https://max-recovery.invalid|recovery-account-a",
  });
  let updates = 0;
  const unsubscribes = [];
  let timeout;
  try {
    const started = performance.now();
    await Promise.race([
      Promise.all(
        [
          ["pages.tree", {}],
          ["documents.get", { pageId: manifest.root }],
        ].map(
          ([op, args]) =>
            new Promise((resolve, reject) => {
              unsubscribes.push(
                live.onUpdate(
                  "ops:query",
                  { op, args },
                  () => {
                    updates++;
                    resolve();
                  },
                  reject,
                ),
              );
            }),
        ),
      ),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Subscription timed out.")), 15_000);
      }),
    ]);
    clearTimeout(timeout);
    const initial = { ...frames, updates, readyMs: Math.round(performance.now() - started) };
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const idle = Object.fromEntries(Object.entries(frames).map(([key, value]) => [key, value - initial[key]]));
    const report = {
      deployment: SOURCE,
      synthetic: true,
      authenticatedVia: "admin identity impersonation",
      subscriptions: 2,
      initial,
      idle: { durationMs: 10_000, ...idle, updates: updates - initial.updates },
      measured: "WebSocket payload bytes, excluding TLS/HTTP headers; one sample, no browser/Clerk traffic",
    };
    await writeFile(path.join(directory, "traffic-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    clearTimeout(timeout);
    for (const unsubscribe of unsubscribes) unsubscribe();
    await live.close();
  }
}
