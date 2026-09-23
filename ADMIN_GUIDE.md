# Sabeel admin manual

For the people who run Sabeel day to day — Operations, Support and Finance staff. Written so the
platform keeps working even as the team around it changes (lean prompt §7 "Documentation").

## Signing in

Sign in with your mobile number and the SMS code, same as anyone else. **Every admin role requires
two-step verification** (an authenticator app — Google Authenticator, Authy, etc.) — you'll be asked
to set it up the first time and enter a 6-digit code every time after that. If you lose your device,
another `SUPER_ADMIN` resets it for you from *Admin → Users*; there is no self-service recovery, on
purpose.

## Roles

| Role | Can do |
|---|---|
| **Operations (`ADMIN_OPS`)** | Everything below except fee rules and inviting other staff |
| **Support (`ADMIN_SUPPORT`)** | Suppliers, Brand Registry, districts, disputes, reviews, agreements — no fees or user management |
| **Finance (`ADMIN_FINANCE`)** | Fee rules, fee invoices, audit log — not supplier approval or disputes |
| **Super admin (`SUPER_ADMIN`)** | All of the above, plus user/role management and marking agreements legally reviewed |

You only see the pages your role allows in the navigation bar. If a page 404s or bounces you back
to the homepage, that's the role guard working, not a bug — ask a `SUPER_ADMIN` if you think you
need access you don't have.

## The dashboard (*Admin*)

This is where you should start every session. The **"Needs attention"** tiles at the top are your
queue — each links straight to the page where you act on it:

| Tile | What it means | Where to act |
|---|---|---|
| Supplier verification | New applications waiting for a decision | *Suppliers* |
| Orders | Stuck, silent, overdue or flagged orders | *Orders* (Needs attention filter) |
| Disputes | Buyer- or supplier-opened disputes still open | *Disputes* |
| Suppliers blocked | Paused or suspended — usually a ceiling or unpaid fee invoice | *Fees* |
| Fee invoices | Awaiting your confirmation, or overdue | *Fee invoices* |
| Expiring documents | A supplier's verified document is expiring or has expired | *Suppliers* (linked directly) |

A tile reading **0** everywhere means the queue is genuinely empty — nothing to do. Below the
tiles, the supplier-status counts and the detailed verification list work as before.

## Approving a supplier

Open the application from the dashboard or *Suppliers*. The checklist tells you exactly what's
missing before you can approve — don't try to work around it. Common holds:
- A document not yet marked **Verified** (check it, then mark it).
- The bank account not yet verified, or still in its 48-hour change cooldown.
- The current agreement not yet accepted online by the applicant.
- For an independent distributor: their probation-delivery count hasn't been reset (a fresh applicant
  starts on probation — every one of their first 10 deliveries gets reviewed automatically).

**Reject** and **Request more information** both need a note explaining why — the applicant sees it.
**Approve** needs nothing extra once the checklist is green.

## Orders that need you

*Orders → Needs attention* is a filter, not a separate list — it's the same orders table showing
only rows that genuinely need a human: nobody accepted it in time (**Escalated**), a delivery failed
twice, the buyer went silent for 72 hours (**Admin review**), a dispute is open, or a proof-of-delivery
photo was flagged for review. Open the order to see the full picture and act (confirm on the evidence,
reallocate to another supplier, or review the flagged proof).

## Disputes

A **delivery dispute** (buyer says something was wrong) needs one of: redeliver, adjust the price
down, cancel, or dismiss (confirm the delivery stands as reported). A **non-payment dispute**
(supplier says they weren't paid) needs: confirm received, still due, or write off. Always write a
real resolution note — the buyer and supplier both see it, and it is part of the permanent record.

## Fee invoices

Suppliers self-report when they've paid an invoice (bank reference, optional receipt). Your job is
to check the reference against the actual bank statement and **Confirm** or **Reject**:
- **Confirm** closes the invoice and, if it was paid on time, counts toward the supplier earning a
  higher credit ceiling and monthly billing (four in a row).
- **Reject** needs a note (shown to the supplier) and puts the invoice back where it was — still
  payable, not lost.

An invoice left unpaid past its due date pauses the supplier automatically after a grace period, then
suspends it if still unresolved — you don't need to do anything for that to happen, but the *Fees*
exposure table shows you who is close to it before it does.

## Reviews

*Reviews* lists every one, newest first, with the supplier's reply if they've posted one. **Only
remove a review for abuse, off-topic content, or a real policy violation** — a real complaint about
service, even a harsh one, should stay. Removal needs a reason and cannot be undone through the UI
(the record is kept, just marked removed and hidden from buyers).

## Agreements (Terms)

Publishing a new version needs a notice period (30 days is the default for a material change to
supplier-facing terms — see the fee-rule rule for the same idea applied to pricing). A version stays
a **draft** until a `SUPER_ADMIN` marks it *legally reviewed* — the dashboard's yellow banner tells
you if anything published is still waiting on that, and production refuses to approve any new
supplier until every agreement type has a reviewed current version.

## Districts

Restricting a district takes effect immediately — every supplier's coverage there switches off at
once, and buyers can no longer order into it. Use this for anything requiring special permits
(the pilot excludes Haram-central and the Hajj sites from the start) or a temporary local problem.

## Audit log

Every sensitive action — approvals, rejections, fee-rule changes, dispute resolutions, review
removals — is written here automatically and **cannot be edited or deleted**, including by a
`SUPER_ADMIN`. If something looks wrong, check here first: who did what, and when.

## If something seems broken

Check `GET /api/v1/health` (ask a developer, or open it directly — it's plain JSON, no sign-in
needed) — `{"ok":true}` means the database is reachable. If the app itself won't load, that's a
hosting/process problem, not something fixable from the admin console — see `DEPLOY.md`.
