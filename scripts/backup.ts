/**
 * Daily backup (`backup.daily` in the design pack's job list). Wraps `pg_dump` in Postgres's custom
 * format (compressed, restorable with `pg_restore` — see scripts/restore.ts) so a backup is one file
 * per run, timestamped, dropped into `BACKUP_DIR` (default ./backups, git-ignored).
 *
 * Needs the PostgreSQL client tools (`pg_dump`) on PATH — install the `postgresql-client` package
 * (or matching major version) on whatever host runs this. Schedule it with cron/systemd — see DEPLOY.md.
 *
 *   npm run db:backup
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function loadDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — run with `--env-file=.env` or export it first.");
  return url;
}

function timestamp(d = new Date()): string {
  return d.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

async function main() {
  const dir = process.env.BACKUP_DIR ?? path.resolve(process.cwd(), "backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `sabeel_${timestamp()}.dump`);
  const databaseUrl = loadDatabaseUrl();

  console.log(`Backing up ${databaseUrl.replace(/:[^:@]+@/, ":***@")} → ${file}`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("pg_dump", ["--format=custom", "--file", file, databaseUrl], { stdio: "inherit" });
    p.on("error", (e) => reject(new Error(`Could not start pg_dump — is it installed and on PATH? (${e.message})`)));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`))));
  });
  console.log(`Backup written: ${file}`);
  console.log("Remember: a backup that has never been restored is not a backup — run scripts/restore.ts against it periodically (DEPLOY.md §8).");
}

main().catch((e) => {
  console.error("Backup failed:", e.message ?? e);
  process.exit(1);
});
