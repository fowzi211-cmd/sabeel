# Sabeel (سبيل) — application

Water-charity delivery platform for Saudi Arabia (pilot: Makkah). This repository holds the
running application. The product decisions live next door in
[`../water-charity-platform`](../water-charity-platform) — read `PLATFORM_PROMPT_LEAN.md` (what
we are building) and `design/DESIGN_PACK.md` (screens, data model, state machines) first.

**Status: all 6 slices are built and verified.** Slice 1 = accounts, supplier and
independent-distributor onboarding, admin approval, Brand Registry, online agreement acceptance.
Slice 2 = supplier catalogue and prices, Makkah districts and delivery rules, offer comparison,
and ordering (place / cancel) with a read-only supplier inbox and admin district/order screens.
Slice 3 = supplier accept/decline with automatic re-routing and an expiry job, the supplier's drivers,
the offline-capable driver app (navigation, recipient code, photo proof) and admin review of delivery
proof. Slice 4 = the buyer confirms receipt (or Sabeel does, after 72 h of silence), the buyer pays
the supplier directly and marks it, the supplier confirms receipt, disputes (wrong/short/late delivery,
or non-payment) pause and are resolved by an admin, and the supplier's Payments page shows every
transaction and what they keep. Slice 5 = the Sabeel fee accrues on delivered orders and is billed
on system-generated invoices, a credit ceiling with warnings and automatic pause/suspend protects the
platform from unpaid fees, on-time payers earn a higher ceiling and monthly billing, admins publish
fee-rate changes with notice, and donors leave one review per order (reply, moderation, and a real
rating in offer comparison). Slice 6 = a unified admin dashboard surfacing every queue in one place,
proactive document-expiry and agreement-re-acceptance notices, a 30-day driver-location retention purge,
a generic rate limiter on the write endpoints that lacked one, a public health-check endpoint, and the
deployment/backup/admin runbooks (`DEPLOY.md`, `ADMIN_GUIDE.md`) the app needs to run somewhere real.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind 4 with logical properties (Arabic RTL is the
default, English mirrors it) · Prisma **6.19.3** (pinned — Prisma 7 breaks installs on this
machine) · PostgreSQL 18 · Zod 4 · `otpauth` + `qrcode` for authenticator-app 2FA.

> Next.js 16 differs from older versions: `proxy.ts` replaces `middleware.ts`, and `cookies()`,
> `params` and `searchParams` are Promises. See `AGENTS.md` and `node_modules/next/dist/docs/`.

## Run it

```bash
npm install
cp .env.example .env        # then fill in real values — see the table below and .env.example's own comments
npm run db:migrate          # apply migrations
npm run db:seed:demo        # super-admin, agreement drafts v1.0, fee rule, 3 FICTIONAL brands
npm run dev                 # http://localhost:3020
```

Taking this to a real server? See `DEPLOY.md` (process supervision, TLS, backups, monitoring) and
`ADMIN_GUIDE.md` (for whoever runs the admin console day to day).

In development the SMS provider is `console`: one-time codes are printed in the server log
**and echoed in the sign-in screens** ("Development mode: your code is …"). That echo only exists
when `NODE_ENV != production`; in production the console provider is refused (see Security).

### Environment (`.env`)

