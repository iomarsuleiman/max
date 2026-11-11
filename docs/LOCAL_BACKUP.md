# Local backup and restore

Use this for a self-hosted local workspace. It copies the entire local data
directory, including database rows, revisions, history, comments, settings,
tokens, attachment bytes and MIME sidecars. Cloud deployments need a separate
Convex database and file backup procedure.

Stop every Max process using the source directory before starting. The command
checks for changes while copying, but that check cannot replace stopping writes.
`--stopped` records your acknowledgment of this requirement.

The destination's parent must already exist. Every backup and restore requires
a new destination directory. Existing files are never overwritten.

```powershell
pnpm backup:local create --source C:/Max/data --destination D:/Backups/max-2026-11-10 --stopped
pnpm backup:local verify --backup D:/Backups/max-2026-11-10
pnpm backup:local restore --backup D:/Backups/max-2026-11-10 --destination C:/Max/recovery-2026-11-10
```

The backup has a `data/` directory and `manifest.json`. The manifest lists each
file's length and SHA-256 checksum. Verification rejects missing, added or
changed files, invalid database JSON, missing registered attachments, and links.
The checksums detect accidental changes; they are not an authenticated signature.
The backup is unencrypted and contains private data and token hashes. Store it
with the same access controls as the original data directory.

An interrupted or failed operation can leave a partial destination. Keep the
original and use another new destination for a retry. A backup is complete only
after `verify` succeeds. Do not edit the manifest to make a failure pass.

Start a recovery instance from the restored directory:

```powershell
$env:MAX_LOCAL_MODE = 'true'
$env:MAX_DATA_DIR = 'C:/Max/recovery-2026-11-10'
pnpm start --port 3215
```

First check representative pages, database rows, history, comments and attachment
downloads. Keep the source directory unchanged until the recovery has been
accepted. To return to it, stop the recovery process, set `MAX_DATA_DIR` back to
the original directory and restart the original application version.

JSON export from Settings remains useful for content copies. It creates new
page IDs on import and does not contain attachment bytes, comments or history.
Use a full local backup for an exact local recovery.

Run the filesystem recovery checks with `pnpm test:backup`. They use disposable
directories and exercise the CLI as well as corruption and overwrite failures.
