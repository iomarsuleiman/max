# Operation permission requirements

`lib/domain/collaboration/operationRequirements.ts` records the required policy
checks for every current domain operation, MCP composite tool and Notion connector
action. It reuses `PageCapability` from the collaboration policy. It is a design
contract, not a permission evaluator. The live dispatcher and storage adapters do
not consume it, and a `declared_requirements` result never means access is allowed.
Unmapped operation/tool names return `deny`; there is no query/read or
mutation/edit fallback.

The registry coverage test compares exact operation names, including UI-only
credential and account operations. MCP coverage compares the advertised composite
tool list and underscore aliases against their declarations. Adding a new
operation without its classification fails the tests. Retired entries also fail.

## Categories

| Classification | Required boundary                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account only   | Actor-owned settings, cards, credentials, connection metadata and personal audit; never organization administration.                                     |
| Personal only  | Legacy bootstrap, account-wide deletion, bulk trash purge and backup import retain personal-workspace semantics until separate shared contracts exist.   |
| Page           | Resolve the real page, then check the specific read, content, metadata, schema, history or comment capability. A block ID grants nothing.                |
| Discovery      | Filter each visible result before pagination, matching snippets, counts, graph traversal, rollups, calculations and serialization.                       |
| Compound       | Independently authorize source, destination, related database, attachment and side effects in the selected input branch.                                 |
| Recursive      | Authorize every affected descendant/row before mutation. Reject the whole operation if any selected page fails.                                          |
| Batch          | Classify and authorize each item in the transaction, including dependencies created by earlier items. Unknown and nested batch operations remain denied. |
| Catalog        | Built-in template and tool metadata confer no access to private resources.                                                                               |
| External       | Keep provider/source permissions separate from Max destination permissions and recheck authority at each background checkpoint.                          |

Selectors distinguish direct page arguments, each ID in a bulk list, entity-to-page
lookups for comments/assets/versions, record databases, source containers, template
databases and persisted job destinations. Null parent destinations require a
separate workspace-root creation authority; page grants do not imply that
authority. Template application explicitly selects the page-template or
row-template destination branch. Optional conditions are requirements for a future
evaluator to implement, not instructions to silently skip missing resources.

## Handler changes required before shared adapters

- `pages.touch`, recents and favorites currently use page-row state. Shared
  adapters must use per-user navigation records. A reader can change their own
  favorites without changing shared metadata.
- `properties.update` and `properties.delete` can rewrite values on all rows.
  Preflight each row, including restricted descendants. `records.*` and template
  values may implicitly create select options, which requires schema authority in
  addition to value-edit authority.
- Database queries must filter relation/rollup inputs before computation. Schema
  reads, backlinks, breadcrumbs, graph degrees, trash counts, export paths and
  resolved mention titles can all disclose otherwise hidden resources.
- `import.bundle.existing` is not just a source lookup. Existing aliases may
  become parents and existing documents may be rewritten by link repair. Check
  same-import provenance, read authority, destination creation authority and
  content/revision authority for each actual use.
- Resolve comment, version and asset IDs on the server to their current policy
  page. Comments also need author/moderator rules. History restore needs separate
  metadata authority when `restoreTitle` is true; old content cannot restore old
  grants.
- Bind pending uploads to actor/workspace/quota before creating upload URLs.
  Registering an arbitrary storage ID must not claim someone else's upload.
  Null-page assets stay private. URL resolution and file bytes need revocable
  delivery, not just an authorized metadata lookup. Detach references safely
  before deleting bytes shared by other pages or workspaces.
- Copy and export operations must authorize every included source/row and the
  actual destination, then remap content references and attachment ownership
  deliberately. A readable parent does not imply readable descendants. Restore
  cannot silently move a restricted branch to a more permissive workspace root.
- `page.archive` does not mean permanent purge. A dedicated shared purge and
  retention contract is still missing. Account deletion must revoke personal
  credentials and handle membership/last-owner transfer without deleting content
  belonging to other members or removing referenced files.
- Notion jobs retain actor, source, destination and token scope. Recheck all
  permissions on retry and each worker checkpoint. Job reports/history must redact
  revoked destinations. Owners can cancel their own jobs after destination
  revocation without reading its content. OAuth begin/complete/disconnect remain
  UI-only.

Every transport must derive actor/workspace identity on the server, intersect MCP
token resource/action scope, and recheck fresh grants before writes, subscriptions,
file responses and background work. Idempotency replay must reauthorize before
returning a cached result, because that result may contain IDs or content the
actor can no longer read. Keep unauthorized and missing IDs indistinguishable.
Preserve existing schema validation, confirmation, revision, lock and atomicity
checks when adding these requirements.

No current operation is a page-share or membership-management endpoint. Those
future names are unmapped and denied by this manifest until explicitly classified.
The manifest alone does not enable shared tools, sharing, migration or cloud sync.

## Verification

Upload registration still requires authenticated ownership receipts before
shared content can be exposed. A caller-supplied `storageId` alone cannot prove
who uploaded the bytes. The personal database facade checks attachment records
and page scope, but cannot prove exclusive blob ownership across accounts.
Validation now leaves request-selected bytes untouched instead of deleting them.
An authenticated upload path must bind each stored blob to its uploader before
registration, with safe orphan cleanup and revocable delivery for shared files.

```powershell
pnpm exec vitest run tests/unit/operationRequirements.test.ts
pnpm typecheck
```

The targeted tests verify full registry/MCP coverage, default denial, UI-only
boundaries, indirect entity resolution, recursive and bulk checks, discovery
filter ordering, option/schema side effects, chunk-import rewrites, comments,
history, batch and replay/worker obligations. They validate the declared contract;
server enforcement and adversarial adapter tests are separate work.