| Key | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (dev DB `sabeel_dev` on port 5433) |
| `APP_ORIGIN` | Public origin, e.g. `http://localhost:3020`; used for CSRF and cookie flags |
| `OTP_PEPPER` | ≥32 random chars; HMAC key for one-time codes |
| `DATA_KEY` | 32 random bytes, base64; AES-256-GCM key for encrypted fields (national ID). Rotating it makes old values unreadable |
| `SMS_PROVIDER` | `console` (dev only). A real provider adapter is still to be written — see "Before the pilot" |
| `STORAGE_DIR` | Private folder for uploaded documents (default `./storage/private`, git-ignored) |
| `SEED_SUPERADMIN_MOBILE` / `_NAME` | First super-admin created by the seed. The seed refuses the placeholder number in production |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Development server / production build / production server (port 3020) |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint |
| `npm test` | 92 unit tests (validators, encryption, agreement fingerprint, money/VAT/fee maths, delivery slots, ranking, trust caps, proof rules, payment/on-time rules, fee-invoice/ceiling maths, review rules) |
| `npm run verify` | **120 end-to-end checks** for slice 1 against a running dev server and the dev DB (see below) |
| `npm run verify:2` | **124 end-to-end checks** for slice 2: catalogue, zones, slot rules, comparison, order placement/idempotency/spending cap, cancel, privacy shaping, admin screens |
| `npm run verify:3` | **160 end-to-end checks** for slice 3: accept/decline/re-route/escalate, expiry job, drivers, trip, recipient code, proof rules, immutability, failed delivery and reschedule, privacy (needs `npm run db:seed` first) |
| `npm run verify:4` | **89 end-to-end checks** for slice 4: confirmation (buyer and admin-after-silence), delivery and non-payment disputes and every resolution outcome, payment mark-paid/received/not-received, overdue blocking new orders, reminder jobs, the 30-day close job, immutability, privacy (needs `npm run db:seed` first) |
| `npm run verify:5` | **86 end-to-end checks** for slice 5: fee accrual on confirmation, ceiling warnings/auto-pause, invoice generation/reminders/overdue, the pause-then-suspend escalation ladder, supplier pay/admin confirm-or-reject, the on-time-invoices → higher ceiling upgrade, fee-rule publish with notice, review submit/window/one-per-order, supplier reply, admin removal, rating aggregation, immutability, privacy (needs `npm run db:seed` first) |
| `npm run verify:6` | **22 end-to-end checks** for slice 6: the health endpoint, the generic rate limiter tripping on the write endpoints it protects, document-expiry notices, agreement re-acceptance nudges, the 30-day driver-location purge (and that it never touches proof evidence), the unified admin dashboard, access control (needs `npm run db:seed` first) |
| `npm run verify:7` | **23 end-to-end checks** for slice 7 hardening: cursor pagination on orders/payments/fee-invoices/reviews (including a supplier's multi-status tab query and exact `groupBy` counts), recency-weighted ratings reaching the real search API, and ceiling-warning dedup by genuine threshold-crossing — including the recovery-then-re-rise case a calendar-day dedup would miss (needs `npm run db:seed` first) |
| `npm run jobs:run` | One manual pass of the background jobs (the server also runs them every minute) |
| `npm run db:migrate` · `db:generate` · `db:seed` · `db:seed:demo` | Database tasks |
| `npm run db:backup` · `db:restore -- <file>` | `scripts/backup.ts` / `scripts/restore.ts` — see `DEPLOY.md` §8 |

`npm run verify` drives the real HTTP API with cookie jars: sign-in, rate limits, CSRF,
two-step verification (including replay and brute-force protection), the full supplier journey
(documents, IBAN, agreement signing, submission), admin review and approval, bank-account change
cool-down, Brand Registry, role permissions, and it probes the database guarantees directly
(append-only tables, immutable agreements). It creates throw-away users/suppliers, so it is
re-runnable; those rows stay in the dev DB. `verify:2` cleans up its throw-away suppliers at the
start and end so they do not clutter the buyer's offer comparison, but orders are append-only
evidence and remain.

## Slice 2 — how ordering works

- **Money** is integer halalas. Prices are VAT-inclusive (15 %); the platform fee is
  SAR 0.50 per *packet* (20 bottles = 1 packet; other sizes are converted through
  `packetEqMilli`), computed by the server from the price snapshot — the client never sends a fee.
- **Districts** (`District`) carry delivery hours, a Friday blackout (11:00–14:00), a GPS radius
  and a `restricted` flag with an Arabic and English reason. Haram-central and the Hajj holy
  sites are seeded as restricted: they can be listed but not ordered, and suppliers cannot cover them.
- **Slots** are 3-hour windows in Asia/Riyadh inside the district's hours, honouring the supplier's
  lead time; the server re-validates the chosen slot.
- **Placing an order** takes an idempotency key (double-tap safe), a per-buyer advisory lock for the
  spending cap (trust tiers SAR 500 / 2,000 / 5,000 / 15,000 — editable defaults in `src/lib/trust.ts`),
  and stores snapshots of price, fee and destination. The supplier has 2 h to accept
  (`acceptBy`); the expiry job and accept/decline arrive in slice 3.
- **Privacy**: suppliers see the donor's first name only; the recipient's details stay hidden
  until the order is accepted (`RECIPIENT_REVEALED` in `src/server/orders.ts`).
- The map uses OpenStreetMap tiles — fine for development and a small pilot, but swap in a
  licensed tile provider before real traffic (OSM's usage policy).

## Slice 3 — fulfilment

- **Accept / decline (T02–T06).** A supplier accepts (guards: account active, current agreement accepted,
  no expired verified document) or declines with a reason. A decline, a missed 2-hour deadline, or a
  release after accepting sends the order to the best-ranked eligible supplier: same brand and pack,
  serves the destination, can still meet the buyer's window, and costs the buyer **the same or less
  than the price they first agreed** — never more. Nobody left ⇒ `ESCALATED` for the admin queue
  (re-tried automatically every 10 minutes and by hand). Every offer is kept in `OrderAllocation`.
- **Background jobs** (`src/server/jobs.ts`, started by `src/instrumentation.ts`): expiry and escalation retries,
  every 60 s inside the server process. Every step is idempotent and takes per-order locks, so overlapping
  runs are safe. `JOBS_ENABLED=false` switches the loop off. With more than one server instance this still
  works (locks), but production should run jobs from one supervised place.
- **Drivers.** A supplier adds drivers by mobile (or itself: "I deliver myself"). A driver signs in with their own
  number and must accept the *driver acknowledgement* (draft text, needs legal review) before seeing any job.
  Drivers see the recipient and pin only for assigned jobs, never prices, the donor's last name or mobile;
  recipient details are masked again 30 days after delivery.
- **Driver app** (`/driver`, installable, works offline). Actions (start, arrive, photos, confirm, fail) are
  written to an outbox in IndexedDB — photos as blobs — and sent in order when the connection returns; every
  server step is idempotent (photo `clientId`, replayable confirm), so retries never duplicate evidence.
  The service worker caches only the app shell (no personal data) and never `/api`. Sign-out wipes the phone's
  data (after warning about anything unsent). In development the worker is opt-in with `/driver?sw=1`.
- **Proof of delivery (T09).** Server-side rules: ≥ 2 in-app photos, one showing the brand label + batch/expiry;
  GPS within the district radius (else a reason is required and the proof is flagged); recipient code
  (else a reason, flagged); delivered quantity per line (partial delivery recalculates amount and fee).
  Photos are private, hashed (reused photos are flagged) and immutable; proof rows only allow the admin-review
  columns to change afterwards (database triggers).
- **Review (R11).** During the pilot *every* delivery is queued for admin review (`PILOT_REVIEW_ALL` in
  `src/lib/fulfilment.ts`); flags, independent-distributor probation and partial deliveries are recorded as reasons.
- **Failed delivery (T10/T11).** Reason + a photo at the door; the supplier reschedules (up to 2 attempts) or
  cancels; the buyer can cancel too.

## Slice 4 — confirmation, payment tracking, disputes

- **Dual confirmation (T12–T14).** The buyer confirms receipt, which reveals the supplier's bank details and
  opens a `PaymentRecord` due in 3 days. Reminders fire at 24 h and 48 h of silence; at 72 h the order moves to
  `ADMIN_REVIEW` (the buyer can still confirm from there) and an admin can confirm on the delivery evidence on
  file (`POST /admin/orders/{id}/confirm`, reason required).
- **Payment — status only, never money** (`src/server/payments.ts`). `DUE → BUYER_MARKED_PAID → RECEIVED`, or
  `DUE/OVERDUE → DISPUTED`. The buyer taps "I have paid" (date, bank reference, optional receipt); the supplier
  marks it received (closes the order to `PAID`, grows the buyer's paid count and — only if paid by the due
  date — their on-time count, which is what actually raises the trust-tier spending cap) or not received (back
  to `DUE`/`OVERDUE`). A reminder job sends a −24 h nudge, flips `DUE → OVERDUE` at the due date (which blocks
  the buyer from placing any new order, anywhere, until it is settled), and follows up after 2 more days.
- **Disputes** (`Dispute` model). A *delivery* dispute (buyer-opened: not delivered, short, wrong brand, damaged,
  late) is only possible before payment is due and pauses the order (`DISPUTED`); an admin resolves it as
  **redeliver** (a genuine second attempt on the same `Delivery`, its own proof, driver flow unchanged),
  **price adjustment** (never above the original total), **cancel**, or **dismiss** (confirms at the full
  price). A *non-payment* dispute (supplier-opened, once payment is `DUE`/`OVERDUE`) pauses only the
  `PaymentRecord`, resolved as received / still due / **written off** (`VOID`) — the order itself is untouched.
  Only one open dispute per order (enforced by the app and a partial unique index). `POST /admin/disputes/{id}/resolve`.
- **Supplier Payments page** (`/supplier/payments`). Every transaction by number, date and brand, with a status
  chip and the goods → Sabeel fee → VAT on the fee → **what you keep** breakdown; a running total of what has
  actually been received.
- **Evidence stays append-only.** A `ProofOfDelivery` is now one row *per attempt* (a redeliver adds a second,
  the first is kept, never overwritten); a settled `PaymentRecord` (`RECEIVED`/`VOID`) cannot change status
  again; a resolved `Dispute` cannot be reopened without an outcome (database triggers/checks, not just app code).

## Slice 5 — fee accrual, invoicing, credit ceiling, reviews

- **Fee accrual (FR-FEE-11)** (`src/server/fees.ts`, wired into `settleConfirmation()` in
  `payments.ts`). The moment an order reaches `CONFIRMED_BY_BOTH` — buyer, admin-after-silence, or
  a dismissed/adjusted dispute — a `FeeAccrual` row is created from the order's own delivered-quantity
  proof (packet-equivalents × the rate in force *when the order was placed*, plus 15 % VAT on top).
  This is the only place a fee amount is ever decided; the supplier can see it but never sets or edits
  it, and the row is immutable once written (database trigger: no edits, no deletes, `invoiceId` may
  only be set once).
- **Credit ceiling** (design pack §G). A new supplier's ceiling is SAR 250 (SAR 1,000 once
  established); exposure is unbilled accruals + every open invoice. At 70 %/90 % the owner is warned
  (at most once a day per threshold); at 100 % the supplier is **paused automatically**
  (`pauseReason: "ceiling"`) — no new orders until it settles. Paying an invoice down re-checks
  exposure and reinstates the supplier on its own, whichever reason caused the pause.
- **Invoicing is system-generated only** (`generateInvoices()`, a background job). Unbilled accruals
  are grouped by the supplier's billing cycle (weekly Saturday–Friday, or monthly once established)
  and billed the moment their period closes — `SBL-INV-2026-NNNNNN`, due in 7 days. A reminder fires
  3 days ahead; at the due date an unpaid invoice becomes `OVERDUE`. The escalation ladder then pauses
  the supplier 7 days into overdue and **suspends** it 14 days in (design pack §G) if still unresolved.
  The supplier self-reports payment (bank reference, optional receipt) and an admin (`ADMIN_FINANCE`)
  confirms or rejects it, exactly mirroring the buyer-payment flow in slice 4. Four consecutive
  on-time invoices raise the ceiling to SAR 1,000 and move billing to monthly (R04/R05); a late or
  rejected payment resets the streak to zero.
- **The fee rate itself is editable and disclosed** (`publishFeeRule()`, `/admin/fees`, `ADMIN_FINANCE`).
  A change to a scope that already has a current rule needs at least 30 days' notice
  (`FEE_CHANGE_NOTICE_DAYS`); the very first rule for a brand-new scope may start immediately. Every
  active supplier is notified ahead of a GLOBAL change. The admin exposure dashboard
  (`/admin/fees`, `/admin/fee-invoices`) lists every supplier with anything outstanding, worst first.
- **Reviews** (`Review`/`ReviewReply`, `src/server/reviews.ts`). One review per order, from the buyer,
  once delivery is confirmed (`CONFIRMED_BY_BOTH`+) and within 30 days; write-once evidence — a
  database trigger allows only the admin-removal columns to change afterwards, never the content. The
  supplier may reply once (also append-only). An admin can remove a review for abuse, off-topic
  content or a policy violation (reason required, kept in the record as removed, not deleted). A
  supplier's rating in offer comparison stays "New" until it has 3 reviews, then shows the real
  average — real data now feeds `src/server/ranking.ts`'s "best" ordering (on-time delivery % is
  still a later-slice metric).

