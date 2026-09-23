# Deploying Sabeel

This is the runbook for taking the app from a developer's machine to a supervised, backed-up,
TLS-terminated production deployment (lean prompt §7 "Safeguards that stay in the MVP" and
acceptance criterion 12). It assumes a single KSA-region Linux VM to start — the stack is a
modular monolith on purpose, so this is enough for the pilot; move to a container orchestrator
later if load requires it.

**What this document cannot do for you**: provision a real server, buy a domain, or run a
penetration test. Those are the owner's/ops's actions — everything here is what the *app* needs
from its environment, written so whoever does the provisioning has a checklist.

## 1. Before you deploy anywhere real

- [ ] Hosting is in a **KSA region** (PDPL — lean prompt §7/§9), or the exception is documented and
      signed off by counsel.
- [ ] A real SMS provider adapter is written in `src/lib/sms.ts` (the `console` provider is refused
      outright when `NODE_ENV=production` — see `src/lib/sms.ts`).
- [ ] The four draft agreements have been reviewed by counsel and marked so in *Admin → Agreements*
      (production refuses to approve suppliers until every type has a legally-reviewed current version).
- [ ] `SEED_SUPERADMIN_MOBILE` is the real owner's number, not the dev placeholder (the seed script
      refuses the placeholder in production — see `prisma/seed.ts`).
- [ ] Demo/fictional suppliers and brands (`prisma/seed.ts --demo`) are never run against production.

## 2. Environment

Copy `.env.example` to `.env` on the server and fill in real values — **never commit `.env`** (it is
git-ignored; double-check with `git check-ignore .env` before any commit that might have touched it).
`src/lib/env.ts` validates every value at first use with Zod, so a missing/malformed key fails loudly
on boot rather than silently misbehaving.

Generate `OTP_PEPPER` and `DATA_KEY` freshly per environment (dev, staging, prod each get their own —
never reuse a key across environments):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`DATA_KEY` encrypts national ID numbers at the field level (AES-256-GCM). **Rotating it makes every
previously-encrypted value unreadable** — back it up somewhere as carefully as the database itself
(a secrets manager, not a text file next to the app).

## 3. Build, migrate, seed

```bash
npm ci
npm run db:generate
npm run db:migrate      # `prisma migrate deploy` — applies committed migrations, never generates new ones
npm run build
npm run db:seed         # creates the super-admin + district list; never pass --demo in production
```

Migrations here are Prisma's own history under `prisma/migrations/` — forward-only and reviewed in
this repo, so a deploy is always a known, reversible set of SQL statements (never `prisma db push`
against production).

## 4. Process supervision (auto-restart on crash or reboot)

Run `npm run start` under a supervisor, not directly in a terminal. A `systemd` unit is the simplest
option on a single Linux VM:

```ini
# /etc/systemd/system/sabeel.service
[Unit]
Description=Sabeel application
After=network.target postgresql.service

[Service]
Type=simple
User=sabeel
WorkingDirectory=/srv/sabeel-app
EnvironmentFile=/srv/sabeel-app/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
# The app should not need more than one instance for the pilot's scale; see §7 if it does.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sabeel
sudo systemctl status sabeel     # confirm it's running
curl -s http://127.0.0.1:3020/api/v1/health | jq   # {"ok":true,"db":true,"jobsRunningHere":true,...}
```

`journalctl -u sabeel -f` follows the logs. A reboot test (`sudo reboot`, then confirm the health
endpoint answers within a couple of minutes) is the cheapest way to prove "self-recovers after a
reboot" (acceptance criterion 12).

## 5. TLS (auto-renewing)

