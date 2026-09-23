/**
 * Restore drill: restores a backup made by scripts/backup.ts into a fresh, separate database — never
 * the live one — so this is safe to run against production backups without any risk of overwriting
 * real data. Do this on a schedule (quarterly at minimum, per DEPLOY.md §8): a backup nobody has ever
 * restored is not a backup.
 *
 * Needs the PostgreSQL client tools (`psql`, `pg_restore`) on PATH.
 *
 *   npm run db:restore -- backups/sabeel_2026-09-22T12-00-00Z.dump
 *   RESTORE_DB_NAME=sabeel_restore_drill (default) — override to run drills in parallel
 */
import { spawn } from "node:child_process";

function loadDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — run with `--env-file=.env` or export it first.");
  return url;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("error", (e) => reject(new Error(`Could not start ${cmd} — is it installed and on PATH? (${e.message})`)));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run db:restore -- <path-to-.dump-file>");
    process.exit(2);
  }

  const sourceUrl = new URL(loadDatabaseUrl());
  const liveDbName = sourceUrl.pathname.slice(1);
  const drillDbName = process.env.RESTORE_DB_NAME ?? "sabeel_restore_drill";
  if (drillDbName === liveDbName) {
    throw new Error('RESTORE_DB_NAME must not be the live database name — refusing to touch it. This script only ever restores into a separate drill database.');
  }

  const drillUrl = new URL(sourceUrl.toString());
  drillUrl.pathname = `/${drillDbName}`;
  // The server's own maintenance database, to run CREATE/DROP DATABASE from.
  const adminUrl = new URL(sourceUrl.toString());
  adminUrl.pathname = "/postgres";

  console.log(`Restore drill: recreating "${drillDbName}" (this database only — "${liveDbName}" is never touched)...`);
  await run("psql", [adminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${drillDbName}"`]);
  await run("psql", [adminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${drillDbName}"`]);

  console.log(`Restoring ${file}...`);
  await run("pg_restore", ["--dbname", drillUrl.toString(), "--no-owner", file]);

  console.log(`\nRestored into "${drillDbName}". Point a throwaway DATABASE_URL at it and spot-check real data`);
  console.log(`(a supplier's catalogue, a buyer's order history, a fee invoice) before trusting this backup.`);
  console.log(`Time how long this whole drill took — that is your actual restore time, not the RTO target.`);
}

main().catch((e) => {
  console.error("Restore drill failed:", e.message ?? e);
  process.exit(1);
});