## Slice 6 — admin queues, hardening, backups, docs

- **Unified admin dashboard** (`/admin`). Every domain used to be its own page with no single "what
  needs me today" view; the dashboard now shows six live counts — pending suppliers, orders needing
  attention, open disputes, paused/suspended suppliers, fee invoices awaiting action, and documents
  expiring or expired — each linking straight to where you act on it. A zero everywhere means the
  queue is genuinely empty, not that something forgot to load.
- **Three new background jobs** close gaps the design pack names but slices 1–5 only enforced
  reactively: `sendDocumentExpiryNotices()` (`src/server/compliance.ts`) warns a supplier 14 days
  before a verified document expires and again once it has, instead of just silently hiding them
  once it happens; `sendReacceptanceNudges()` (`src/server/terms.ts`) tells a supplier owner as soon
  as an agreement version they haven't accepted takes effect (or is about to), rather than letting
  them discover the `AGREEMENT_REQUIRED` block on their own; `purgeStaleDriverLocations()`
  (`src/server/privacy.ts`) nulls a driver's corrected-pin proposal and each delivery attempt's own
  GPS reading 30 days after the delivery is no longer active (risk register R10's own number) — it
  never touches `ProofOfDelivery`/`ProofPhoto` GPS, which is delivery *evidence*, not a navigation
  ping, and stays for the life of the order like every other proof field.
- **A generic rate limiter** (`src/lib/rateLimit.ts`) closes the gap where OTP requests were the only
  throttled write in the app. It now also guards order placement, review submission, dispute reports
  and fee-invoice payment submission. **In-memory, single-process** — fine at the pilot's scale; see
  `DEPLOY.md` §6 for what changes once there is more than one app instance.
- **`GET /api/v1/health`** — unauthenticated, checks the database with one `SELECT 1`, and reports
  (informationally, never gating) whether the background job loop is running in this process. Point
  an uptime monitor at it.
- **`DEPLOY.md`** (process supervision, TLS, secrets, backups, monitoring, staging) and
  **`ADMIN_GUIDE.md`** (a plain-language manual for Operations/Support/Finance staff) are new. So is
  **`.env.example`**, and `scripts/backup.ts` / `scripts/restore.ts` for `pg_dump`/`pg_restore` backed
  backups with a drill that only ever restores into a separate throwaway database, never the live one.

## Layout

```
prisma/                 schema, migrations (incl. append-only triggers), seed + draft agreement texts
scripts/verify-slice1.ts  end-to-end verification
scripts/backup.ts, restore.ts  pg_dump/pg_restore backup + restore-drill scripts (see DEPLOY.md)
src/proxy.ts            coarse redirect for signed-out visitors (real checks are server-side)
src/lib/                env, db, crypto, otp, sms, session, totp, audit, validators, http wrapper,
                         rateLimit, proof/payment/fee/review rules
src/server/             business logic: suppliers, terms, brands, users, storage, fulfilment, driver(s),
                         payments, fees, reviews, compliance, privacy
src/app/api/v1/         REST API (see design pack §9), incl. the public /health check
src/app/…               pages: /, /login, /2fa, /account, /supplier/*, /admin/*, /certificate/[no]
src/components/         forms and panels (client) + ui.tsx primitives
src/i18n/               Arabic + English dictionaries (English must provide every Arabic key)
```

## Security decisions worth knowing

- **Sign-in** = Saudi mobile + SMS code (HMAC-hashed, 5 min, 5 guesses, 60 s resend, 5/h per number).
  Sessions are random tokens stored **hashed** in the DB, `HttpOnly`, `SameSite=Lax`; privileged
  sessions last 12 h.
- **Two-step verification is mandatory** for suppliers and every admin role (authenticator app,
  replay-proof, brute-force limited). Privileged accounts are blocked at the API until it is done.
- **Authorization** is enforced in the API on every route (`src/lib/http.ts`), independently of
  the page guards. Documents are served only to their owner and to staff, never from `/public`,
  with `nosniff`, `no-store` and a sandbox CSP; uploads are validated by file content, not name.
- **Evidence is append-only**: a database trigger forbids UPDATE/DELETE on `AuditLog` and
  `TermsAcceptance`, and forbids editing a published agreement's text. Acceptances store the
  version, SHA-256 of the exact text, language shown, time, IP, device and the signing-code link.
- **The platform holds no money**: there is no wallet/balance/card column anywhere (design pack §5.3).
- **Production guard**: `SMS_PROVIDER=console` is refused when `NODE_ENV=production`, so the app
  can never silently pretend to send codes. Suppliers cannot be approved in production until a
  super-admin confirms the agreements were reviewed by counsel.
- Changing a live supplier's payout IBAN waits 48 h and alerts admins.
- **Rate limiting** on OTP (per-mobile/per-IP, DB-backed) and on the write endpoints most worth
  throttling (order placement, reviews, disputes, fee-invoice payments — in-memory, see `src/lib/rateLimit.ts`).
- **`GET /api/v1/health`** for uptime monitoring; never returns more than booleans and a timing number.

## Before the pilot (known gaps — not bugs)

1. **SMS provider** — write the adapter in `src/lib/sms.ts` for the owner's chosen provider and sender ID.
2. **Legal review** of the four draft agreements (supplier, independent, buyer, driver acknowledgement) (`prisma/seed-data/terms.ts`, bracketed
   placeholders included), then a super-admin marks them reviewed in *Admin → Agreements*.
3. **Real super-admin number** in `SEED_SUPERADMIN_MOBILE`; remove the demo brands (fictional, `DEMO-*` SFDA refs).
4. **Acceptance certificate** is a printable page (`/certificate/[no]`, "Save as PDF"); a
   server-generated Arabic PDF needs proper text shaping and is still to do.
5. **Mobile numbers are stored in clear text** (they are the unique sign-in key); only the
   national ID is encrypted at field level. Rely on encrypted disks/DB at the host, or add a blind index later.
6. **Makkah district list, hours and the city bounding box are approximate** — confirm with the first
   suppliers and edit in *Admin → Districts*. Demo suppliers (`prisma/seed.ts`, fictional) must never exist in production.
7. **The driver app's live-camera capture and GPS were not exercised on a real phone** (the desktop browser
   pane blocks the camera). Everything around them — fallback, queue, sync, caching — was. Test on a real
   Android and iPhone before the pilot.
