# Backup & Restore

Vibe Payroll Time runs four independent backup levels. Levels 1 + 2 are the
primary recovery path; levels 3 + 4 exist so a single compromised or
corrupted appliance can never take all your data down with it.

| Level | Kind                                     | Frequency  | Retention               | Script                                        |
| ----- | ---------------------------------------- | ---------- | ----------------------- | --------------------------------------------- |
| 1     | PostgreSQL WAL archive                   | continuous | 14 days on disk         | `docker-compose.prod.yml` (`archive_mode=on`) |
| 2     | `pg_dump` to local disk                  | nightly    | 14 days                 | `scripts/appliance/backup.sh`                 |
| 3     | Weekly copy to S3-compatible bucket      | weekly     | per S3 lifecycle policy | `scripts/appliance/backup-weekly-s3.sh`       |
| 4     | On-demand per-company logical export ZIP | ad hoc     | forever                 | SuperAdmin UI                                 |

## Setting it up

### Level 1 — WAL archiving

Enabled by default in `docker-compose.prod.yml`. WAL segments are written to
the host directory `$WAL_ARCHIVE_DIR` (default `/var/backups/vibept-wal/`).
Ensure that directory exists, is owned by the `postgres` container's UID
(typically 70 on alpine), and that the host has free space to absorb at least
a week of WAL:

```bash
sudo mkdir -p /var/backups/vibept-wal
sudo chown 70:70 /var/backups/vibept-wal
```

To disable WAL archiving (e.g., for a demo appliance): set
`WAL_ARCHIVE_MODE=off` in `.env` and restart postgres.

### Level 2 — nightly pg_dump

Add to the appliance user's crontab:

```
0 2 * * * /opt/vibept/scripts/appliance/backup.sh >> /var/log/vibept-backup.log 2>&1
```

### Level 3 — weekly S3 copy

1. Install rclone on the host: `sudo apt install rclone`
2. Configure a remote: `rclone config` → pick S3/B2/Wasabi/etc.
3. Add to `/opt/vibept/.env`: `RCLONE_REMOTE=remote:bucket/vibept-backups`
4. Cron:

```
17 3 * * 0 /opt/vibept/scripts/appliance/backup-weekly-s3.sh >> /var/log/vibept-backup-s3.log 2>&1
```

Server-side retention: set a lifecycle policy on your bucket — the script
never deletes remote objects.

### Level 4 — on-demand export-everything ZIP

SuperAdmin → **Appliance → Companies → ZIP →**. Produces one ZIP per company
containing JSONL for every table plus a manifest. Sensitive columns (API
keys, password + PIN hashes, refresh tokens) are redacted; the ZIP is safe
to email to a CPA for audit without leaking credentials.

## Restoring

### Full-server recovery (Level 2)

```bash
# 1. Stand up a fresh appliance on the target host.
# 2. Copy the chosen nightly dump to the host.
# 3. Run restore.sh, which stops the services, drops the schema, and restores.
sudo /opt/vibept/scripts/appliance/restore.sh /var/backups/vibept/vibept-20260418T020000Z.sql.gz
```

The restore script will:

1. Prompt for confirmation (skippable with `FORCE=1`)
2. Stop backend + frontend + caddy
3. Drop + recreate the `public` schema in the existing database
4. Pipe the dump into `psql`
5. Run any pending migrations (in case the dump predates the image)
6. Restart services

### Point-in-time recovery (Level 1 + 2)

Requires `pgBackRest`, `wal-e`, or a similar tool — out of scope for this
appliance's default tooling. The raw WAL archive is available at
`$WAL_ARCHIVE_DIR`; a DBA can replay it onto a Level-2 base backup. See
PostgreSQL's [Continuous Archiving](https://www.postgresql.org/docs/16/continuous-archiving.html)
docs for procedure. If you need us to help with a PITR, email
**support@kisaes.com** with the timestamp you want to restore to.

### Single-company restore (Level 4)

You cannot directly restore a Level-4 ZIP into an existing company — it's a
logical snapshot, not a pg_dump. It is useful for:

- Exporting data when a customer leaves the platform
- Giving a CPA a full read of a company's audit trail
- Verifying the Level 1/2/3 pipeline matches what you think it does (diff the
  ZIP against your most recent pg_dump)

## Restore drill

Run this every quarter against a disposable copy of production:

1. Spin up a fresh VM with Docker.
2. `./install.sh` to deploy the appliance.
3. Copy yesterday's dump from the production backup directory.
4. Run `FORCE=1 /opt/vibept/scripts/appliance/restore.sh <dump>`.
5. Sign in as a known employee and verify the most recent week's timesheet
   matches what you expect.
6. Wipe the VM.

Log the time-to-recover in your ops notes. Our target for a Level-2 restore
is **under 15 minutes** for a company with 500 employees and 3 years of
history.