Put a reverse proxy in front of the Node process — it should never be exposed to the internet
directly. [Caddy](https://caddyserver.com/) gets you automatic Let's Encrypt certificates and
renewal with almost no configuration:

```
# /etc/caddy/Caddyfile
sabeel.example.sa {
    reverse_proxy 127.0.0.1:3020
    encode gzip
}
```

`sudo systemctl reload caddy` picks it up; Caddy renews the certificate on its own well before
expiry — nothing else to schedule. (An nginx + certbot setup works too if that's the team's existing
standard; the requirement is auto-renewal, not a specific tool.)

## 6. Rate limiting

Two layers exist today:
- **OTP** (`src/lib/otp.ts`): per-mobile and per-IP hourly caps, a resend cooldown, and a max-guess
  lock — all backed by real `OtpChallenge` rows, so they survive restarts and work across instances.
- **A generic in-memory limiter** (`src/lib/rateLimit.ts`), applied to order placement, review
  submission, dispute reports, and fee-invoice payment submission. **This one is single-process only**
  — fine at the pilot's scale (one app instance), but it resets on every restart and doesn't share
  state across instances. If you ever run more than one app instance behind a load balancer, replace
  its in-memory `Map` with a shared store (Redis `INCR`+`EXPIRE` is the usual choice) before relying
  on it — check `src/lib/rateLimit.ts`'s own comment when you get there.

Consider adding a layer in front too (Caddy/nginx `rate_limit`, or a WAF) once there is real traffic
to tune it against — the app-level limiter is meant to stop obvious abuse, not replace edge protection.

## 7. Monitoring and alerts

`GET /api/v1/health` is unauthenticated and cheap (one `SELECT 1`); point an external uptime monitor
at it (UptimeRobot, Better Stack, a simple cron + curl + alert — whatever the team already uses) and
alert on anything but `200 {"ok":true}`. It also reports whether the background job loop is running
in *this* process (`jobsRunningHere`) — informational only, since a valid multi-instance deployment
can run jobs from one dedicated process and set `JOBS_ENABLED=false` everywhere else.

`journalctl -u sabeel` (or your log shipper of choice) is the place for application logs; background
job passes log a one-line JSON summary only when they actually did something (`src/server/jobs.ts`),
so a quiet log is a healthy sign, not a broken one.

## 8. Backups (RPO ≤ 15 min, RTO ≤ 4 h — lean prompt §7)

```bash
npm run db:backup                 # scripts/backup.ts — pg_dump to a timestamped .dump file
```

Schedule it (cron/systemd timer) at least every 15 minutes if the target RPO is taken literally, or
rely on your Postgres host's continuous WAL archiving/point-in-time recovery if it offers one (most
managed Postgres does, and it beats a periodic `pg_dump` for RPO). Either way, **store the backup
somewhere other than the app server** — object storage in the same KSA region is the natural choice.

```bash
# cron, every 15 minutes, keeping 7 days locally in addition to wherever they're shipped
*/15 * * * * cd /srv/sabeel-app && npm run db:backup >> /var/log/sabeel-backup.log 2>&1
```

### Restore drill (do this quarterly, not just once)

```bash
npm run db:restore -- backups/sabeel_2026-09-22T12-00-00.dump   # scripts/restore.ts
```

`scripts/restore.ts` restores into a **new, empty database** it creates for the drill
(`sabeel_restore_drill` by default) rather than overwriting anything live — point a throwaway app
instance at that database afterwards and confirm real data reads back correctly (a supplier's
catalogue, a buyer's order history, a fee invoice) before you trust the backup. Time the whole drill;
that duration is your actual RTO, not the target one.

## 9. Staging

Run the same build against a separate database and `.env` (its own `OTP_PEPPER`/`DATA_KEY`, its own
`APP_ORIGIN`) before every production deploy that touches a migration or a payment/fee/dispute flow.
The `verify`/`verify:2`.../`verify:6` scripts (see `README.md`) are written to run against *any*
`VERIFY_BASE` — point `VERIFY_BASE` at staging and run the full suite there as a pre-deploy gate.

## 10. What's still an owner/ops action, not code

- A real SMS provider account and sender ID.
- The actual KSA-region server/VM and domain.
- Running the OWASP ASVS L2 review and a penetration test before public launch (lean prompt §10) —
  this repo has not had one.
- A WCAG 2.2 AA audit with real assistive technology, beyond the phone-width/RTL checks already done
  per slice.
- Deciding and documenting the actual recipient-PII retention period with counsel (see README's known
  gaps — the driver-location purge job is built and running; a recipient name/mobile/address purge is
  deliberately not, pending that legal input).