8. **Recipient code needs a connection** (an SMS must be sent and the driver must verify it live). Offline, the
   driver proceeds with a recorded reason and the delivery is flagged for review.
9. **Re-routing never raises the price and never asks the buyer** to choose; if nobody qualifies the order is
    escalated. A "choose another supplier" screen for the buyer is not built.
10. ~~**Order/invoice/review lists** are capped (100–300 rows depending on the list) with no pagination yet.~~
   **Closed in slice 7**: orders, payments, fee invoices and reviews (buyer/supplier/admin views) are
   all cursor-paginated now (`src/lib/pagination.ts`), 50 rows a page with a "Load more" link; a
   supplier's per-status tab counts come from a separate `groupBy` query so they stay exact regardless
   of page size.
11. **Delivery-dispute evidence is the buyer's word plus the driver's original proof** — there is no separate
   "supplier responds with counter-evidence" step (design pack's 48 h response window). An admin decides from
   what is already on file; this is a deliberate scope cut for the MVP, not an oversight.
12. **FeeAccrual is per-order, not per-order-item** — a partial delivery still produces one accrual row for
   the order's delivered total, not a line per item. There is also no invoice-line-dispute workflow: a supplier
   can only accept an invoice or have its self-reported payment rejected by an admin, never dispute one
   accrual within it.
13. **Reviews are write-once with no self-service edit, and no `FROZEN` cooling-off state** — the design pack's
   short review state machine (`PROMPTED → SUBMITTED → FROZEN(48h) → REMOVED`) is simplified here to
   `SUBMITTED → REMOVED`; an admin can remove a review immediately, there is no 48 h window before that becomes
   possible. There is also no public supplier-profile page listing a supplier's reviews — only the aggregate
   rating in offer comparison and the supplier/admin moderation views.
14. ~~**Ranking still uses a simple average rating**, not the "recent reviews weigh more" decay a mature
   marketplace would want~~ **Closed in slice 7**: `weightedAverageStars()` (`src/lib/reviews.ts`) applies an
   exponential decay with a 90-day half-life, used everywhere a supplier's rating is shown or ranked on
   (offer search, supplier/admin dashboards). On-time delivery % (R08) is still a later-slice input,
   defaulted to a neutral prior until it is built.
15. ~~**Ceiling-warning notifications are deduped by calendar day**, not by genuine threshold-crossing~~
   **Closed in slice 7**: dedup now tracks the supplier's last-known ceiling band from its own notification
   history (`src/server/fees.ts`) — a supplier sitting at 75% for a week gets exactly one warning, not one a
   day, but a fresh rise past a threshold after a genuine recovery (exposure actually dropping, whether from
   a reinstate or simply paying an invoice down while never paused) warns again. The
   fee-change notice period (30 days) is a fixed constant, not admin-configurable per change the way a terms
   document's notice period is.
16. **Hosting**: `DEPLOY.md` now has the runbook (systemd unit, Caddy/TLS config, backup/restore
   scripts, health-check monitoring), but nothing in it has run against a *real* KSA-region server
   yet — the actual VM, domain and first live restore drill are still owner/ops actions.
17. **Recipient PII (name/mobile/address) is never purged**, only masked from views after 30 days
   (`src/server/orders.ts`/`driver.ts`) — the data itself persists indefinitely. Slice 6 built the
   driver-*location*-ping purge R10 asks for by name, but a real deletion policy for recipient
   personal data needs a lawyer-defined retention period (PDPL) first; see `src/server/privacy.ts`'s
   own comment.
18. **The rate limiter is in-memory and single-process** (`src/lib/rateLimit.ts`) — resets on restart,
   doesn't share state across instances. Fine at the pilot's one-instance scale; move it to a shared
   store (Redis) before running more than one app instance, per `DEPLOY.md` §6.
19. **No penetration test or WCAG 2.2 AA audit has been run** — every slice's own phone-width/RTL
   checks are not a substitute for either (lean prompt §10). Both are owner/ops actions before public
   launch, not something this repo can self-certify.
20. **The admin dashboard's "needs attention" tiles are a snapshot of six specific queues**, not the
   design pack's full `GET /admin/queues/{type}` set verbatim — reviews have no "needs moderation"
   flag to queue on (there's no signal that distinguishes a flagged review from any other), so they
   stay a browsable list (`/admin/reviews`) rather than a dashboard tile.

## Roadmap

All 6 slices in the original plan are built and verified, plus an ad-hoc **slice 7 hardening** pass
(pagination, recency-weighted ratings, ceiling-warning dedup by threshold-crossing — see gaps #10,
#14, #15 above, `npm run verify:7`). Deliberately left out of slice 7, and still open: PDF
certificate generation (#4), a review-flagging/moderation queue and public supplier-profile page
(#13, #20), a recipient-PII purge job (#17 — blocked on a lawyer-defined retention period, not
something to invent), and moving the rate limiter to a shared store (#18 — a disclosed, reasonable
tradeoff at the pilot's one-instance scale). What remains beyond that is exactly what's listed above
under "known gaps" — mostly owner/legal/ops actions (a real SMS provider, legal review, real hosting,
a pentest) rather than more application code.
